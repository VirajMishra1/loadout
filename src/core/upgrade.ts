import type {
  AgentId,
  CatalogPackage,
  DetectedAgent,
  HealthReport,
  PackageRecommendation,
  ProjectSignals,
} from "../shared/types.js";
import type { AgentHealthScore } from "./agent-health-score.js";
import {
  applyPreparedCatalogInstall,
  formatPreparedCatalogInstall,
  prepareCatalogInstall,
  type PreparedCatalogInstall,
  type PrepareCatalogInstallOptions,
} from "./catalog-install.js";
import { loadEffectiveCatalog, type InstallSelection } from "./catalog.js";
import { buildHealthReport, formatHealthReport } from "./health.js";
import { buildLocalAgentHealthScores } from "./health-score-evidence.js";
import {
  formatRecommendations,
  recommendPackages,
  scanProject,
} from "./recommend.js";

export interface UpgradePlan {
  schemaVersion: 1;
  generatedAt: string;
  project: ProjectSignals;
  recommendations: PackageRecommendation[];
  healthBefore: HealthReport;
  healthScoresBefore: AgentHealthScore[];
  prepared: PreparedCatalogInstall;
  riskApprovalRequired: boolean;
  guarantees: string[];
}

export interface UpgradeResult {
  snapshotId: string;
  healthBefore: HealthReport;
  healthAfter: HealthReport;
  healthScoresBefore: AgentHealthScore[];
  healthScoresAfter: AgentHealthScore[];
}

export interface PlanUpgradeOptions {
  projectPath?: string;
  requestedAgents?: AgentId[];
  catalog?: CatalogPackage[];
  detectedAgents?: DetectedAgent[];
  fetchSnapshot?: PrepareCatalogInstallOptions["fetchSnapshot"];
  onProgress?: PrepareCatalogInstallOptions["onProgress"];
  health?: () => Promise<HealthReport>;
  healthScores?: () => Promise<AgentHealthScore[]>;
  projectScan?: (path: string) => Promise<ProjectSignals>;
  now?: () => Date;
}

/**
 * Builds the complete first-run preview without changing agent or Loadout state.
 * Network access is limited to the same immutable catalog preparation performed by
 * `setup`; the health and project scans remain local.
 */
export async function planUpgrade(
  selection: InstallSelection,
  options: PlanUpgradeOptions = {},
): Promise<UpgradePlan> {
  const projectPath = options.projectPath ?? process.cwd();
  const catalog = options.catalog ?? (await loadEffectiveCatalog());
  const health = options.health ?? (() => buildHealthReport());
  const healthScores =
    options.healthScores ?? (() => buildLocalAgentHealthScores());
  const projectScan = options.projectScan ?? scanProject;
  const [healthBefore, healthScoresBefore, project, prepared] =
    await Promise.all([
      health(),
      healthScores(),
      projectScan(projectPath),
      prepareCatalogInstall(selection, {
        catalog,
        ...(options.requestedAgents
          ? { requestedAgents: options.requestedAgents }
          : {}),
        ...(options.detectedAgents
          ? { detectedAgents: options.detectedAgents }
          : {}),
        ...(options.fetchSnapshot
          ? { fetchSnapshot: options.fetchSnapshot }
          : {}),
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      }),
    ]);
  const riskApprovalRequired = prepared.entries.some(
    (entry) => entry.safety.approvalRequired,
  );
  return {
    schemaVersion: 1,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    project,
    recommendations: recommendPackages(project, catalog),
    healthBefore,
    healthScoresBefore,
    prepared,
    riskApprovalRequired,
    guarantees: [
      "preview is read-only until --yes",
      "reviewed GitHub inputs resolve to exact catalog commits",
      "all selected agent targets are changed through one snapshot-backed transaction",
      "unmanaged agent content is not adopted, overwritten, or removed",
      "daily discovery and update checks remain read-only and opt-in",
    ],
  };
}

export async function applyUpgrade(
  plan: UpgradePlan,
  options: {
    approveRisk?: boolean;
    health?: () => Promise<HealthReport>;
    healthScores?: () => Promise<AgentHealthScore[]>;
  } = {},
): Promise<UpgradeResult> {
  if (plan.riskApprovalRequired && !options.approveRisk)
    throw new Error(
      "The upgrade preview contains reviewed safety findings; inspect it and add --approve-risk",
    );
  const snapshotId = await applyPreparedCatalogInstall(plan.prepared, {
    approveRisk: options.approveRisk,
  });
  const healthAfter = await (options.health ?? (() => buildHealthReport()))();
  const healthScoresAfter = await (
    options.healthScores ?? (() => buildLocalAgentHealthScores())
  )();
  return {
    snapshotId,
    healthBefore: plan.healthBefore,
    healthAfter,
    healthScoresBefore: plan.healthScoresBefore,
    healthScoresAfter,
  };
}

export function summarizeUpgradePlan(plan: UpgradePlan): object {
  return {
    schemaVersion: plan.schemaVersion,
    generatedAt: plan.generatedAt,
    mode: plan.prepared.selection.mode,
    project: plan.project,
    healthBefore: plan.healthBefore,
    healthScoresBefore: plan.healthScoresBefore,
    recommendations: plan.recommendations,
    agents: plan.prepared.agents,
    repositories: plan.prepared.resolution.packages.map((pkg) => ({
      id: pkg.id,
      repository: pkg.repository,
      commit: pkg.source?.commit,
      license: pkg.license,
    })),
    install: {
      repositoryCount: plan.prepared.entries.length,
      targetDirectoryCount: plan.prepared.entries.reduce(
        (total, entry) => total + entry.plan.files.length,
        0,
      ),
      skipped: plan.prepared.skipped,
      collisions: plan.prepared.collisions,
      riskApprovalRequired: plan.riskApprovalRequired,
      safetyFindings: plan.prepared.entries.flatMap((entry) =>
        entry.safety.findings.map((finding) => ({
          packageId: entry.package.id,
          ...finding,
        })),
      ),
    },
    guarantees: plan.guarantees,
  };
}

export function formatUpgradePlan(plan: UpgradePlan): string {
  return [
    "Loadout upgrade preview",
    "",
    formatHealthReport(plan.healthBefore),
    ...plan.healthScoresBefore.map(
      (score) =>
        `Agent Health Score (${score.agent}): ${score.score}/100 (${score.rating}; evidence coverage ${score.evidenceCoverage}%)`,
    ),
    "",
    formatRecommendations(plan.project, plan.recommendations),
    "",
    formatPreparedCatalogInstall(plan.prepared),
    "",
    ...plan.guarantees.map((guarantee) => `Safety: ${guarantee}`),
  ].join("\n");
}
