import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchRepositorySnapshot } from "./source.js";
import { repositoryCachePath } from "./source.js";
import { diffRepositorySnapshots, type ChangedFileDiff } from "./diff.js";
import { readInstallState } from "./state.js";
import { analyzeUpdateSafety, type SafetyFinding } from "./safety.js";
import { detectAgents, loadoutHome } from "./paths.js";
import {
  applySkillInstall,
  buildSkillPlan,
  installedAgents,
} from "./install.js";
import { readSnapshot, restoreSnapshot } from "./snapshot.js";
import { validateSkillDirectory } from "./skills.js";
import type { DetectedAgent, InstallPlan } from "../shared/types.js";

export type UpdateStatus =
  "update-available" | "up-to-date" | "untracked" | "error";

export interface UpdatePlan {
  packageId: string;
  repository?: string;
  installedCommit?: string;
  availableCommit?: string;
  targetAgents: string[];
  disabledAgents?: string[];
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
  ) => Promise<InstallPlan>;
  applyPlan?: (
    plan: InstallPlan,
    metadata: { repository: string; resolvedCommit: string },
    options?: { allowManagedReplacement?: boolean },
  ) => Promise<string>;
  verify?: (context: UpdateSmokeTestContext) => Promise<void>;
}

/** Builds a read-only update plan from persisted installs and live GitHub snapshots. */
export async function buildUpdatePlan(
  resolver: CommitResolver = async (repository) =>
    fetchRepositorySnapshot(repository),
): Promise<UpdatePlan[]> {
  const state = await readInstallState();
  return Promise.all(
    state.installs.map(async (record): Promise<UpdatePlan> => {
      const disabledAgents = (state.activations ?? [])
        .filter(
          (activation) =>
            activation.packageId === record.packageId &&
            activation.installationState === "installed" &&
            activation.activationState === "disabled",
        )
        .map((activation) => activation.agent);
      const base = {
        packageId: record.packageId,
        repository: record.repository,
        installedCommit: record.resolvedCommit,
        targetAgents: record.targetAgents,
        ...(disabledAgents.length ? { disabledAgents } : {}),
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
        const current = await resolver(record.repository);
        const same =
          current.commit.toLowerCase() === record.resolvedCommit.toLowerCase();
        let diff: ChangedFileDiff[] | undefined;
        let safetyFindings: SafetyFinding[] | undefined;
        let approvalRequired = false;
        if (!same && current.path) {
          const oldPath = repositoryCachePath(
            record.repository,
            record.resolvedCommit,
          );
          diff = await diffRepositorySnapshots(oldPath, current.path);
          const safety = await analyzeUpdateSafety(oldPath, current.path);
          safetyFindings = safety.findings;
          approvalRequired = safety.approvalRequired;
        }
        return {
          ...base,
          availableCommit: current.commit,
          status: same ? "up-to-date" : "update-available",
          action: same
            ? "No action required."
            : disabledAgents.length
              ? `Enable ${record.packageId} for ${disabledAgents.join(", ")} before applying an update; planning remains read-only.`
              : approvalRequired
                ? `Approval required: review safety warnings before updating ${record.packageId}.`
                : `Run loadout update --package ${record.packageId} after review.`,
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
    }),
  );
}

export function formatUpdatePlan(plans: UpdatePlan[]): string {
  if (plans.length === 0) return "No tracked installations found.";
  return plans
    .map((plan) => {
      const suffix = plan.error ? ` — ${plan.error}` : "";
      const repo = plan.repository ? ` (${plan.repository})` : "";
      const safety =
        plan.safetyFindings
          ?.map(
            (finding) =>
              ` [${finding.severity}] ${finding.message}${finding.names?.length ? ` (${finding.names.join(", ")})` : ""}`,
          )
          .join("") ?? "";
      return `${plan.status.toUpperCase()} ${plan.packageId}${repo}: ${plan.action}${safety}${suffix}`;
    })
    .join("\n");
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
  const disabledAgents = (state.activations ?? [])
    .filter(
      (activation) =>
        activation.packageId === packageId &&
        activation.installationState === "installed" &&
        activation.activationState === "disabled",
    )
    .map((activation) => activation.agent);
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
  const safety = await analyzeUpdateSafety(oldPath, current.path);
  if (safety.approvalRequired && !options.approveRisk) {
    const quarantinePath =
      options.quarantineOnBlock === false
        ? undefined
        : await quarantineUpdate(
            packageId,
            current.repository,
            current.commit,
            safety.findings,
          );
    throw new Error(
      `Update is blocked pending explicit risk approval${quarantinePath ? `; quarantined at ${quarantinePath}` : ""}: ${safety.findings
        .filter((finding) => finding.severity === "blocking")
        .map((finding) => finding.message)
        .join(" ")}`,
    );
  }
  const agents = installedAgents(
    await (runtime.detectAgents ?? detectAgents)(),
    record.targetAgents,
  );
  const plan = await (runtime.buildPlan ?? buildSkillPlan)(
    current.path,
    record.packageId,
    agents,
  );
  const snapshotId = await (runtime.applyPlan ?? applySkillInstall)(
    plan,
    {
      repository: current.repository,
      resolvedCommit: current.commit,
    },
    { allowManagedReplacement: true },
  );
  try {
    await (runtime.verify ?? verifyInstalledSkills)({
      packageId,
      commit: current.commit,
      plan,
      snapshotId,
    });
  } catch (error) {
    try {
      await restoreSnapshot(await readSnapshot(snapshotId));
    } catch (rollbackError) {
      const detail =
        rollbackError instanceof Error
          ? rollbackError.message
          : String(rollbackError);
      throw new Error(
        `Update verification failed and automatic rollback also failed for snapshot ${snapshotId}: ${detail}`,
        { cause: error },
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Update verification failed; restored snapshot ${snapshotId}: ${detail}`,
      { cause: error },
    );
  }
  return { snapshotId, commit: current.commit };
}
