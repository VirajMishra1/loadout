import { dirname } from "node:path";
import { writeFileAtomically } from "./atomic-file.js";
import { ensureDirectory } from "./paths.js";
import { readInstallState } from "./state.js";

export interface PrivacySafeLoadoutReport {
  schemaVersion: 1;
  generatedAt: string;
  packages: Array<{
    id: string;
    commit?: string;
    agents: string[];
    managedFiles: number;
    activeSkills: number;
    disabledSkills: number;
    reviewedSkills: number;
    unreviewedSkills: number;
  }>;
  mcp: Array<{
    packageId: string;
  }>;
  privacy: {
    excludes: string[];
  };
}

export async function buildPrivacySafeReport(): Promise<PrivacySafeLoadoutReport> {
  const state = await readInstallState();
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    packages: state.installs
      .map((install) => {
        const activations = (state.activations ?? []).filter(
          (item) => item.packageId === install.packageId,
        );
        return {
          id: install.packageId,
          ...(install.resolvedCommit ? { commit: install.resolvedCommit } : {}),
          agents: [...install.targetAgents].sort(),
          managedFiles: install.files.length,
          activeSkills: activations.filter(
            (item) => item.activationState === "active",
          ).length,
          disabledSkills: activations.filter(
            (item) => item.activationState === "disabled",
          ).length,
          reviewedSkills: activations.filter(
            (item) => item.reviewState === "reviewed",
          ).length,
          unreviewedSkills: activations.filter(
            (item) => item.reviewState !== "reviewed",
          ).length,
        };
      })
      .sort((left, right) => left.id.localeCompare(right.id)),
    mcp: (state.mcpInstalls ?? [])
      .map((item) => ({ packageId: item.packageId }))
      .filter(
        (item, index, values) =>
          values.findIndex(
            (candidate) => candidate.packageId === item.packageId,
          ) === index,
      )
      .sort((left, right) => left.packageId.localeCompare(right.packageId)),
    privacy: {
      excludes: [
        "usernames",
        "absolute paths",
        "project names",
        "repository names",
        "prompts",
        "source code",
        "filenames",
        "credential values",
      ],
    },
  };
}

export async function writePrivacySafeReport(
  path: string,
  report: PrivacySafeLoadoutReport,
): Promise<void> {
  await ensureDirectory(dirname(path));
  await writeFileAtomically(path, `${JSON.stringify(report, null, 2)}\n`);
}

export function formatPrivacySafeReport(
  report: PrivacySafeLoadoutReport,
): string {
  return [
    `Shareable Loadout report: ${report.packages.length} package(s), ${report.mcp.length} MCP entry/entries`,
    ...report.packages.map(
      (item) =>
        `${item.id} — ${item.commit?.slice(0, 12) ?? "local"} — agents:${item.agents.join(",")} — skills:${item.activeSkills} active/${item.disabledSkills} disabled`,
    ),
    "Privacy: no local paths, project names, source filenames/content, prompts, or credential values.",
  ].join("\n");
}
