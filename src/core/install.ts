import { existsSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentId, DetectedAgent, InstallPlan } from "../shared/types.js";
import { planAdapterSkillInstall } from "./adapters.js";
import { createSnapshot, restoreSnapshot } from "./snapshot.js";
import { applySkillPlan, detectInstallConflicts, validateSkillDirectory } from "./skills.js";
import { installStatePath, recordInstall, recordInstallBatch } from "./state.js";
import { beginTransaction, completeTransaction, markTransactionCommitting, recoverPendingTransactions, rollbackTransaction } from "./transaction.js";

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
  const plans = await Promise.all(agents.map((agent) => planAdapterSkillInstall(source, packageId, agent)));
  const files = plans.flatMap((plan) => plan.files);
  const conflicts = detectInstallConflicts([{ packageId, files, targetAgents: agents.map((agent) => agent.id), warnings: [] }]);
  return {
    packageId,
    files,
    targetAgents: agents.map((agent) => agent.id),
    warnings: conflicts.filter((item) => item.severity === "warning").map((item) => item.message),
    conflicts
  };
}

export async function applySkillInstall(plan: InstallPlan, metadata?: { repository?: string; resolvedCommit?: string }): Promise<string> {
  const blocking = (plan.conflicts ?? []).filter((conflict) => conflict.severity === "blocking");
  if (blocking.length > 0) throw new Error(`Installation blocked by conflicts: ${blocking.map((conflict) => conflict.message).join("; ")}`);
  await recoverPendingTransactions();
  const targets = [...plan.files.map((file) => file.target), installStatePath()];
  const snapshot = await createSnapshot(targets);
  const transaction = await beginTransaction(snapshot, targets);
  try {
    await markTransactionCommitting(transaction);
    await applySkillPlan(plan);
    await recordInstall(plan, snapshot.id, metadata);
    await completeTransaction(transaction);
  } catch (error) {
    await rollbackTransaction(transaction);
    throw error;
  }
  return snapshot.id;
}

export interface InstallBatchEntry {
  plan: InstallPlan;
  metadata?: { repository?: string; resolvedCommit?: string };
}

/** Apply all selected packages as one filesystem transaction and one state update. */
export async function applySkillInstallBatch(entries: InstallBatchEntry[], extraSnapshotPaths: string[] = []): Promise<string> {
  if (!entries.length) throw new Error("Installation batch is empty");
  const conflicts = detectInstallConflicts(entries.map((entry) => entry.plan));
  const blocking = conflicts.filter((conflict) => conflict.severity === "blocking");
  if (blocking.length) throw new Error(`Installation blocked by conflicts: ${blocking.map((item) => item.message).join("; ")}`);
  for (const entry of entries) {
    entry.plan.conflicts = [...(entry.plan.conflicts ?? []), ...conflicts.filter((conflict) => conflict.packageIds.includes(entry.plan.packageId))];
    entry.plan.warnings = [...new Set([...entry.plan.warnings, ...conflicts.filter((conflict) => conflict.severity === "warning" && conflict.packageIds.includes(entry.plan.packageId)).map((conflict) => conflict.message)])];
  }
  await recoverPendingTransactions();
  const targets = [...entries.flatMap((entry) => entry.plan.files.map((file) => file.target)), installStatePath(), ...extraSnapshotPaths];
  const snapshot = await createSnapshot(targets);
  const transaction = await beginTransaction(snapshot, targets);
  try {
    await markTransactionCommitting(transaction);
    for (const entry of entries) await applySkillPlan(entry.plan);
    await recordInstallBatch(entries, snapshot.id);
    await completeTransaction(transaction);
  } catch (error) {
    await rollbackTransaction(transaction);
    throw error;
  }
  return snapshot.id;
}

export function snapshotPath(snapshotId: string): string {
  return join(process.env.LOADOUT_HOME ?? join(process.env.HOME ?? process.cwd(), ".loadout"), "snapshots", `${snapshotId}.json`);
}
