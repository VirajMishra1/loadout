import { existsSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentId, DetectedAgent, InstallPlan } from "../shared/types.js";
import { createSnapshot, restoreSnapshot } from "./snapshot.js";
import { applySkillPlan, planSkillInstall, validateSkillDirectory } from "./skills.js";
import { recordInstall } from "./state.js";

export function installedAgents(agents: DetectedAgent[], requested?: AgentId[]): DetectedAgent[] {
  const available = agents.filter((agent) => agent.installed);
  if (!requested || requested.length === 0) return available;
  const selected = available.filter((agent) => requested.includes(agent.id));
  if (selected.length !== requested.length) {
    const missing = requested.filter((id) => !selected.some((agent) => agent.id === id));
    throw new Error(`Requested agents are not detected: ${missing.join(", ")}`);
  }
  return selected;
}

export async function buildSkillPlan(source: string, packageId: string, agents: DetectedAgent[]): Promise<InstallPlan> {
  if (!existsSync(source)) throw new Error(`Package source does not exist: ${source}`);
  const sourceStat = await lstat(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error(`Package source must be a real directory: ${source}`);
  }
  // A repository may contain one skill at its root or several nested skills.
  // Validate the root when present; planSkillInstall validates every nested skill.
  if (existsSync(join(source, "SKILL.md"))) await validateSkillDirectory(source);
  const plan = await planSkillInstall(source, agents.map((agent) => agent.skillsDirectory), packageId);
  plan.targetAgents = agents.map((agent) => agent.id);
  return plan;
}

export async function applySkillInstall(plan: InstallPlan, metadata?: { repository?: string; resolvedCommit?: string }): Promise<string> {
  const snapshot = await createSnapshot(plan.files.map((file) => file.target));
  try {
    await applySkillPlan(plan);
  } catch (error) {
    await restoreSnapshot(snapshot);
    throw error;
  }
  await recordInstall(plan, snapshot.id, metadata);
  return snapshot.id;
}

export function snapshotPath(snapshotId: string): string {
  return join(process.env.LOADOUT_HOME ?? join(process.env.HOME ?? process.cwd(), ".loadout"), "snapshots", `${snapshotId}.json`);
}
