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
import { DEFAULT_ACTIVE_SKILL_LIMIT } from "../core/active-limit.js";
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

export function registerAgents(program: Command): void {
for (const workflow of ["activate", "optimize"] as const) {
  program
    .command(workflow)
    .description(
      workflow === "activate"
        ? "Select and activate inspected library skills for a project"
        : "Scan a project and propose rule-selected inspected active-set additions",
    )
    .option("--project <path>", "project directory to scan", ".")
    .option("--agents <ids>", "comma-separated agent ids")
    .option(
      "--limit <count>",
      `maximum active skills per agent (recommended default: ${DEFAULT_ACTIVE_SKILL_LIMIT})`,
      String(DEFAULT_ACTIVE_SKILL_LIMIT),
    )
    .option(
      "--pin <selector>",
      "always prioritize package/skill or skill",
      collectOption,
      [],
    )
    .option("--yes", "apply the proposed activation transaction")
    .option("--json", "emit machine-readable JSON")
    .action(
      async (options: {
        project: string;
        agents?: string;
        limit: string;
        pin: string[];
        yes?: boolean;
        json?: boolean;
      }) => {
        const agents = options.agents
          ?.split(",")
          .map((value) => value.trim())
          .filter(Boolean) as AgentId[] | undefined;
        const plan = await planProjectActivation(options.project, {
          ...(agents?.length ? { agents } : {}),
          limit: Number(options.limit),
          pins: options.pin,
        });
        if (!options.yes) {
          console.log(
            options.json
              ? JSON.stringify(plan, null, 2)
              : `${formatProjectActivation(plan)}\nDry run only. Re-run with --yes to activate this reviewed set.`,
          );
          return;
        }
        const snapshotId = await applyProjectActivation(plan);
        console.log(
          options.json
            ? JSON.stringify({ plan, snapshotId }, null, 2)
            : `${formatProjectActivation(plan)}\nApplied and verified. Snapshot: ${snapshotId}\nRollback: loadout rollback --snapshot ${snapshotId}`,
        );
      },
    );
}

for (const action of [
  "enable",
  "disable",
] as const satisfies ActivationAction[]) {
  program
    .command(action)
    .description(
      `${action === "enable" ? "Activate" : "Deactivate"} Loadout-managed skills without deleting the reviewed-library copy`,
    )
    .argument("<packages...>", "one or more managed package ids")
    .option("--agents <ids>", "comma-separated agent ids")
    .option("--yes", "apply the transaction; otherwise show a plan")
    .option("--json", "emit machine-readable JSON")
    .action(
      async (
        packageIds: string[],
        options: { agents?: string; yes?: boolean; json?: boolean },
      ) => {
        const agents = options.agents
          ?.split(",")
          .map((value) => value.trim())
          .filter(Boolean) as AgentId[] | undefined;
        if (agents?.length) {
          const known = new Set(
            (await detectAgents()).map((agent) => agent.id),
          );
          const unknown = agents.filter((agent) => !known.has(agent));
          if (unknown.length)
            throw new Error(`Unknown agent id(s): ${unknown.join(", ")}`);
        }
        const plan = await planActivationChange(action, packageIds, {
          ...(agents?.length ? { agents } : {}),
        });
        if (!options.yes) {
          console.log(
            options.json
              ? JSON.stringify(plan, null, 2)
              : `${formatActivationPlan(plan)}\nDry run only. Re-run with --yes to apply this exact transaction.`,
          );
          return;
        }
        const snapshotId = await applyActivationChange(plan);
        console.log(
          options.json
            ? JSON.stringify({ plan, snapshotId }, null, 2)
            : `${formatActivationPlan(plan)}\nApplied. Snapshot: ${snapshotId}`,
        );
      },
    );
}

program
  .command("autopilot")
  .description(
    "Preview or enable both daily read-only discovery and update radar jobs",
  )
  .option("--time <HH:MM>", "local daily check time", "09:00")
  .option("--remove", "remove both daily radar jobs")
  .option("--yes", "apply both native scheduler changes atomically")
  .option("--json", "emit machine-readable JSON")
  .action(
    async (options: {
      time: string;
      remove?: boolean;
      yes?: boolean;
      json?: boolean;
    }) => {
      const action: SchedulerAction = options.remove
        ? "unschedule"
        : "schedule";
      const plans = (["updates", "discovery"] as const).map((job) =>
        planNativeScheduler(action, {
          time: options.time,
          launcher: durableSchedulerLauncher(),
          job,
        }),
      );
      if (!options.yes) {
        console.log(
          options.json
            ? JSON.stringify({ action, plans }, null, 2)
            : `${plans.map(formatNativeScheduler).join("\n\n")}\n\nDry run only. Re-run with --yes to ${options.remove ? "remove" : "enable"} both read-only jobs.`,
        );
        return;
      }
      const snapshotId = await applyNativeSchedulerBundle(plans);
      console.log(
        options.json
          ? JSON.stringify({ action, plans, snapshotId }, null, 2)
          : `Loadout Autopilot ${options.remove ? "removed" : "enabled"}: daily update radar + multi-source candidate discovery.\nNo scheduled command can install, promote, or execute a candidate. Snapshot: ${snapshotId}`,
      );
    },
  );

program
  .command("badge")
  .description(
    "Generate telemetry-free Shields endpoint JSON from the local privacy-safe card",
  )
  .option(
    "--metric <metric>",
    "evidence, active-skills, managed-packages, or mcp",
    "evidence",
  )
  .option("--output <path>", "write endpoint JSON to this path")
  .action(async (options: { metric: string; output?: string }) => {
    const badge = buildLoadoutBadge(
      await buildLoadoutCard(),
      parseLoadoutBadgeMetric(options.metric),
    );
    if (!options.output) return console.log(JSON.stringify(badge, null, 2));
    const output = resolve(options.output);
    await writeFileAtomically(output, `${JSON.stringify(badge, null, 2)}\n`);
    console.log(formatLoadoutBadgeUsage(output));
  });

program
  .command("tool")
  .description(
    "Preview, install, or remove an explicitly reviewed runtime-tool recipe",
  )
  .argument("[id]", "runtime tool id; omit to list reviewed recipes")
  .option("--agents <ids>", "comma-separated target agent ids")
  .option("--remove", "restore pre-install agent state and remove the runtime")
  .option("--yes", "apply the exact displayed plan")
  .option(
    "--approve-risk",
    "approve installing and running the exact reviewed external artifact",
  )
  .option("--json", "emit machine-readable JSON")
  .action(
    async (
      id: string | undefined,
      options: {
        agents?: string;
        remove?: boolean;
        yes?: boolean;
        approveRisk?: boolean;
        json?: boolean;
      },
    ) => {
      if (!id) {
        if (options.remove || options.yes || options.approveRisk)
          throw new Error("Select a runtime tool id for this operation");
        const listed = REVIEWED_RUNTIME_TOOLS.map((recipe) => ({
          id: recipe.id,
          displayName: recipe.displayName,
          version: recipe.version,
          source: recipe.source,
          artifactSha256: recipe.artifactSha256,
        }));
        console.log(
          options.json
            ? JSON.stringify(listed, null, 2)
            : listed
                .map(
                  (recipe) =>
                    `${recipe.id} — ${recipe.displayName} ${recipe.version} — ${recipe.source}`,
                )
                .join("\n"),
        );
        return;
      }
      const plan = await planRuntimeTool(id, {
        action: options.remove ? "remove" : "install",
        requestedAgents: parseAgentSelection(options.agents),
      });
      if (!options.yes) {
        console.log(
          options.json
            ? JSON.stringify(plan, null, 2)
            : `${formatRuntimeToolPlan(plan)}\n\nDry run only. Re-run with --yes --approve-risk to apply this exact runtime recipe.`,
        );
        return;
      }
      if (!options.approveRisk)
        throw new Error(
          "Runtime tool changes require --approve-risk after reviewing the preview",
        );
      const result = await applyRuntimeToolPlan(plan, { approveRisk: true });
      console.log(
        options.json
          ? JSON.stringify({ plan, result }, null, 2)
          : `${plan.recipe.displayName} ${result.action === "install" ? "installed and registered" : "removed and prior agent state restored"}. Snapshot: ${result.snapshotId}`,
      );
    },
  );

}
