import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type {
  AgentId,
  DetectedAgent,
  InstallRecord,
  ManagedActivationRecord,
} from "../shared/types.js";
import { readInstallState } from "./state.js";
import {
  listInstalledRuntimeToolSkillTargets,
  type InstalledRuntimeToolSkillTarget,
} from "./runtime-tools.js";

const MAX_SCAN_DEPTH = 6;
export const RECOMMENDED_ACTIVE_SKILLS = 30;

export interface InstalledSkillInventoryEntry {
  agent: AgentId;
  agentDisplayName: string;
  name: string;
  description?: string;
  path: string;
  fingerprint: string;
  managed: boolean;
  packageId?: string;
  /** Repository identifiers mentioned by the skill text; evidence, not proof. */
  sourceHints?: string[];
}

export interface SkillDuplicateGroup {
  name: string;
  kind: "within-agent" | "cross-agent-mirror";
  entries: Array<{
    agent: AgentId;
    path: string;
    fingerprint: string;
    managed: boolean;
    packageId?: string;
  }>;
}

export interface AgentSkillInventorySummary {
  agent: AgentId;
  displayName: string;
  directory: string;
  detected: boolean;
  total: number;
  managed: number;
  unmanaged: number;
  overRecommendedLimit: boolean;
  runtimeToolTargets?: number;
}

export interface InstalledSkillInventoryReport {
  generatedAt: string;
  total: number;
  managed: number;
  unmanaged: number;
  uniqueNames: number;
  agents: AgentSkillInventorySummary[];
  skills: InstalledSkillInventoryEntry[];
  duplicates: SkillDuplicateGroup[];
  warnings: string[];
}

function cleanFrontmatterValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  )
    return trimmed.slice(1, -1);
  return trimmed;
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (!path.startsWith("..") && !path.startsWith(sep));
}

function owningPackage(
  skillRoot: string,
  agent: AgentId,
  records: InstallRecord[],
  activations: ManagedActivationRecord[],
  runtimeTargets: InstalledRuntimeToolSkillTarget[],
): string | undefined {
  const runtime = runtimeTargets.find(
    (target) => target.agent === agent && isInside(target.path, skillRoot),
  );
  if (runtime) return runtime.packageId;
  const active = activations.find(
    (record) =>
      record.agent === agent &&
      record.activationState === "active" &&
      record.installationState === "installed" &&
      record.targets.some((target) => isInside(target.activePath, skillRoot)),
  );
  if (active) return active.packageId;
  return records.find(
    (record) =>
      record.targetAgents.includes(agent) &&
      !activations.some(
        (activation) =>
          activation.packageId === record.packageId &&
          activation.agent === agent,
      ) &&
      record.files.some((file) => isInside(skillRoot, file.path)),
  )?.packageId;
}

async function scanAgentSkills(
  agent: DetectedAgent,
  records: InstallRecord[],
  activations: ManagedActivationRecord[],
  runtimeTargets: InstalledRuntimeToolSkillTarget[],
): Promise<{ skills: InstalledSkillInventoryEntry[]; warnings: string[] }> {
  const primaryRoot = resolve(agent.skillsDirectory);
  const roots = [
    primaryRoot,
    ...runtimeTargets
      .filter((target) => target.agent === agent.id)
      .map((target) => resolve(target.path))
      .filter((target) => !isInside(primaryRoot, target)),
  ];
  const skills: InstalledSkillInventoryEntry[] = [];
  const warnings: string[] = [];

  async function visit(directory: string, depth: number): Promise<void> {
    let info;
    try {
      info = await lstat(directory);
    } catch {
      return;
    }
    if (info.isSymbolicLink()) {
      warnings.push(
        `${agent.displayName}: symlinked skill path was reported but not followed: ${directory}`,
      );
      return;
    }
    if (!info.isDirectory()) return;
    let children;
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch {
      warnings.push(`${agent.displayName}: could not read ${directory}`);
      return;
    }
    const skillFile = children.find(
      (entry) => entry.isFile() && entry.name === "SKILL.md",
    );
    if (skillFile) {
      try {
        const path = join(directory, "SKILL.md");
        const content = await readFile(path, "utf8");
        const packageId = owningPackage(
          directory,
          agent.id,
          records,
          activations,
          runtimeTargets,
        );
        const sourceHints = [
          ...new Set(
            [
              ...content.matchAll(
                /https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]*[A-Za-z0-9_-])/g,
              ),
            ].map((match) => match[1].replace(/\.git$/, "")),
          ),
        ].sort();
        skills.push({
          agent: agent.id,
          agentDisplayName: agent.displayName,
          name:
            cleanFrontmatterValue(content.match(/^name:\s*(.+)$/m)?.[1]) ??
            directory.split(sep).at(-1) ??
            "unnamed",
          ...(cleanFrontmatterValue(
            content.match(/^description:\s*(.+)$/m)?.[1],
          )
            ? {
                description: cleanFrontmatterValue(
                  content.match(/^description:\s*(.+)$/m)?.[1],
                ),
              }
            : {}),
          path: directory,
          fingerprint: createHash("sha256").update(content).digest("hex"),
          managed: Boolean(packageId),
          ...(packageId ? { packageId } : {}),
          ...(sourceHints.length ? { sourceHints } : {}),
        });
      } catch (error) {
        warnings.push(
          `${agent.displayName}: could not inspect ${join(directory, "SKILL.md")}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return;
    }
    if (depth >= MAX_SCAN_DEPTH) {
      warnings.push(
        `${agent.displayName}: stopped scanning below depth ${MAX_SCAN_DEPTH}: ${directory}`,
      );
      return;
    }
    for (const child of children) {
      if (
        child.name === ".git" ||
        child.name === "node_modules" ||
        child.name === ".cache"
      )
        continue;
      if (child.isDirectory() || child.isSymbolicLink())
        await visit(join(directory, child.name), depth + 1);
    }
  }

  for (const root of [...new Set(roots)]) await visit(root, 0);
  return {
    skills: skills.sort((left, right) => left.path.localeCompare(right.path)),
    warnings,
  };
}

function duplicateGroups(
  skills: InstalledSkillInventoryEntry[],
): SkillDuplicateGroup[] {
  const byName = new Map<string, InstalledSkillInventoryEntry[]>();
  for (const skill of skills) {
    const key = skill.name.trim().toLowerCase();
    const items = byName.get(key) ?? [];
    items.push(skill);
    byName.set(key, items);
  }
  return [...byName.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([name, entries]): SkillDuplicateGroup => {
      const agents = entries.map((entry) => entry.agent);
      const withinAgent = new Set(agents).size < agents.length;
      return {
        name,
        kind: withinAgent ? "within-agent" : "cross-agent-mirror",
        entries: entries.map((entry) => ({
          agent: entry.agent,
          path: entry.path,
          fingerprint: entry.fingerprint,
          managed: entry.managed,
          ...(entry.packageId ? { packageId: entry.packageId } : {}),
        })),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Read existing agent skill directories without executing their instructions.
 * Unmanaged means only "not installed by Loadout"; it is not a quality or
 * safety verdict and no files are changed by this scan.
 */
export async function scanInstalledSkills(
  agents: DetectedAgent[],
): Promise<InstalledSkillInventoryReport> {
  const [state, runtimeTargets] = await Promise.all([
    readInstallState(),
    listInstalledRuntimeToolSkillTargets(),
  ]);
  const scans = await Promise.all(
    agents.map((agent) =>
      scanAgentSkills(
        agent,
        state.installs,
        state.activations ?? [],
        runtimeTargets,
      ),
    ),
  );
  const skills = scans.flatMap((scan) => scan.skills);
  const warnings = scans.flatMap((scan) => scan.warnings);
  const summaries = agents.map((agent, index) => {
    const entries = scans[index].skills;
    const managed = entries.filter((entry) => entry.managed).length;
    return {
      agent: agent.id,
      displayName: agent.displayName,
      directory: agent.skillsDirectory,
      detected: agent.installed,
      total: entries.length,
      managed,
      unmanaged: entries.length - managed,
      overRecommendedLimit: entries.length > RECOMMENDED_ACTIVE_SKILLS,
      runtimeToolTargets: runtimeTargets.filter(
        (target) => target.agent === agent.id,
      ).length,
    };
  });
  for (const summary of summaries.filter((item) => item.overRecommendedLimit))
    warnings.push(
      `${summary.displayName} exposes ${summary.total} skills; the recommended active set is at most ${RECOMMENDED_ACTIVE_SKILLS}.`,
    );
  const managed = skills.filter((entry) => entry.managed).length;
  return {
    generatedAt: new Date().toISOString(),
    total: skills.length,
    managed,
    unmanaged: skills.length - managed,
    uniqueNames: new Set(skills.map((entry) => entry.name.trim().toLowerCase()))
      .size,
    agents: summaries,
    skills,
    duplicates: duplicateGroups(skills),
    warnings,
  };
}

export function formatInstalledSkillInventory(
  report: InstalledSkillInventoryReport,
): string {
  const within = report.duplicates.filter(
    (group) => group.kind === "within-agent",
  ).length;
  const mirrors = report.duplicates.length - within;
  const lines = [
    `Skill inventory: ${report.total} skill(s), ${report.uniqueNames} unique name(s)`,
    `Loadout-managed: ${report.managed}; unmanaged: ${report.unmanaged}`,
    `Duplicate groups: ${within} within an agent; ${mirrors} cross-agent mirror(s)`,
    "",
  ];
  for (const agent of report.agents)
    lines.push(
      `${agent.detected ? "✓" : "○"} ${agent.displayName}: ${agent.total} skill(s) (${agent.managed} managed, ${agent.unmanaged} unmanaged)${agent.runtimeToolTargets ? `, including ${agent.runtimeToolTargets} runtime-tool skill(s)` : ""} — ${agent.directory}`,
    );
  for (const warning of report.warnings) lines.push(`! ${warning}`);
  lines.push(
    "",
    "Read-only scan complete. Unmanaged content was not changed or judged automatically.",
  );
  return lines.join("\n");
}
