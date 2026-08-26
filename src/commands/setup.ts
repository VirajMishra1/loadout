import { Command, CommanderError } from "commander";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import {
  explainCatalogScore,
  loadEffectiveCatalog,
  loadCatalog,
  rankCatalog,
  refreshCatalog,
  type InstallSelectionMode,
} from "../core/catalog.js";
import { detectAgents, parseAgentSelection, userHome } from "../core/paths.js";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  buildSkillPlan,
  applySkillInstall,
  installedAgents,
} from "../core/install.js";
import {
  listSnapshotIds,
  readSnapshot,
  restoreSnapshot,
  summarizeSnapshot,
} from "../core/snapshot.js";
import type { AgentId } from "../shared/types.js";
import { fetchRepositorySnapshot } from "../core/source.js";
import {
  discoverMcpManifests,
  summarizeMcpManifest,
  planMcpConfig,
  summarizeMcpConfigPlan,
  applyMcpConfigPlan,
} from "../core/mcp.js";
import {
  REVIEWED_MCP_RECIPES,
  buildMcpRecipeServer,
  findMcpRecipe,
  formatMcpRecipePlan,
  planMcpRecipe,
  verifyMcpRecipe,
  verifyMcpRecipeConnection,
  type McpSetupRecipe,
} from "../core/mcp-recipes.js";
import type { CredentialReference, McpServer } from "../shared/types.js";
import { runDoctor, formatDoctorReport } from "../core/doctor.js";
import {
  applyPackageUpdate,
  buildUpdatePlan,
  formatUpdatePlan,
  selectSafeAutomaticUpdates,
} from "../core/update.js";
import { startApiServer } from "../core/api.js";
import { inspectPackage, formatPackageInspection } from "../core/package.js";
import {
  addManifestPackage,
  applyProfileToManifest,
  initManifest,
  readManifest,
  removeManifestPackage,
  writeLockfile,
} from "../core/manifest.js";
import { buildHealthReport, formatHealthReport } from "../core/health.js";
import {
  installStatePath,
  readInstallState,
  recordInstallTransaction,
  recordMcpInstall,
} from "../core/state.js";
import { applyRemove, planRemove } from "../core/remove.js";
import {
  applyUninstall,
  buildUninstallPlan,
  formatUninstallPlan,
  uninstallGlobalCli,
} from "../core/uninstall.js";
import {
  evaluateInstalledProfile,
  formatInstalledProfileStatus,
} from "../core/profile-state.js";
import {
  formatRecommendations,
  personalizeRecommendations,
  profileManifestPackages,
  recommendPackages,
  RECOMMENDATION_BOUNDARY,
  scanProject,
  TESTED_PROFILES,
} from "../core/recommend.js";
import {
  buildImprovementCycle,
  formatImprovementCycle,
  recordImprovementOutcome,
  writeImprovementCycle,
} from "../core/improve.js";
import { applySyncPlan, buildSyncPlan } from "../core/sync.js";
import {
  createPackage,
  packPackage,
  publishLocalPackage,
  publishRemotePackage,
  searchLocalRegistry,
} from "../core/registry.js";
import { auditLoadout, formatAuditReport } from "../core/audit.js";
import {
  ADAPTER_CAPABILITIES,
  buildAdapterCapabilityGaps,
  formatAdapterCapabilityGaps,
  formatCapabilityMatrix,
} from "../core/adapters.js";
import {
  formatAgentInventory,
  inspectAgents,
} from "../core/agent-inspection.js";
import {
  applyPortableImport,
  exportPortableLoadout,
  planPortableImport,
} from "../core/portable.js";
import {
  applyCodexMcpConfigPlan,
  codexMcpServerFingerprint,
  defaultCodexMcpConfigPath,
  planCodexMcpConfig,
} from "../core/codex-mcp.js";
import {
  catalogTrustStage,
  formatCatalogTrustStage,
  resolveCatalogProfile,
} from "../core/profiles.js";
import { discoverHackerNewsRepositories } from "../core/community.js";
import { discoverPrivateRepositories } from "../core/private-discovery.js";
import {
  defaultGitHubDiscoveryQueries,
  discoverGitHubRepositories,
} from "../core/github-discovery.js";
import {
  formatStarHistory,
  readCatalogObservations,
} from "../core/observations.js";
import { evaluatePackage, formatPackageEvaluation } from "../core/evaluate.js";
import { checkForUpdates, startUpdateWatcher } from "../core/update-watch.js";
import { runDisposableSandbox } from "../core/sandbox.js";
import {
  compileConversion,
  type ConversionKind,
  type ConversionTarget,
} from "../core/conversion.js";
import { writeFileAtomically } from "../core/atomic-file.js";
import { formatCanaryResult, runCanary } from "../core/canary.js";
import {
  applyPreparedCatalogInstall,
  formatCatalogApplyGuidance,
  formatPreparedCatalogInstall,
  prepareCatalogInstall,
  type CatalogInstallProgress,
  type PreparedCatalogInstall,
} from "../core/catalog-install.js";
import {
  formatInstalledSkillInventory,
  scanInstalledSkills,
} from "../core/skill-inventory.js";
import {
  enrichInventoryWithProvenance,
  formatProvenanceSummary,
  resolveCatalogSkillIndex,
  type CatalogSkillIndexProgress,
} from "../core/provenance.js";
import { compareSkill, formatSkillComparison } from "../core/skill-compare.js";
import {
  applyActivationChange,
  buildLibraryStateReport,
  formatActivationPlan,
  formatLibrarySummary,
  formatLibraryStateReport,
  planActivationChange,
  type ActivationAction,
} from "../core/active-set.js";
import {
  applyProjectActivation,
  formatProjectActivation,
  planProjectActivation,
} from "../core/active-policy.js";
import {
  applySkillAdoption,
  formatAdoptionPlan,
  planSkillAdoption,
} from "../core/adopt.js";
import {
  applyReconcilePlan,
  buildReconcilePlan,
  formatReconcilePlan,
} from "../core/reconcile.js";
import {
  formatReviewQueue,
  mergeReviewQueue,
  readReviewQueue,
  setReviewDecision,
  type ReviewDecision,
  type ReviewQueueLead,
} from "../core/review-queue.js";
import {
  applyProviderModelSelection,
  defaultModelConfigurationPath,
  formatProviderModelConfiguration,
  planProviderModelSelection,
  readProviderModelConfiguration,
  requestOpenRouter,
} from "../core/model-config.js";
import {
  applyNativeScheduler,
  applyNativeSchedulerBundle,
  formatNativeScheduler,
  planNativeScheduler,
  type SchedulerAction,
} from "../core/scheduler.js";
import {
  REVIEWED_RUNTIME_TOOLS,
  applyRuntimeToolPlan,
  formatRuntimeToolPlan,
  planRuntimeTool,
} from "../core/runtime-tools.js";
import {
  buildPrivacySafeReport,
  formatPrivacySafeReport,
  parsePrivacySafeLoadoutReport,
  writePrivacySafeReport,
} from "../core/share-report.js";
import {
  readLocalOutcomes,
  recordLocalOutcome,
  type OutcomeResult,
  type OutcomeTaskFamily,
} from "../core/outcomes.js";
import {
  buildFreshnessAlerts,
  formatFreshnessAlerts,
  ignoreFreshnessAlert,
  pinReplacement,
  readReplacementPins,
  unpinReplacement,
} from "../core/freshness-alerts.js";
import {
  parseCompletionShell,
  renderShellCompletion,
} from "../core/completion.js";
import {
  buildCatalogCoverage,
  formatCatalogCoverage,
} from "../core/catalog-coverage.js";
import {
  createCredentialResolver,
  createOsCredentialStore,
} from "../core/credentials.js";
import {
  buildCandidateDossier,
  buildCatalogProposal,
  formatCandidateDossier,
  formatCandidateSummaries,
  listDiscoveryCandidates,
  readCandidateDossier,
  verifyCandidateDossierSource,
  writeCandidateDossier,
} from "../core/candidate-intelligence.js";
import type { OperatingSystem, PackageTier } from "../shared/types.js";
import {
  recoverPendingTransactions,
  withMutationLock,
} from "../core/transaction.js";
import {
  applyUpgrade,
  formatUpgradePlan,
  planUpgrade,
  summarizeUpgradePlan,
} from "../core/upgrade.js";
import {
  formatAgentVersions,
  inspectAgentVersions,
} from "../core/agent-versions.js";
import { formatAgentHealthScore } from "../core/agent-health-score.js";
import { buildLocalAgentHealthScores } from "../core/health-score-evidence.js";
import {
  interactiveModelApiAccess,
  parseModelApiAccess,
  type SetupAccessProfile,
} from "../core/access.js";
import { discoverSkillsSh } from "../core/skills-sh-discovery.js";
import { discoverOfficialMcpRegistry } from "../core/mcp-registry-discovery.js";
import {
  buildLoadoutCard,
  compareLoadoutReports,
  formatLoadoutCard,
  formatLoadoutComparison,
} from "../core/loadout-card.js";
import {
  buildLoadoutBadge,
  formatLoadoutBadgeUsage,
  parseLoadoutBadgeMetric,
} from "../core/loadout-badge.js";
import { scanSkillSecurity } from "../core/skill-security.js";
import {
  ADVANCED_GUIDE,
  BEGINNER_GUIDE,
  HIDDEN_FROM_FIRST_SCREEN,
} from "../core/cli-guide.js";
import {
  collectOption,
  parseMcpCredentialMappings,
  readCredentialFromStdin,
  setupSelection,
  printSetupProgress,
  printProvenanceProgress,
  riskyPackageSummary,
  runSetup,
  durableSchedulerLauncher,
  printBeginnerGuide,
  LOADOUT_VERSION,
  type SetupOptions,
} from "./support.js";

export function registerSetup(program: Command): void {
program
  .command("guide")
  .description("Show the simple, read-only path for using Loadout")
  .action(printBeginnerGuide);

program
  .command("advanced")
  .description("Explain where to find advanced and maintainer-only commands")
  .action(() => console.log(ADVANCED_GUIDE));

program
  .command("setup")
  .description(
    "Preview and install a screened skill loadout for detected agents",
  )
  .option("--mode <mode>", "stable, power, maximum, or custom")
  .option("--agents <ids>", "comma-separated target agent ids")
  .option("--package <id>", "package id for custom mode", collectOption, [])
  .option(
    "--api-access <providers>",
    "separately billed model API access: none, openai, anthropic, openrouter, or other (comma-separated; never a key)",
  )
  .option("-y, --yes", "install after preparing the screened plan")
  .option(
    "--approve-risk",
    "approve reviewed safety findings in non-interactive mode",
  )
  .option("--details", "show every quarantined and deferred unit")
  .action((options: SetupOptions) => runSetup(options));

program
  .command("upgrade")
  .description(
    "Diagnose, recommend, preview, and transactionally apply one screened upgrade",
  )
  .option("--mode <mode>", "stable, power, maximum, or custom", "stable")
  .option("--project <path>", "project directory", process.cwd())
  .option("--agents <ids>", "comma-separated target agent ids")
  .option("--package <id>", "package id for custom mode", collectOption, [])
  .option(
    "--api-access <providers>",
    "separately billed model API access: none, openai, anthropic, openrouter, or other (comma-separated; never a key)",
  )
  .option("--yes", "apply the exact displayed upgrade")
  .option("--approve-risk", "approve the displayed reviewed safety findings")
  .option("--json", "emit a machine-readable preview or result")
  .action(
    async (options: {
      mode: string;
      project: string;
      agents?: string;
      package: string[];
      yes?: boolean;
      approveRisk?: boolean;
      apiAccess?: string;
      json?: boolean;
    }) => {
      const plan = await planUpgrade(
        setupSelection(options.mode, options.package),
        {
          projectPath: options.project,
          requestedAgents: parseAgentSelection(options.agents),
          onProgress: options.json ? undefined : printSetupProgress,
          access: parseModelApiAccess(options.apiAccess),
        },
      );
      if (!options.yes) {
        console.log(
          options.json
            ? JSON.stringify(summarizeUpgradePlan(plan), null, 2)
            : `${formatUpgradePlan(plan)}\n\nPreview complete; nothing was changed. Re-run with --yes${plan.riskApprovalRequired ? " --approve-risk" : ""} to apply this exact upgrade.`,
        );
        return;
      }
      const result = await applyUpgrade(plan, {
        approveRisk: options.approveRisk,
      });
      console.log(
        options.json
          ? JSON.stringify(
              {
                plan: summarizeUpgradePlan(plan),
                result,
              },
              null,
              2,
            )
          : [
              `Upgrade applied as one transaction. Snapshot: ${result.snapshotId}`,
              formatHealthReport(result.healthAfter),
              ...result.healthScoresAfter.map(
                (score) =>
                  `Agent Health Score (${score.agent}): ${score.score}/100 (${score.rating}; evidence coverage ${score.evidenceCoverage}%)`,
              ),
              "Scores summarize stored evidence only; they do not claim task improvement until benchmark or local outcome evidence exists.",
              "Next: run `loadout rollback` to restore or `loadout outcome` after real use.",
            ].join("\n"),
      );
    },
  );

}
