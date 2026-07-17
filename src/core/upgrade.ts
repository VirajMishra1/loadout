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
  buildAdapterCapabilityGaps,
  type AdapterCapabilityGap,
} from "./adapters.js";
import {
  applyPreparedCatalogInstall,
  formatPreparedCatalogInstall,
  prepareCatalogInstall,
  RECOMMENDED_ACTIVE_SKILL_LIMIT,
  type PreparedCatalogInstall,
  type PrepareCatalogInstallOptions,
} from "./catalog-install.js";
import { loadEffectiveCatalog, type InstallSelection } from "./catalog.js";
import { buildHealthReport, formatHealthReport } from "./health.js";
import { buildLocalAgentHealthScores } from "./health-score-evidence.js";
import {
  formatRecommendations,
  personalizeRecommendations,
  recommendPackages,
  scanProject,
} from "./recommend.js";
import { readLocalOutcomes, type LocalOutcomeStore } from "./outcomes.js";

export interface UpgradeDeferredAction {
  packageId: string;
  components: string[];
  reason: string;
  nextCommand: string;
  automatic: false;
}

export interface UpgradeAlternative {
  kind: "profile-conflict" | "target-overlap";
  selected: string;
  deferred: string[];
  reason: string;
}

export interface UpgradeActiveSetPreview {
  policy: "bounded-active" | "disabled-library";
  recommendedLimit: number;
  plannedDirectoriesPerAgent: number;
  exceedsRecommendedLimit: boolean;
  explanation: string;
  nextCommand?: string;
}

export interface UpgradePlan {
  schemaVersion: 1;
  generatedAt: string;
  project: ProjectSignals;
  recommendations: PackageRecommendation[];
  personalizedRecommendations: Array<{
    agent: AgentId;
    recommendations: PackageRecommendation[];
  }>;
  localOutcomeEventsConsidered: number;
  healthBefore: HealthReport;
  healthScoresBefore: AgentHealthScore[];
  prepared: PreparedCatalogInstall;
  alternatives: UpgradeAlternative[];
  capabilityGaps: AdapterCapabilityGap[];
  deferredActions: UpgradeDeferredAction[];
  activeSet: UpgradeActiveSetPreview;
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
  access?: PrepareCatalogInstallOptions["access"];
  health?: () => Promise<HealthReport>;
  healthScores?: () => Promise<AgentHealthScore[]>;
  projectScan?: (path: string) => Promise<ProjectSignals>;
  outcomes?: () => Promise<LocalOutcomeStore>;
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
  const outcomes = options.outcomes ?? readLocalOutcomes;
  const [healthBefore, healthScoresBefore, project, prepared, localOutcomes] =
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
        ...(options.access ? { access: options.access } : {}),
      }),
      outcomes(),
    ]);
  const recommendations = recommendPackages(project, catalog);
  const personalizedRecommendations = prepared.agents.map((agent) => ({
    agent: agent.id,
    recommendations: personalizeRecommendations(
      recommendations,
      project,
      localOutcomes,
      agent.id,
    ),
  }));
  const selectedAgents = new Set(prepared.agents.map((agent) => agent.id));
  const capabilityGaps = buildAdapterCapabilityGaps().filter((gap) =>
    selectedAgents.has(gap.agent),
  );
  const alternatives: UpgradeAlternative[] = [
    ...prepared.resolution.conflicts.map((conflict) => ({
      kind: "profile-conflict" as const,
      selected:
        conflict.defaultPackageId ?? conflict.packageIds[0] ?? "unresolved",
      deferred: conflict.packageIds.filter(
        (id) => id !== conflict.defaultPackageId,
      ),
      reason: conflict.message,
    })),
    ...prepared.collisions.map((collision) => ({
      kind: "target-overlap" as const,
      selected: collision.keptPackageId,
      deferred: [collision.deferredPackageId],
      reason: `Both packages target the same agent skill directory; ${collision.keptPackageId} wins by deterministic profile evidence order.`,
    })),
  ];
  const deferredActions = prepared.skipped
    .filter((item) => item.kind === "explicit-setup")
    .map((item): UpgradeDeferredAction => {
      const pkg = prepared.resolution.packages.find(
        (candidate) => candidate.id === item.packageId,
      );
      const components = pkg?.components ?? [];
      return {
        packageId: item.packageId,
        components,
        reason: item.reason,
        nextCommand: components.includes("mcp")
          ? `loadout mcp --repository ${pkg?.repository ?? item.packageId}`
          : `loadout inspect ${item.packageId}`,
        automatic: false,
      };
    });
  const targetDirectories = prepared.entries.reduce(
    (total, entry) => total + entry.plan.files.length,
    0,
  );
  const plannedDirectoriesPerAgent = prepared.agents.length
    ? Math.ceil(targetDirectories / prepared.agents.length)
    : 0;
  const activeSet: UpgradeActiveSetPreview =
    selection.mode === "maximum"
      ? {
          policy: "disabled-library",
          recommendedLimit: RECOMMENDED_ACTIVE_SKILL_LIMIT,
          plannedDirectoriesPerAgent,
          exceedsRecommendedLimit:
            plannedDirectoriesPerAgent > RECOMMENDED_ACTIVE_SKILL_LIMIT,
          explanation:
            "Maximum stores reviewed skills in the disabled library; it does not expose the full library to agent context.",
          nextCommand: `loadout optimize --project ${project.root} --limit ${RECOMMENDED_ACTIVE_SKILL_LIMIT}`,
        }
      : {
          policy: "bounded-active",
          recommendedLimit: RECOMMENDED_ACTIVE_SKILL_LIMIT,
          plannedDirectoriesPerAgent,
          exceedsRecommendedLimit:
            plannedDirectoriesPerAgent > RECOMMENDED_ACTIVE_SKILL_LIMIT,
          explanation:
            plannedDirectoriesPerAgent <= RECOMMENDED_ACTIVE_SKILL_LIMIT
              ? "The prepared profile stays within the recommended active-set ceiling."
              : "The prepared profile exceeds the recommended active-set ceiling; use Stable or project optimization before treating it as a daily active set.",
          ...(plannedDirectoriesPerAgent > RECOMMENDED_ACTIVE_SKILL_LIMIT
            ? {
                nextCommand: `loadout optimize --project ${project.root} --limit ${RECOMMENDED_ACTIVE_SKILL_LIMIT}`,
              }
            : {}),
        };
  const riskApprovalRequired = prepared.entries.some(
    (entry) => entry.safety.approvalRequired,
  );
  return {
    schemaVersion: 1,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    project,
    recommendations,
    personalizedRecommendations,
    localOutcomeEventsConsidered: localOutcomes.events.length,
    healthBefore,
    healthScoresBefore,
    prepared,
    alternatives,
    capabilityGaps,
    deferredActions,
    activeSet,
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
    personalizedRecommendations: plan.personalizedRecommendations,
    localOutcomeEventsConsidered: plan.localOutcomeEventsConsidered,
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
    alternatives: plan.alternatives,
    capabilityGaps: plan.capabilityGaps,
    deferredActions: plan.deferredActions,
    activeSet: plan.activeSet,
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
    ...plan.personalizedRecommendations.flatMap((item) =>
      item.recommendations.some(
        (recommendation) => recommendation.localOutcomeAdjustment !== undefined,
      )
        ? [
            "",
            `Local outcome personalization (${item.agent}; ${plan.localOutcomeEventsConsidered} local event(s), never uploaded):`,
            formatRecommendations(plan.project, item.recommendations),
          ]
        : [],
    ),
    "",
    formatPreparedCatalogInstall(plan.prepared),
    "",
    `Active-set policy: ${plan.activeSet.policy}; about ${plan.activeSet.plannedDirectoriesPerAgent}/${plan.activeSet.recommendedLimit} directories per agent. ${plan.activeSet.explanation}`,
    ...(plan.activeSet.nextCommand
      ? [`Next bounded activation: ${plan.activeSet.nextCommand}`]
      : []),
    ...plan.alternatives.map(
      (item) =>
        `Alternative (${item.kind}): selected ${item.selected}; deferred ${item.deferred.join(", ")} — ${item.reason}`,
    ),
    ...plan.deferredActions.map(
      (item) =>
        `Deferred explicit action: ${item.packageId} [${item.components.join(", ") || "unknown"}] — ${item.nextCommand}`,
    ),
    `Unsupported selected-agent capability combinations: ${plan.capabilityGaps.length}; no undocumented path will be guessed.`,
    "",
    ...plan.guarantees.map((guarantee) => `Safety: ${guarantee}`),
  ].join("\n");
}
