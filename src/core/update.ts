import type { InstallRecord } from "../shared/types.js";
import { fetchRepositorySnapshot } from "./source.js";
import { repositoryCachePath } from "./source.js";
import { diffRepositorySnapshots, type ChangedFileDiff } from "./diff.js";
import { readInstallState } from "./state.js";
import { analyzeUpdateSafety, type SafetyFinding } from "./safety.js";

export type UpdateStatus = "update-available" | "up-to-date" | "untracked" | "error";

export interface UpdatePlan {
  packageId: string;
  repository?: string;
  installedCommit?: string;
  availableCommit?: string;
  targetAgents: string[];
  status: UpdateStatus;
  action: string;
  /** Safe file-level summary when both revisions are cached locally. */
  diff?: ChangedFileDiff[];
  /** Updates containing executable or lifecycle changes require explicit approval. */
  approvalRequired?: boolean;
  safetyFindings?: SafetyFinding[];
  error?: string;
}

export type CommitResolver = (repository: string) => Promise<{ commit: string; path?: string }>;

/** Builds a read-only update plan from persisted installs and live GitHub snapshots. */
export async function buildUpdatePlan(
  resolver: CommitResolver = async (repository) => fetchRepositorySnapshot(repository)
): Promise<UpdatePlan[]> {
  const state = await readInstallState();
  return Promise.all(state.installs.map(async (record): Promise<UpdatePlan> => {
    const base = {
      packageId: record.packageId,
      repository: record.repository,
      installedCommit: record.resolvedCommit,
      targetAgents: record.targetAgents
    };
    if (!record.repository || !record.resolvedCommit) {
      return { ...base, status: "untracked", action: "Reinstall from the original source to begin update tracking." };
    }
    try {
      const current = await resolver(record.repository);
      const same = current.commit.toLowerCase() === record.resolvedCommit.toLowerCase();
      let diff: ChangedFileDiff[] | undefined;
      let safetyFindings: SafetyFinding[] | undefined;
      let approvalRequired = false;
      if (!same && current.path) {
        const oldPath = repositoryCachePath(record.repository, record.resolvedCommit);
        diff = await diffRepositorySnapshots(oldPath, current.path);
        const safety = await analyzeUpdateSafety(oldPath, current.path);
        safetyFindings = safety.findings;
        approvalRequired = safety.approvalRequired;
      }
      return {
        ...base,
        availableCommit: current.commit,
        status: same ? "up-to-date" : "update-available",
        action: same ? "No action required." : approvalRequired
          ? `Approval required: review safety warnings before updating ${record.packageId}.`
          : `Run loadout update --package ${record.packageId} after review.`,
        ...(approvalRequired ? { approvalRequired: true } : {}),
        ...(safetyFindings?.length ? { safetyFindings } : {}),
        ...(diff ? { diff } : {})
      };
    } catch (error) {
      return {
        ...base,
        status: "error",
        action: "Retry when GitHub is reachable; the installed version was not changed.",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }));
}

export function formatUpdatePlan(plans: UpdatePlan[]): string {
  if (plans.length === 0) return "No tracked installations found.";
  return plans.map((plan) => {
    const suffix = plan.error ? ` — ${plan.error}` : "";
    const repo = plan.repository ? ` (${plan.repository})` : "";
    const safety = plan.safetyFindings?.map((finding) => ` [${finding.severity}] ${finding.message}${finding.names?.length ? ` (${finding.names.join(", ")})` : ""}`).join("") ?? "";
    return `${plan.status.toUpperCase()} ${plan.packageId}${repo}: ${plan.action}${safety}${suffix}`;
  }).join("\n");
}
