import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fetchRepositorySnapshot, resolveRepositoryHead } from "./source.js";
import { repositoryCachePath } from "./source.js";
import { diffRepositorySnapshots, type ChangedFileDiff } from "./diff.js";
import { hashDirectory, readInstallState } from "./state.js";
import { analyzeUpdateSafety, type SafetyFinding } from "./safety.js";
import { detectAgents, loadoutHome } from "./paths.js";
import {
  applySkillInstall,
  buildSkillPlan,
  installedAgents,
} from "./install.js";
import {
  discoverSkillDirectories,
  validateSkillDirectory,
  type DiscoverSkillOptions,
} from "./skills.js";
import type {
  DetectedAgent,
  InstallPlan,
  InstallState,
} from "../shared/types.js";

export type UpdateStatus =
  "update-available" | "up-to-date" | "untracked" | "error";

export interface UpdatePlan {
  packageId: string;
  repository?: string;
  installedCommit?: string;
  availableCommit?: string;
  targetAgents: string[];
  disabledAgents?: string[];
  /** Number of disabled per-agent skill copies represented by this package. */
  disabledUnits?: number;
  status: UpdateStatus;
  action: string;
  /** Safe file-level summary when both revisions are cached locally. */
  diff?: ChangedFileDiff[];
  /** Updates containing executable or lifecycle changes require explicit approval. */
  approvalRequired?: boolean;
  safetyFindings?: SafetyFinding[];
  /** Set only when a blocked update was explicitly quarantined for later review. */
  quarantinePath?: string;
  error?: string;
}

export type CommitResolver = (
  repository: string,
) => Promise<{ commit: string; path?: string }>;

export interface UpdatePlanOptions {
  /** Limit a read-only update check to one explicitly managed package. */
  packageId?: string;
  /** Bound concurrent repository checks for large Maximum libraries. */
  concurrency?: number;
  onProgress?: (progress: {
    completed: number;
    total: number;
    packageId: string;
  }) => void;
  /** Injectable lightweight HEAD resolver used by deterministic tests. */
  resolveHead?: CommitResolver;
  /** Injectable changed-revision fetcher used by deterministic tests. */
  fetchChangedSnapshot?: CommitResolver;
}

export interface UpdateSmokeTestContext {
  packageId: string;
  commit: string;
  plan: InstallPlan;
  snapshotId: string;
}

/**
 * Dependencies are injectable for the fully local safety regression suite.
 * Production callers use the defaults, which never execute package code.
 */
export interface UpdateRuntime {
  fetchSnapshot?: (
    repository: string,
  ) => Promise<{ repository: string; commit: string; path: string }>;
  detectAgents?: () => Promise<DetectedAgent[]>;
  buildPlan?: (
    source: string,
    packageId: string,
    agents: DetectedAgent[],
    options?: DiscoverSkillOptions,
  ) => Promise<InstallPlan>;
  verify?: (context: UpdateSmokeTestContext) => Promise<void>;
}

function managedUnitIds(state: InstallState, packageId: string): string[] {
  return [
    ...new Set(
      (state.activations ?? [])
        .filter(
          (activation) =>
            activation.packageId === packageId &&
            activation.installationState === "installed",
        )
        .map(
          (activation) =>
            activation.unitId ??
            basename(activation.targets[0]?.activePath ?? packageId),
        )
        .filter(Boolean),
    ),
  ].sort();
}

async function locateManagedSkills(
  root: string,
  unitIds: string[],
): Promise<Map<string, string>> {
  const normalized = new Map(
    unitIds.map((unitId) => [unitId.toLowerCase(), unitId]),
  );
  const located = new Map<string, string>();
  await discoverSkillDirectories(root, {
    validate: false,
    include: (skill) => {
      const unitId =
        (skill.name ? normalized.get(skill.name.toLowerCase()) : undefined) ??
        normalized.get(skill.targetName.toLowerCase());
      if (!unitId) return false;
      located.set(unitId, skill.path);
      return true;
    },
  });
  return located;
}

async function analyzeManagedUpdate(
  oldRoot: string,
  newRoot: string,
  unitIds: string[],
): Promise<{
  diff: ChangedFileDiff[];
  safetyFindings: SafetyFinding[];
  approvalRequired: boolean;
}> {
  if (!unitIds.length) {
    const [diff, safety] = await Promise.all([
      diffRepositorySnapshots(oldRoot, newRoot),
      analyzeUpdateSafety(oldRoot, newRoot),
    ]);
    return {
      diff,
      safetyFindings: safety.findings,
      approvalRequired: safety.approvalRequired,
    };
  }
  const [oldSkills, newSkills] = await Promise.all([
    locateManagedSkills(oldRoot, unitIds),
    locateManagedSkills(newRoot, unitIds),
  ]);
  const diff: ChangedFileDiff[] = [];
  const findings: SafetyFinding[] = [];
  for (const unitId of unitIds) {
    const oldPath = oldSkills.get(unitId);
    const newPath = newSkills.get(unitId);
    if (!oldPath || !newPath) {
      findings.push({
        severity: "blocking",
        category: "instruction",
        message: `Managed skill '${unitId}' is missing from one update revision.`,
        paths: [unitId],
      });
      continue;
    }
    diff.push(
      ...(await diffRepositorySnapshots(oldPath, newPath)).map((item) => ({
        ...item,
        path: `${unitId}/${item.path}`,
      })),
    );
    const safety = await analyzeUpdateSafety(oldPath, newPath);
    findings.push(
      ...safety.findings.map((finding) => ({
        ...finding,
        paths: finding.paths.map((path) => `${unitId}/${path}`),
      })),
    );
  }
  const unique = new Map<string, SafetyFinding>();
  for (const finding of findings)
    unique.set(
      `${finding.severity}:${finding.category}:${finding.message}:${finding.paths.join(",")}:${finding.names?.join(",") ?? ""}`,
      finding,
    );
  const safetyFindings = [...unique.values()];
  return {
    diff,
    safetyFindings,
    approvalRequired: safetyFindings.some(
      (finding) => finding.severity === "blocking",
    ),
  };
}

/** Builds a read-only update plan from persisted installs and live GitHub snapshots. */
export async function buildUpdatePlan(
  resolver?: CommitResolver,
  options: UpdatePlanOptions = {},
): Promise<UpdatePlan[]> {
  const state = await readInstallState();
  const records = options.packageId
    ? state.installs.filter((record) => record.packageId === options.packageId)
    : state.installs;
  const results = new Array<UpdatePlan>(records.length);
  const lightweightResolver: CommitResolver =
    resolver ??
    options.resolveHead ??
    ((repository: string) =>
      resolveRepositoryHead(repository, { timeoutMs: 30_000 }));
  const resolutions = new Map<
    string,
    Promise<{ commit: string; path?: string }>
  >();
  const resolveOnce = (repository: string) => {
    const existing = resolutions.get(repository);
    if (existing) return existing;
    const pending = lightweightResolver(repository);
    resolutions.set(repository, pending);
    return pending;
  };
  const changedSnapshots = new Map<
    string,
    Promise<{ commit: string; path?: string }>
  >();
  const fetchChangedOnce = (repository: string, commit: string) => {
    const key = `${repository}\0${commit.toLowerCase()}`;
    const existing = changedSnapshots.get(key);
    if (existing) return existing;
    const pending = options.fetchChangedSnapshot
      ? options.fetchChangedSnapshot(repository)
      : fetchRepositorySnapshot(repository, {
          ref: commit,
          timeoutMs: 120_000,
        });
    changedSnapshots.set(key, pending);
    return pending;
  };
  let cursor = 0;
  let completed = 0;
  const workers = Array.from(
    {
      length: Math.min(
        Math.max(1, options.concurrency ?? 4),
        Math.max(1, records.length),
      ),
    },
    async () => {
      while (cursor < records.length) {
        const index = cursor++;
        const record = records[index];
        results[index] = await (async (): Promise<UpdatePlan> => {
          const disabledActivations = (state.activations ?? []).filter(
            (activation) =>
              activation.packageId === record.packageId &&
              activation.installationState === "installed" &&
              activation.activationState === "disabled",
          );
          const disabledAgents = [
            ...new Set(
              disabledActivations.map((activation) => activation.agent),
            ),
          ].sort();
          const base = {
            packageId: record.packageId,
            repository: record.repository,
            installedCommit: record.resolvedCommit,
            targetAgents: record.targetAgents,
            ...(disabledAgents.length ? { disabledAgents } : {}),
            ...(disabledActivations.length
              ? { disabledUnits: disabledActivations.length }
              : {}),
          };
          if (!record.repository || !record.resolvedCommit) {
            return {
              ...base,
              status: "untracked",
              action:
                "Reinstall from the original source to begin update tracking.",
            };
          }
          try {
            const current = await resolveOnce(record.repository);
            const same =
              current.commit.toLowerCase() ===
              record.resolvedCommit.toLowerCase();
            let diff: ChangedFileDiff[] | undefined;
            let safetyFindings: SafetyFinding[] | undefined;
            let approvalRequired = false;
            let currentPath = current.path;
            if (!same && !currentPath && !resolver) {
              const fetched = await fetchChangedOnce(
                record.repository,
                current.commit,
              );
              if (fetched.commit.toLowerCase() !== current.commit.toLowerCase())
                throw new Error(
                  `Resolved ${current.commit}, but fetched ${fetched.commit} for safety review`,
                );
              currentPath = fetched.path;
            }
            if (!same && currentPath) {
              const oldPath = repositoryCachePath(
                record.repository,
                record.resolvedCommit,
              );
              const analysis = await analyzeManagedUpdate(
                oldPath,
                currentPath,
                managedUnitIds(state, record.packageId),
              );
              diff = analysis.diff;
              safetyFindings = analysis.safetyFindings;
              approvalRequired = analysis.approvalRequired;
            }
            return {
              ...base,
              availableCommit: current.commit,
              status: same ? "up-to-date" : "update-available",
              action: same
                ? "No action required."
                : disabledAgents.length
                  ? `A newer upstream commit exists, but ${disabledActivations.length} reviewed library ${disabledActivations.length === 1 ? "copy is" : "copies are"} disabled for ${disabledAgents.join(" and ")}. Nothing active changed; Loadout will not update or reactivate disabled skills automatically.`
                  : approvalRequired
                    ? `Approval required: review safety warnings before updating ${record.packageId}.`
                    : `Run loadout update --package ${record.packageId} --yes after review.`,
              ...(approvalRequired ? { approvalRequired: true } : {}),
              ...(safetyFindings?.length ? { safetyFindings } : {}),
              ...(diff ? { diff } : {}),
            };
          } catch (error) {
            return {
              ...base,
              status: "error",
              action:
                "Retry when GitHub is reachable; the installed version was not changed.",
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })();
        completed += 1;
        options.onProgress?.({
          completed,
          total: records.length,
          packageId: record.packageId,
        });
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export function formatUpdatePlan(plans: UpdatePlan[]): string {
  if (plans.length === 0) return "No tracked installations found.";
  const available = plans.filter((plan) => plan.status === "update-available");
  const activeAvailable = available.filter(
    (plan) => !plan.disabledAgents?.length,
  );
  const disabledAvailable = available.filter((plan) =>
    Boolean(plan.disabledAgents?.length),
  );
  const current = plans.filter((plan) => plan.status === "up-to-date");
  const unavailable = plans.filter(
    (plan) => plan.status === "error" || plan.status === "untracked",
  );
  const lines = [
    `Update check: ${activeAvailable.length} active update(s), ${disabledAvailable.length} disabled-library update(s), ${current.length} current, ${unavailable.length} unavailable.`,
  ];
  const visible =
    plans.length === 1
      ? plans
      : plans.filter((plan) => plan.status !== "up-to-date");
  lines.push(
    ...visible.map((plan) => {
      const suffix = plan.error ? ` — ${plan.error}` : "";
      const repo = plan.repository ? ` (${plan.repository})` : "";
      const findingCounts = new Map<string, number>();
      for (const finding of plan.safetyFindings ?? []) {
        const key = `${finding.severity} ${finding.category}`;
        findingCounts.set(key, (findingCounts.get(key) ?? 0) + 1);
      }
      const safety = findingCounts.size
        ? ` Safety review: ${[...findingCounts.entries()]
            .map(([key, count]) => `${key}${count > 1 ? ` ×${count}` : ""}`)
            .join(
              ", ",
            )}. Run loadout update --package ${plan.packageId} for the focused review.`
        : "";
      return `${plan.status.toUpperCase()} ${plan.packageId}${repo}: ${plan.action}${safety}${suffix}`;
    }),
  );
  if (current.length && plans.length > 1)
    lines.push(
      `Current packages hidden for readability (${current.length}); use --json for every record.`,
    );
  return lines.join("\n");
}

/** Updates safe enough for an explicit whole-profile `update --yes` apply. */
export function selectSafeAutomaticUpdates(plans: UpdatePlan[]): UpdatePlan[] {
  return plans.filter(
    (plan) =>
      plan.status === "update-available" &&
      !plan.approvalRequired &&
      !plan.disabledAgents?.length,
  );
}

function quarantineRoot(): string {
  return join(loadoutHome(), "quarantine");
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 160) || "update";
}

/**
 * Record a blocked update in an isolated review directory. This writes metadata
 * only; it never installs files, imports configuration, or executes repository code.
 */
export async function quarantineUpdate(
  packageId: string,
  repository: string,
  commit: string,
  findings: SafetyFinding[],
): Promise<string> {
  const directory = join(
    quarantineRoot(),
    `${safeName(packageId)}-${safeName(commit)}`,
  );
  await mkdir(directory, { recursive: true });
  const metadata = join(directory, "metadata.json");
  await writeFile(
    metadata,
    JSON.stringify(
      {
        packageId,
        repository,
        commit,
        quarantinedAt: new Date().toISOString(),
        findings: findings.map(
          ({ severity, category, message, paths, names }) => ({
            severity,
            category,
            message,
            paths,
            ...(names?.length ? { names } : {}),
          }),
        ),
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  return directory;
}

/**
 * Verify copied skill metadata only. This is deliberately static: Loadout does
 * not run hooks, lifecycle scripts, MCP servers, or any repository code while
 * applying an update.
 */
async function verifyInstalledSkills(
  context: UpdateSmokeTestContext,
): Promise<void> {
  for (const file of context.plan.files)
    await validateSkillDirectory(file.target);
}

/**
 * Apply an already reviewed package update. A failed post-copy verification
 * restores the transaction snapshot, including the previous install state.
 */
export async function applyPackageUpdate(
  packageId: string,
  options: { approveRisk?: boolean; quarantineOnBlock?: boolean } = {},
  runtime: UpdateRuntime = {},
): Promise<{ snapshotId: string; commit: string }> {
  const state = await readInstallState();
  const record = state.installs.find((item) => item.packageId === packageId);
  if (!record)
    throw new Error(`Package is not managed by Loadout: ${packageId}`);
  const disabledAgents = [
    ...new Set(
      (state.activations ?? [])
        .filter(
          (activation) =>
            activation.packageId === packageId &&
            activation.installationState === "installed" &&
            activation.activationState === "disabled",
        )
        .map((activation) => activation.agent),
    ),
  ].sort();
  const expectedRecord = JSON.stringify(record);
  const expectedActivations = JSON.stringify(
    (state.activations ?? [])
      .filter((activation) => activation.packageId === packageId)
      .sort((left, right) =>
        `${left.agent}\0${left.unitId ?? ""}`.localeCompare(
          `${right.agent}\0${right.unitId ?? ""}`,
        ),
      ),
  );
  if (disabledAgents.length)
    throw new Error(
      `Package '${packageId}' is disabled for ${disabledAgents.join(", ")}. Enable it before updating so an update cannot silently reactivate agent-visible files.`,
    );
  if (!record.repository || !record.resolvedCommit)
    throw new Error(`Package '${packageId}' has no tracked GitHub source`);
  const current = await (runtime.fetchSnapshot ?? fetchRepositorySnapshot)(
    record.repository,
  );
  if (current.commit.toLowerCase() === record.resolvedCommit.toLowerCase())
    throw new Error(`Package '${packageId}' is already up to date`);
  const oldPath = repositoryCachePath(record.repository, record.resolvedCommit);
  const units = managedUnitIds(state, packageId);
  const safety = await analyzeManagedUpdate(oldPath, current.path, units);
  if (safety.approvalRequired && !options.approveRisk) {
    const quarantinePath =
      options.quarantineOnBlock === false
        ? undefined
        : await quarantineUpdate(
            packageId,
            current.repository,
            current.commit,
            safety.safetyFindings,
          );
    throw new Error(
      `Update is blocked pending explicit risk approval${quarantinePath ? `; quarantined at ${quarantinePath}` : ""}: ${safety.safetyFindings
        .filter((finding) => finding.severity === "blocking")
        .map((finding) => finding.message)
        .join(" ")}`,
    );
  }
  const agents = installedAgents(
    await (runtime.detectAgents ?? detectAgents)(),
    record.targetAgents,
  );
  let plan = await (runtime.buildPlan ?? buildSkillPlan)(
    current.path,
    record.packageId,
    agents,
    units.length
      ? {
          include: (skill) =>
            units.some(
              (unitId) =>
                unitId.toLowerCase() === skill.name?.toLowerCase() ||
                unitId.toLowerCase() === skill.targetName.toLowerCase(),
            ),
        }
      : {},
  );
  if (units.length) {
    const activeTargets = new Map(
      (state.activations ?? [])
        .filter(
          (activation) =>
            activation.packageId === packageId &&
            activation.installationState === "installed" &&
            activation.activationState === "active" &&
            activation.unitId,
        )
        .flatMap((activation) =>
          activation.targets.map(
            (target) =>
              [
                `${activation.agent}\0${activation.unitId!.toLowerCase()}`,
                target.activePath,
              ] as const,
          ),
        ),
    );
    plan = {
      ...plan,
      files: plan.files.map((file) => {
        const unitId = file.skillName ?? basename(file.target);
        const target = file.targetAgent
          ? activeTargets.get(`${file.targetAgent}\0${unitId.toLowerCase()}`)
          : undefined;
        return target ? { ...file, target } : file;
      }),
    };
  }
  if (units.length) {
    const plannedUnits = [
      ...new Set(plan.files.map((file) => basename(file.target))),
    ].sort();
    if (
      plannedUnits.length !== units.length ||
      plannedUnits.some(
        (unitId, index) => unitId.toLowerCase() !== units[index].toLowerCase(),
      )
    )
      throw new Error(
        `Update plan changed the managed skill set for '${packageId}'; expected ${units.join(", ")}, received ${plannedUnits.join(", ") || "none"}.`,
      );
  }
  const verifier = runtime.verify ?? verifyInstalledSkills;
  let verificationFailure: unknown;
  let verificationSnapshotId: string | undefined;
  try {
    const snapshotId = await applySkillInstall(
      plan,
      {
        repository: current.repository,
        resolvedCommit: current.commit,
        reviewed: true,
        staticAssessment: {
          status: safety.approvalRequired
            ? "blocking"
            : safety.safetyFindings.length
              ? "warning"
              : "clear",
          findingCount: safety.safetyFindings.length,
          assessedAt: new Date().toISOString(),
          policy: "install-safety-v1",
        },
      },
      {
        allowManagedReplacement: true,
        replaceManagedTargets: true,
        validateCurrentState: async () => {
          const freshState = await readInstallState();
          const freshRecord = freshState.installs.find(
            (entry) => entry.packageId === packageId,
          );
          const freshActivations = (freshState.activations ?? [])
            .filter((activation) => activation.packageId === packageId)
            .sort((left, right) =>
              `${left.agent}\0${left.unitId ?? ""}`.localeCompare(
                `${right.agent}\0${right.unitId ?? ""}`,
              ),
            );
          if (
            JSON.stringify(freshRecord) !== expectedRecord ||
            JSON.stringify(freshActivations) !== expectedActivations
          )
            throw new Error(
              `Package '${packageId}' changed while its update was prepared; build the update plan again`,
            );
          const liveFiles = (
            await Promise.all(
              [...new Set(plan.files.map((file) => file.target))].map(
                hashDirectory,
              ),
            )
          )
            .flat()
            .sort((left, right) => left.path.localeCompare(right.path));
          const expectedFiles = [...record.files].sort((left, right) =>
            left.path.localeCompare(right.path),
          );
          if (JSON.stringify(liveFiles) !== JSON.stringify(expectedFiles))
            throw new Error(
              `Package '${packageId}' files changed while its update was prepared; review local changes before updating`,
            );
        },
        verifyBeforeCommit: async (pendingSnapshotId) => {
          verificationSnapshotId = pendingSnapshotId;
          try {
            await verifier({
              packageId,
              commit: current.commit,
              plan,
              snapshotId: pendingSnapshotId,
            });
          } catch (error) {
            verificationFailure = error;
            throw error;
          }
        },
      },
    );
    return { snapshotId, commit: current.commit };
  } catch (error) {
    if (verificationFailure !== undefined) {
      const detail =
        verificationFailure instanceof Error
          ? verificationFailure.message
          : String(verificationFailure);
      throw new Error(
        `Update verification failed; restored snapshot ${verificationSnapshotId}: ${detail}`,
        { cause: verificationFailure },
      );
    }
    throw error;
  }
}
