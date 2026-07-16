import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import type {
  AgentId,
  CatalogPackage,
  DetectedAgent,
  InstallRecord,
  ManagedActivationRecord,
} from "../shared/types.js";
import {
  buildAgentHealthScore,
  type AgentHealthEvidence,
  type AgentHealthPackageEvidence,
  type AgentHealthScore,
} from "./agent-health-score.js";
import { managedFileReadPath } from "./active-set.js";
import { adapterCapabilities } from "./adapters.js";
import { loadEffectiveCatalog } from "./catalog.js";
import { detectAgents } from "./paths.js";
import { readLocalOutcomes } from "./outcomes.js";
import { readSnapshot } from "./snapshot.js";
import { scanInstalledSkills } from "./skill-inventory.js";
import { readInstallState } from "./state.js";
import { transactionRoot } from "./transaction.js";

const ACTIVE_SET_CAPACITY = 30;

function freshness(
  pkg: CatalogPackage | undefined,
  asOf: Date,
): AgentHealthPackageEvidence["freshness"] {
  const observed = pkg?.pushedAt ?? pkg?.lastUpdatedAt;
  if (!observed) return undefined;
  const timestamp = Date.parse(observed);
  if (!Number.isFinite(timestamp) || timestamp > asOf.getTime())
    return undefined;
  const ageDays = Math.floor((asOf.getTime() - timestamp) / 86_400_000);
  return {
    status: ageDays <= 180 ? "fresh" : ageDays <= 365 ? "aging" : "stale",
    ageDays,
  };
}

async function driftForAgent(
  installs: InstallRecord[],
  activations: ManagedActivationRecord[],
): Promise<{ checkedFiles: number; driftedFiles: number }> {
  let checkedFiles = 0;
  let driftedFiles = 0;
  for (const install of installs)
    for (const file of install.files) {
      checkedFiles += 1;
      try {
        const digest = createHash("sha256")
          .update(
            await readFile(
              managedFileReadPath(install.packageId, file.path, activations),
            ),
          )
          .digest("hex");
        if (digest !== file.sha256) driftedFiles += 1;
      } catch {
        driftedFiles += 1;
      }
    }
  return { checkedFiles, driftedFiles };
}

async function pendingTransactions(): Promise<number> {
  try {
    return (await readdir(transactionRoot(), { withFileTypes: true })).filter(
      (entry) => entry.isDirectory(),
    ).length;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    )
      return 0;
    throw error;
  }
}

async function snapshotEvidence(installs: InstallRecord[]): Promise<{
  readableSnapshots: number;
  corruptSnapshots: number;
  readableSnapshotIds: Set<string>;
}> {
  let readableSnapshots = 0;
  let corruptSnapshots = 0;
  const readableSnapshotIds = new Set<string>();
  for (const id of new Set(installs.map((install) => install.snapshotId)))
    try {
      await readSnapshot(id);
      readableSnapshots += 1;
      readableSnapshotIds.add(id);
    } catch {
      corruptSnapshots += 1;
    }
  return { readableSnapshots, corruptSnapshots, readableSnapshotIds };
}

export async function collectLocalAgentHealthEvidence(
  options: {
    catalog?: CatalogPackage[];
    agents?: DetectedAgent[];
    asOf?: Date;
  } = {},
): Promise<AgentHealthEvidence[]> {
  const asOf = options.asOf ?? new Date();
  const [catalog, agents, state, outcomes] = await Promise.all([
    options.catalog ? Promise.resolve(options.catalog) : loadEffectiveCatalog(),
    options.agents ? Promise.resolve(options.agents) : detectAgents(),
    readInstallState(),
    readLocalOutcomes(),
  ]);
  const installedAgents = agents.filter((agent) => agent.installed);
  const inventory = await scanInstalledSkills(installedAgents);
  const byCatalogId = new Map(catalog.map((pkg) => [pkg.id, pkg]));
  const pending = await pendingTransactions();
  return Promise.all(
    installedAgents.map(async (agent): Promise<AgentHealthEvidence> => {
      const installs = state.installs.filter((install) =>
        install.targetAgents.includes(agent.id),
      );
      const activations = (state.activations ?? []).filter(
        (item) => item.agent === agent.id,
      );
      const summary = inventory.agents.find((item) => item.agent === agent.id);
      const withinAgentGroups = inventory.duplicates.filter(
        (group) =>
          group.kind === "within-agent" &&
          group.entries.some((entry) => entry.agent === agent.id),
      );
      const duplicatePaths = new Set(
        withinAgentGroups.flatMap((group) =>
          group.entries
            .filter((entry) => entry.agent === agent.id)
            .map((entry) => entry.path),
        ),
      );
      const packages = installs.map((install) => {
        const pkg = byCatalogId.get(install.packageId);
        const observedFreshness = freshness(pkg, asOf);
        return {
          packageId: install.packageId,
          provenance:
            pkg?.source?.commit &&
            install.resolvedCommit?.toLowerCase() ===
              pkg.source.commit.toLowerCase()
              ? ("verified" as const)
              : ("managed" as const),
          ...(pkg?.license ? { license: pkg.license } : {}),
          ...(observedFreshness ? { freshness: observedFreshness } : {}),
        };
      });
      const drift = await driftForAgent(installs, state.activations ?? []);
      const snapshots = await snapshotEvidence(installs);
      const active = summary?.total ?? 0;
      return {
        agent: agent.id,
        asOf: asOf.toISOString(),
        packages,
        ...(drift.checkedFiles
          ? {
              drift: {
                ...drift,
                checkedMcpServers: 0,
                driftedMcpServers: 0,
              },
            }
          : {}),
        ...(active
          ? {
              duplicates: {
                scannedSkills: active,
                withinAgentGroups: withinAgentGroups.length,
                duplicateSkills: duplicatePaths.size,
              },
              activeSet: {
                active,
                capacity: ACTIVE_SET_CAPACITY,
                disabled: activations.filter(
                  (item) => item.activationState === "disabled",
                ).length,
                quarantined: activations.filter(
                  (item) => item.reviewState === "quarantined",
                ).length,
              },
              compatibility: [
                {
                  component: "skill" as const,
                  compatibility: adapterCapabilities(agent.id).components.skill,
                },
              ],
            }
          : {}),
        outcomes: outcomes.events,
        ...(installs.length
          ? {
              recoverability: {
                protectedMutations: installs.length,
                recoverableMutations: installs.filter((install) =>
                  snapshots.readableSnapshotIds.has(install.snapshotId),
                ).length,
                readableSnapshots: snapshots.readableSnapshots,
                corruptSnapshots: snapshots.corruptSnapshots,
                pendingTransactions: pending,
              },
            }
          : {}),
      };
    }),
  );
}

export async function buildLocalAgentHealthScores(
  options: Parameters<typeof collectLocalAgentHealthEvidence>[0] = {},
): Promise<AgentHealthScore[]> {
  return (await collectLocalAgentHealthEvidence(options)).map((evidence) =>
    buildAgentHealthScore(evidence),
  );
}

export function selectAgentHealthScore(
  scores: AgentHealthScore[],
  agent: AgentId,
): AgentHealthScore {
  const score = scores.find((item) => item.agent === agent);
  if (!score) throw new Error(`No health evidence is available for '${agent}'`);
  return score;
}
