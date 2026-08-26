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

export function registerHealth(program: Command): void {
program
  .command("health")
  .description("Quickly check agents, installed packages, and local file drift")
  .option("--json", "emit machine-readable JSON")
  .option("--updates", "also perform live network update checks")
  .option(
    "--explain",
    "add deterministic score dimensions, evidence, uncertainty, and remediation",
  )
  .option("--agents <ids>", "limit explained scores to selected agent ids")
  .action(
    async (options: {
      json?: boolean;
      updates?: boolean;
      explain?: boolean;
      agents?: string;
    }) => {
      if (options.updates && !options.json)
        console.error(
          "Checking repository commits (4 at a time; changed sources may take up to 120s for safety review)…",
        );
      const report = await buildHealthReport({
        updates: options.updates
          ? () =>
              buildUpdatePlan(undefined, {
                onProgress: options.json
                  ? undefined
                  : ({ completed, total, packageId }) =>
                      console.error(`✓ [${completed}/${total}] ${packageId}`),
              })
          : undefined,
      });
      if (options.agents && !options.explain)
        throw new Error("--agents requires --explain");
      const selectedAgents = parseAgentSelection(options.agents);
      const scores = options.explain
        ? (await buildLocalAgentHealthScores()).filter(
            (score) => !selectedAgents || selectedAgents.includes(score.agent),
          )
        : [];
      console.log(
        options.json
          ? JSON.stringify(
              options.explain ? { report, scores } : report,
              null,
              2,
            )
          : [
              formatHealthReport(report),
              ...scores.map((score) => `\n${formatAgentHealthScore(score)}`),
            ].join("\n"),
      );
    },
  );

program
  .command("alerts")
  .description(
    "Explain evidence-backed archive, staleness, reviewed-commit, and permission alerts",
  )
  .option("--updates", "perform live update safety checks")
  .option("--all", "include ignored alerts")
  .option("--json", "emit machine-readable JSON")
  .action(
    async (options: { updates?: boolean; all?: boolean; json?: boolean }) => {
      const alerts = await buildFreshnessAlerts({
        checkUpdates: options.updates,
      });
      const selected = options.all
        ? alerts
        : alerts.filter((alert) => !alert.ignored);
      console.log(
        options.json
          ? JSON.stringify(selected, null, 2)
          : formatFreshnessAlerts(selected),
      );
    },
  );

program
  .command("alert-ignore")
  .description("Ignore one exact freshness alert id on this machine")
  .argument("<id>", "alert id shown by loadout alerts")
  .action(async (id: string) => {
    await ignoreFreshnessAlert(id);
    console.log(
      `Ignored ${id} locally. Re-run loadout alerts --all to inspect it.`,
    );
  });

program
  .command("alert-pin")
  .description(
    "Pin a reviewed replacement preference after comparing evidence; does not change active skills",
  )
  .argument("<package>", "currently installed package id")
  .argument("<replacement>", "reviewed replacement package id")
  .action(async (packageId: string, replacementId: string) => {
    await pinReplacement(packageId, replacementId);
    console.log(
      `Pinned ${replacementId} as a local replacement preference for ${packageId}. Review and activate it explicitly with loadout compare/enable.`,
    );
  });

program
  .command("alert-unpin")
  .description("Remove a local replacement preference")
  .argument("<package>", "currently installed package id")
  .action(async (packageId: string) => {
    const removed = await unpinReplacement(packageId);
    console.log(
      removed
        ? `Removed the replacement preference for ${packageId}.`
        : `No replacement preference exists for ${packageId}.`,
    );
  });

program
  .command("alert-pins")
  .description("Show local replacement preferences")
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    const pins = await readReplacementPins();
    console.log(
      options.json
        ? JSON.stringify(pins, null, 2)
        : pins.length
          ? pins
              .map((pin) => `${pin.packageId} -> ${pin.replacementPackageId}`)
              .join("\n")
          : "No local replacement preferences.",
    );
  });

}
