import type {
  AgentId,
  CatalogPackage,
  DetectedAgent,
} from "../shared/types.js";
import { loadEffectiveCatalog, type InstallSelection } from "./catalog.js";
import { detectAgents } from "./paths.js";
import {
  isStableSkillSelected,
  isPowerSkillSelected,
  resolveCatalogProfile,
  type ProfileResolution,
} from "./profiles.js";
import {
  applySkillLibraryBatch,
  applySkillInstallBatch,
  buildSkillPlan,
  installedAgents,
  type InstallBatchEntry,
} from "./install.js";
import {
  fetchRepositorySnapshot,
  type RepositoryFetchOptions,
  type RepositorySnapshot,
} from "./source.js";
import {
  analyzeInstallPlanSafety,
  type UpdateSafetyAnalysis,
} from "./safety.js";

export const RECOMMENDED_ACTIVE_SKILL_LIMIT = 30;

export interface CatalogInstallEntry extends InstallBatchEntry {
  package: CatalogPackage;
  safety: UpdateSafetyAnalysis;
}

export interface CatalogInstallSkip {
  packageId: string;
  reason: string;
  kind: "explicit-setup" | "preparation-failed" | "overlap";
}

export interface CatalogInstallCollision {
  target: string;
  keptPackageId: string;
  deferredPackageId: string;
}

export interface CatalogInstallProgress {
  packageId: string;
  completed: number;
  total: number;
  status: "fetching" | "ready" | "skipped";
  message: string;
}

export interface PreparedCatalogInstall {
  selection: InstallSelection;
  resolution: ProfileResolution;
  agents: DetectedAgent[];
  entries: CatalogInstallEntry[];
  skipped: CatalogInstallSkip[];
  collisions: CatalogInstallCollision[];
}

export interface PrepareCatalogInstallOptions {
  requestedAgents?: AgentId[];
  catalog?: CatalogPackage[];
  detectedAgents?: DetectedAgent[];
  concurrency?: number;
  onProgress?: (progress: CatalogInstallProgress) => void;
  fetchSnapshot?: (
    repository: string,
    options?: RepositoryFetchOptions,
  ) => Promise<RepositorySnapshot>;
}

async function parallelMap<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), values.length) },
      () => run(),
    ),
  );
  return results;
}

/**
 * Prepare a broad catalog loadout without mutating agent files. Only packages
 * with reviewed skill evidence are fetched automatically; MCP servers and
 * executables need agent-specific configuration or credentials and remain
 * explicit customization steps.
 */
export async function prepareCatalogInstall(
  selection: InstallSelection,
  options: PrepareCatalogInstallOptions = {},
): Promise<PreparedCatalogInstall> {
  const catalog = options.catalog ?? (await loadEffectiveCatalog());
  const resolution = resolveCatalogProfile(catalog, selection);
  const agents = installedAgents(
    options.detectedAgents ?? (await detectAgents()),
    options.requestedAgents,
  );
  if (!agents.length)
    throw new Error(
      "No supported AI coding agent was detected. Install Codex, Claude Code, Cursor, Gemini CLI, OpenCode, or Hermes first.",
    );
  const skipped: CatalogInstallSkip[] = resolution.packages
    .filter((pkg) => !pkg.components?.includes("skill"))
    .map((pkg) => ({
      packageId: pkg.id,
      kind: "explicit-setup" as const,
      reason:
        "Not auto-installed: this catalog record has no reviewed skill component; MCP/executable setup requires explicit configuration.",
    }));
  const installable = resolution.packages.filter((pkg) =>
    pkg.components?.includes("skill"),
  );
  const fetchSnapshot = options.fetchSnapshot ?? fetchRepositorySnapshot;
  let completed = 0;
  const prepared = await parallelMap(
    installable,
    options.concurrency ?? 4,
    async (pkg): Promise<CatalogInstallEntry | CatalogInstallSkip> => {
      options.onProgress?.({
        packageId: pkg.id,
        completed,
        total: installable.length,
        status: "fetching",
        message: `Fetching reviewed ${pkg.displayName} snapshot`,
      });
      try {
        if (!pkg.source?.commit)
          throw new Error("catalog record has no reviewed commit");
        const fetched = await fetchSnapshot(pkg.repository, {
          ref: pkg.source.commit,
        });
        if (fetched.commit.toLowerCase() !== pkg.source.commit.toLowerCase())
          throw new Error(
            `resolved ${fetched.commit}, expected reviewed commit ${pkg.source.commit}`,
          );
        const include =
          selection.mode === "stable"
            ? (skill: { name?: string; targetName: string }) =>
                isStableSkillSelected(pkg.id, skill.name, skill.targetName)
            : selection.mode === "power"
              ? (skill: { name?: string; targetName: string }) =>
                  isPowerSkillSelected(pkg.id, skill.name, skill.targetName)
              : undefined;
        const plan = await buildSkillPlan(
          fetched.path,
          pkg.id,
          agents,
          include ? { include } : {},
        );
        if (selection.mode === "stable")
          plan.files = plan.files.filter((file) =>
            isStableSkillSelected(
              pkg.id,
              file.skillName,
              file.target.split(/[\\/]/).at(-1) ?? pkg.id,
            ),
          );
        if (selection.mode === "power")
          plan.files = plan.files.filter((file) =>
            isPowerSkillSelected(
              pkg.id,
              file.skillName,
              file.target.split(/[\\/]/).at(-1) ?? pkg.id,
            ),
          );
        if (!plan.files.length)
          throw new Error(
            `no skills from this collection are selected by the ${selection.mode === "stable" ? "Stable" : "Power"} profile`,
          );
        const safety = await analyzeInstallPlanSafety(plan);
        completed += 1;
        options.onProgress?.({
          packageId: pkg.id,
          completed,
          total: installable.length,
          status: "ready",
          message: `${pkg.displayName} is ready (${plan.files.length} target directories)`,
        });
        return {
          package: pkg,
          plan,
          metadata: {
            repository: fetched.repository,
            resolvedCommit: fetched.commit,
            reviewed: true,
          },
          safety,
        };
      } catch (error) {
        completed += 1;
        const reason = error instanceof Error ? error.message : String(error);
        options.onProgress?.({
          packageId: pkg.id,
          completed,
          total: installable.length,
          status: "skipped",
          message: `${pkg.displayName} could not be prepared: ${reason}`,
        });
        return { packageId: pkg.id, reason, kind: "preparation-failed" };
      }
    },
  );
  const entries = prepared.filter(
    (item): item is CatalogInstallEntry => "plan" in item,
  );
  skipped.push(
    ...prepared.filter((item): item is CatalogInstallSkip => !("plan" in item)),
  );
  // Broad collections frequently publish the same conventional skill name.
  // Resolution order is already deterministic and evidence-ranked, so keep
  // the first source for a target and defer only the lower-ranked duplicate
  // instead of overwriting it or blocking every other useful skill.
  const claimedTargets = new Map<string, string>();
  const collisions: CatalogInstallCollision[] = [];
  for (const entry of entries) {
    entry.plan.files = entry.plan.files.filter((file) => {
      const keptPackageId = claimedTargets.get(file.target);
      if (!keptPackageId) {
        claimedTargets.set(file.target, entry.plan.packageId);
        return true;
      }
      collisions.push({
        target: file.target,
        keptPackageId,
        deferredPackageId: entry.plan.packageId,
      });
      return false;
    });
  }
  const usableEntries = entries.filter((entry) => {
    if (entry.plan.files.length) return true;
    skipped.push({
      packageId: entry.plan.packageId,
      kind: "overlap",
      reason:
        "Every discovered skill overlaps a higher-ranked reviewed package.",
    });
    return false;
  });
  return {
    selection,
    resolution,
    agents,
    entries: usableEntries,
    skipped,
    collisions,
  };
}

export function formatPreparedCatalogInstall(
  prepared: PreparedCatalogInstall,
): string {
  const targetDirectories = prepared.entries.reduce(
    (total, entry) => total + entry.plan.files.length,
    0,
  );
  const directoriesPerAgent = prepared.agents.length
    ? Math.ceil(targetDirectories / prepared.agents.length)
    : 0;
  const risky = prepared.entries.filter(
    (entry) => entry.safety.approvalRequired,
  );
  const explicit = prepared.skipped.filter(
    (item) => item.kind === "explicit-setup",
  );
  const failures = prepared.skipped.filter(
    (item) => item.kind === "preparation-failed",
  );
  const lines = [
    `Loadout: ${prepared.selection.mode === "maximum" ? "Maximum Library" : prepared.selection.mode === "power" ? "Power Boost" : prepared.selection.mode === "stable" ? "Stable Boost" : "Custom"}`,
    `Detected agents: ${prepared.agents.map((agent) => agent.displayName).join(", ")}`,
    `Catalog selection: ${prepared.resolution.packages.length} repositories`,
    `Ready to install: ${prepared.entries.length} skill repositories (${targetDirectories} agent skill directories)`,
    `Explicit setup later: ${explicit.length} repository/repositories`,
  ];
  if (directoriesPerAgent > RECOMMENDED_ACTIVE_SKILL_LIMIT)
    lines.push(
      `Capacity warning: about ${directoriesPerAgent} skill directories per agent exceeds the recommended active-set limit of ${RECOMMENDED_ACTIVE_SKILL_LIMIT}.${prepared.selection.mode === "maximum" ? " Maximum stores these in the disabled library; use project activation to choose the working set." : " Prefer Stable or project-aware activation for smaller context."}`,
    );
  if (failures.length)
    lines.push(
      `Preparation failures (installation will remain blocked): ${failures.map((item) => item.packageId).join(", ")}`,
    );
  if (prepared.collisions.length)
    lines.push(
      `Overlapping skill targets resolved: ${prepared.collisions.length} lower-ranked duplicate directories deferred`,
    );
  if (risky.length)
    lines.push(
      `Additional risk approval required: ${risky.map((entry) => entry.package.id).join(", ")}`,
    );
  for (const warning of prepared.resolution.warnings)
    lines.push(`Warning: ${warning}`);
  for (const item of prepared.skipped)
    lines.push(
      `${item.kind === "preparation-failed" ? "Failed" : "Deferred"} ${item.packageId}: ${item.reason}`,
    );
  return lines.join("\n");
}

export async function applyPreparedCatalogInstall(
  prepared: PreparedCatalogInstall,
  options: { approveRisk?: boolean } = {},
): Promise<string> {
  if (!prepared.entries.length)
    throw new Error(
      "No reviewed skill packages could be prepared for installation",
    );
  const failures = prepared.skipped.filter(
    (item) => item.kind === "preparation-failed",
  );
  if (failures.length)
    throw new Error(
      `Setup is incomplete because reviewed packages failed to prepare: ${failures.map((item) => item.packageId).join(", ")}. Retry when GitHub is reachable; no partial loadout was installed.`,
    );
  const risky = prepared.entries.filter(
    (entry) => entry.safety.approvalRequired,
  );
  if (risky.length && !options.approveRisk)
    throw new Error(
      `Additional risk approval is required for: ${risky.map((entry) => entry.package.id).join(", ")}. Review the plan, then use --approve-risk.`,
    );
  return prepared.selection.mode === "maximum"
    ? applySkillLibraryBatch(prepared.entries)
    : applySkillInstallBatch(prepared.entries);
}
