import type { InstallRecord } from "../shared/types.js";
import { fetchRepositorySnapshot } from "./source.js";
import { readInstallState } from "./state.js";

export type UpdateStatus = "update-available" | "up-to-date" | "untracked" | "error";

export interface UpdatePlan {
  packageId: string;
  repository?: string;
  installedCommit?: string;
  availableCommit?: string;
  targetAgents: string[];
  status: UpdateStatus;
  action: string;
  error?: string;
}

export type CommitResolver = (repository: string) => Promise<{ commit: string }>;

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
      return {
        ...base,
        availableCommit: current.commit,
        status: same ? "up-to-date" : "update-available",
        action: same ? "No action required." : `Run loadout update --package ${record.packageId} after review.`
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
    return `${plan.status.toUpperCase()} ${plan.packageId}${repo}: ${plan.action}${suffix}`;
  }).join("\n");
}
