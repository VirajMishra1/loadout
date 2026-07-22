import type {
  AgentId,
  CatalogPackage,
  DetectedAgent,
} from "../shared/types.js";
import { DEFAULT_ACTIVE_SKILL_LIMIT } from "./active-limit.js";
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
  planManagedProfileReconciliation,
  type InstallBatchEntry,
  type ManagedProfileReconciliation,
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
import { formatModelApiAccess, type SetupAccessProfile } from "./access.js";
import { recordInstalledProfile } from "./profile-state.js";
import { readInstallState } from "./state.js";

export interface CatalogInstallEntry extends InstallBatchEntry {
  package: CatalogPackage;
  safety: UpdateSafetyAnalysis;
}

export interface CatalogInstallSkip {
  packageId: string;
  unitId?: string;
  reason: string;
  kind: "explicit-setup" | "preparation-failed" | "overlap" | "quarantined";
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
  additive?: boolean;
  resolution: ProfileResolution;
  agents: DetectedAgent[];
  entries: CatalogInstallEntry[];
  skipped: CatalogInstallSkip[];
  collisions: CatalogInstallCollision[];
  access: SetupAccessProfile;
  reconciliation?: ManagedProfileReconciliation;
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
  access?: SetupAccessProfile;
  /** Add selected Custom packages without retiring the current managed profile. */
  additive?: boolean;
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
    async (
      pkg,
    ): Promise<{
      result?: CatalogInstallEntry | CatalogInstallSkip;
      quarantined: CatalogInstallSkip[];
    }> => {
      const rejected = new Map<string, CatalogInstallSkip>();
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
        const quarantineOptions =
          selection.mode === "maximum" || selection.mode === "power"
            ? {
                continueOnRejected: true,
                onRejected: (skill: {
                  name?: string;
                  targetName: string;
                  reason: string;
                }) => {
                  const unitId = skill.name ?? skill.targetName;
                  rejected.set(unitId, {
                    packageId: pkg.id,
                    unitId,
                    kind: "quarantined",
                    reason: skill.reason,
                  });
                },
              }
            : {};
        const plan = await buildSkillPlan(fetched.path, pkg.id, agents, {
          ...(include ? { include } : {}),
          ...quarantineOptions,
        });
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
          result: {
            package: pkg,
            plan,
            metadata: {
              repository: fetched.repository,
              resolvedCommit: fetched.commit,
              reviewed: true,
              staticAssessment: {
                status: safety.approvalRequired
                  ? "blocking"
                  : safety.findings.length
                    ? "warning"
                    : "clear",
                findingCount: safety.findings.length,
                assessedAt: new Date().toISOString(),
                policy: "install-safety-v1",
              },
            },
            safety,
          },
          quarantined: [...rejected.values()],
        };
      } catch (error) {
        completed += 1;
        const reason = error instanceof Error ? error.message : String(error);
        const fullyQuarantined =
          rejected.size > 0 && /No SKILL\.md found/.test(reason);
        options.onProgress?.({
          packageId: pkg.id,
          completed,
          total: installable.length,
          status: "skipped",
          message: fullyQuarantined
            ? `${pkg.displayName}: all ${rejected.size} discovered skill unit(s) were quarantined`
            : `${pkg.displayName} could not be prepared: ${reason}`,
        });
        if (fullyQuarantined) return { quarantined: [...rejected.values()] };
        return {
          result: {
            packageId: pkg.id,
            reason,
            kind: "preparation-failed",
          },
          quarantined: [...rejected.values()],
        };
      }
    },
  );
  const preparedResults = prepared.flatMap((item) =>
    item.result ? [item.result] : [],
  );
  const entries = preparedResults.filter(
    (item): item is CatalogInstallEntry => "plan" in item,
  );
  skipped.push(
    ...preparedResults.filter(
      (item): item is CatalogInstallSkip => !("plan" in item),
    ),
    ...prepared.flatMap((item) => item.quarantined),
  );
  // Broad collections frequently publish the same conventional skill name.
  // Resolution order is already deterministic and evidence-ranked, so keep
  // the first source for a target and defer only the lower-ranked duplicate
  // instead of overwriting it or blocking every other useful skill. Maximum
  // must reserve targets already owned by active managed units before applying
  // that ordinary ranking, or a higher-ranked overlapping package can remove
  // the source needed to preserve the active unit.
  const reservedTargets = new Map<string, string>();
  if (selection.mode === "maximum") {
    const selectedPackages = new Set(
      entries.map((entry) => entry.plan.packageId),
    );
    const state = await readInstallState();
    for (const activation of state.activations ?? []) {
      if (
        !selectedPackages.has(activation.packageId) ||
        activation.installationState !== "installed" ||
        activation.activationState !== "active"
      )
        continue;
      for (const target of activation.targets) {
        const owner = reservedTargets.get(target.activePath);
        if (owner && owner !== activation.packageId)
          throw new Error(
            `Maximum Library cannot reserve active target '${target.activePath}' because it is claimed by both '${owner}' and '${activation.packageId}'.`,
          );
        reservedTargets.set(target.activePath, activation.packageId);
      }
    }
  }
  const claimedTargets = new Map<string, string>();
  const collisions: CatalogInstallCollision[] = [];
  for (const entry of entries) {
    entry.plan.files = entry.plan.files.filter((file) => {
      const reservedPackageId = reservedTargets.get(file.target);
      if (reservedPackageId && reservedPackageId !== entry.plan.packageId) {
        collisions.push({
          target: file.target,
          keptPackageId: reservedPackageId,
          deferredPackageId: entry.plan.packageId,
        });
        return false;
      }
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
  const reconciliation =
    selection.mode === "maximum" || options.additive
      ? {
          obsoleteActivationKeys: [],
          obsoletePackageIds: [],
          obsoleteTargets: [],
          obsoleteUnits: [],
        }
      : await planManagedProfileReconciliation(usableEntries);
  return {
    selection,
    additive: options.additive ?? false,
    resolution,
    agents,
    entries: usableEntries,
    skipped,
    collisions,
    access: options.access ?? { modelApis: [] },
    reconciliation,
  };
}

export function formatPreparedCatalogInstall(
  prepared: PreparedCatalogInstall,
  options: { details?: boolean } = {},
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
  const quarantined = prepared.skipped.filter(
    (item) => item.kind === "quarantined",
  );
  const retired = prepared.reconciliation?.obsoleteUnits ?? [];
  const lines = [
    `Loadout: ${prepared.selection.mode === "maximum" ? "Maximum Library" : prepared.selection.mode === "power" ? "Power Boost" : prepared.selection.mode === "stable" ? "Stable Boost" : "Custom"}`,
    `Detected agents: ${prepared.agents.map((agent) => agent.displayName).join(", ")}`,
    `Catalog selection: ${prepared.resolution.packages.length} repositories`,
    `Ready to install: ${prepared.entries.length} skill repositories (${targetDirectories} agent skill directories)`,
    `Explicit setup later: ${explicit.length} repository/repositories`,
    `Separately billed model API access: ${formatModelApiAccess(prepared.access)} (ChatGPT and Claude subscriptions do not count as API access)`,
    "Automatic skill setup does not require an OpenAI, Anthropic, or OpenRouter API key; credentialed MCP/runtime integrations remain explicit and deferred.",
  ];
  if (prepared.additive)
    lines.push("Additive install: existing managed skills will stay active.");
  if (directoriesPerAgent > DEFAULT_ACTIVE_SKILL_LIMIT)
    lines.push(
      `Capacity notice: about ${directoriesPerAgent} skill directories per agent exceeds Stable's ${DEFAULT_ACTIVE_SKILL_LIMIT}-skill bound.${prepared.selection.mode === "maximum" ? " Maximum stores them in the disabled library; optimize or activate a project-relevant working set." : prepared.selection.mode === "power" ? " Power is the explicit larger active mode; choose Stable or project optimization when lower context use matters." : " Use project-aware activation for a smaller working set."}`,
    );
  if (failures.length)
    lines.push(
      `Preparation failures (installation will remain blocked): ${failures.map((item) => item.packageId).join(", ")}`,
    );
  if (quarantined.length)
    lines.push(
      `Quarantined invalid skill units: ${quarantined.length} (safe siblings remain available)`,
    );
  if (explicit.length)
    lines.push(
      `Deferred integration setup: ${explicit.length} record(s) remain opt-in through MCP/runtime commands.`,
    );
  if (prepared.collisions.length)
    lines.push(
      `Overlapping skill targets resolved: ${prepared.collisions.length} lower-ranked duplicate directories deferred`,
    );
  if (retired.length) {
    lines.push(
      `Profile reconciliation: ${retired.length} active managed skill${retired.length === 1 ? "" : "s"} will be retired from the selected agents.`,
    );
    for (const item of retired)
      lines.push(
        `Retire ${item.packageId}${item.unitId ? `/${item.unitId}` : ""} from ${item.agent}`,
      );
  }
  if (risky.length)
    lines.push(
      options.details
        ? `Additional risk approval required: ${risky.map((entry) => entry.package.id).join(", ")}`
        : `Additional risk approval required for ${risky.length} repositor${risky.length === 1 ? "y" : "ies"}. Run the preview with --details before approval.`,
    );
  for (const warning of prepared.resolution.warnings)
    lines.push(`Warning: ${warning}`);
  if (failures.length)
    for (const item of failures)
      lines.push(
        `Failed ${item.packageId}${item.unitId ? `/${item.unitId}` : ""}: ${item.reason}`,
      );
  if (options.details)
    for (const item of prepared.skipped.filter(
      (item) => item.kind !== "preparation-failed",
    ))
      lines.push(
        `${item.kind === "quarantined" ? "Quarantined" : "Deferred"} ${item.packageId}${item.unitId ? `/${item.unitId}` : ""}: ${item.reason}`,
      );
  else if (quarantined.length || explicit.length)
    lines.push("Use --details to show every quarantined or deferred unit.");
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
    ? applySkillLibraryBatch(prepared.entries, {
        afterRecord: () =>
          recordInstalledProfile(prepared).then(() => undefined),
      })
    : applySkillInstallBatch(prepared.entries, [], {
        replaceManagedTargets: true,
        reconcileManagedTargets: !prepared.additive,
        ...(prepared.reconciliation
          ? { expectedReconciliation: prepared.reconciliation }
          : {}),
        ...(prepared.additive
          ? {}
          : {
              afterRecord: () =>
                recordInstalledProfile(prepared).then(() => undefined),
            }),
      });
}

export function formatCatalogApplyGuidance(
  riskApprovalRequired: boolean,
): string {
  return riskApprovalRequired
    ? "Preview complete; nothing was changed. Inspect the plan with --details, then re-run with --yes --approve-risk only if you accept every reported finding."
    : "Preview complete; nothing was changed. Re-run with --yes to install this exact screened plan.";
}
