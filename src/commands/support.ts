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

export const collectOption = (value: string, previous: string[] = []): string[] => [
  ...previous,
  value,
];

export function parseMcpCredentialMappings(
  recipe: McpSetupRecipe,
  mappings: string[],
  account?: string,
): Record<string, CredentialReference> {
  const references: Record<string, CredentialReference> = {};
  for (const mapping of mappings) {
    const separator = mapping.indexOf("=");
    if (separator <= 0)
      throw new Error(
        "Invalid --credential mapping; expected NAME=env:VARIABLE or NAME=keychain:SERVICE. Never pass a credential value.",
      );
    const name = mapping.slice(0, separator);
    const value = mapping.slice(separator + 1);
    if (!recipe.environment.includes(name))
      throw new Error(
        `Credential '${name}' is not required by recipe '${recipe.id}'`,
      );
    if (references[name])
      throw new Error(`Credential '${name}' was mapped more than once`);
    if (value.startsWith("env:") && value.length > 4)
      references[name] = {
        kind: "environment",
        name: value.slice(4),
      };
    else if (value.startsWith("keychain:") && value.length > 9)
      references[name] = {
        kind: "os-keychain",
        service: value.slice(9),
        ...(account ? { account } : {}),
      };
    else
      throw new Error(
        `Invalid --credential mapping for '${name}'; use env:VARIABLE or keychain:SERVICE, never a credential value.`,
      );
  }
  return references;
}

export async function readCredentialFromStdin(): Promise<string> {
  if (process.stdin.isTTY)
    throw new Error(
      "Credential input must be piped on stdin; interactive echo is intentionally unsupported",
    );
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 64 * 1024)
      throw new Error("Credential input exceeds the 64 KiB safety limit");
    chunks.push(value);
  }
  const secret = Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
  if (!secret) throw new Error("Credential input is empty");
  return secret;
}

export interface SetupOptions {
  mode?: string;
  agents?: string;
  package: string[];
  yes?: boolean;
  approveRisk?: boolean;
  apiAccess?: string;
  details?: boolean;
}

export function setupSelection(
  mode: string,
  packageIds: string[],
): { mode: InstallSelectionMode; packageIds?: string[] } {
  if (!(["stable", "power", "maximum", "custom"] as string[]).includes(mode))
    throw new Error("--mode must be stable, power, maximum, or custom");
  if (mode === "custom" && packageIds.length === 0)
    throw new Error("Custom setup requires at least one --package <id>");
  if (mode !== "custom" && packageIds.length)
    throw new Error("--package can only be used with --mode custom");
  return {
    mode: mode as InstallSelectionMode,
    ...(packageIds.length ? { packageIds } : {}),
  };
}

export function printSetupProgress(progress: CatalogInstallProgress): void {
  const marker =
    progress.status === "ready"
      ? "✓"
      : progress.status === "skipped"
        ? "○"
        : "↓";
  console.error(
    `${marker} [${progress.completed}/${progress.total}] ${progress.message}`,
  );
}

export function printProvenanceProgress(progress: CatalogSkillIndexProgress): void {
  const marker =
    progress.status === "ready"
      ? "✓"
      : progress.status === "failed"
        ? "○"
        : "↓";
  console.error(
    `${marker} [${progress.completed}/${progress.total}] ${progress.message}`,
  );
}

export function riskyPackageSummary(prepared: PreparedCatalogInstall): string {
  return prepared.entries
    .filter((entry) => entry.safety.approvalRequired)
    .map((entry) => {
      const categories = [
        ...new Set(entry.safety.findings.map((finding) => finding.category)),
      ];
      return `${entry.package.id} (${categories.join(", ")})`;
    })
    .join(", ");
}

export async function runSetup(options: SetupOptions): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  let mode = options.mode;
  let packageIds = options.package ?? [];
  let reader: ReturnType<typeof createInterface> | undefined;
  let access: SetupAccessProfile | undefined = options.apiAccess
    ? parseModelApiAccess(options.apiAccess)
    : undefined;
  try {
    if (!mode) {
      if (!interactive) {
        console.log(
          "Loadout is CLI-first. Run `loadout setup --mode stable` for Loadout's bounded policy selection, `--mode power` for broader opt-in skills, or `--mode maximum` to download the screened library without activating it.",
        );
        return;
      }
      reader = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const answer = (
        await reader.question(
          "Choose a loadout: [1] Stable Daily Driver (Loadout policy selection), [2] Power Boost, [3] Maximum Library, [4] Custom: ",
        )
      ).trim();
      mode =
        answer === "2"
          ? "power"
          : answer === "3"
            ? "maximum"
            : answer === "4"
              ? "custom"
              : "stable";
      if (mode === "custom") {
        const custom = await reader.question(
          "Enter comma-separated catalog package ids: ",
        );
        packageIds = custom
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
      }
    }
    if (!access && interactive && !options.yes) {
      reader ??= createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      access = interactiveModelApiAccess(
        await reader.question(
          "Separately billed model API access (ChatGPT/Claude subscriptions do not count): [0] None, [1] OpenAI API, [2] Anthropic API, [3] Both, [4] OpenRouter, [5] Other: ",
        ),
      );
    }
    access ??= { modelApis: [] };
    const selection = setupSelection(mode, packageIds);
    console.log(
      "\nPreparing a read-only install plan from screened immutable commits…",
    );
    const prepared = await prepareCatalogInstall(selection, {
      requestedAgents: parseAgentSelection(options.agents),
      onProgress: printSetupProgress,
      access,
    });
    console.log(
      `\n${formatPreparedCatalogInstall(prepared, { details: options.details })}\n`,
    );
    const risky = riskyPackageSummary(prepared);
    let approved = Boolean(options.yes);
    let riskApproved = Boolean(options.approveRisk);
    if (!approved) {
      if (!interactive) {
        console.log(formatCatalogApplyGuidance(Boolean(risky)));
        return;
      }
      reader ??= createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      approved = /^(?:y|yes)$/i.test(
        (
          await reader.question(
            "Install this loadout as one rollback-safe transaction? [y/N] ",
          )
        ).trim(),
      );
      if (!approved) {
        console.log("Cancelled; no agent files were changed.");
        return;
      }
    }
    if (risky && !riskApproved) {
      if (!interactive)
        throw new Error(
          `The screened skills contain additional safety findings: ${risky}. Inspect the preview and add --approve-risk to proceed.`,
        );
      reader ??= createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      console.log(`Additional safety findings: ${risky}`);
      riskApproved = /^(?:y|yes)$/i.test(
        (
          await reader.question(
            "Approve these reviewed script/domain/instruction findings? [y/N] ",
          )
        ).trim(),
      );
      if (!riskApproved) {
        console.log("Cancelled; no agent files were changed.");
        return;
      }
    }
    const snapshotId = await applyPreparedCatalogInstall(prepared, {
      approveRisk: riskApproved,
    });
    console.log(
      `\nLoadout installed ${prepared.entries.length} repositories for ${prepared.agents.length} agent(s). Snapshot: ${snapshotId}`,
    );
    console.log(
      "Next: `loadout status`, `loadout optimize --project .`, or `loadout autopilot --yes` for opt-in daily read-only discovery and update checks.",
    );
  } finally {
    reader?.close();
  }
}

/**
 * Zero-argument front door. On a TTY, bare `loadout` detects agents, shows the
 * current inventory, then hands off to the interactive setup flow. Non-TTY
 * callers never reach here (cli.ts prints the read-only guide instead), so this
 * stays safe to run without arguments in a real terminal only.
 */
export async function runWizard(): Promise<void> {
  console.log("Loadout — make your AI coding agents more capable\n");
  const detected = await detectAgents();
  const present = detected.filter((agent) => agent.installed);
  if (!present.length) {
    console.log(
      "No supported agents detected yet. Loadout works with Claude Code, Codex, Cursor,",
    );
    console.log(
      "Gemini CLI, OpenCode, and more. Install one, then run `loadout` again.\n",
    );
    printBeginnerGuide();
    return;
  }
  console.log(
    `Detected ${present.length} agent(s): ${present.map((agent) => agent.displayName).join(", ")}`,
  );
  console.log(formatInstalledSkillInventory(await scanInstalledSkills(present)));
  console.log(
    "\nPreview first — nothing changes until you approve, and every change is snapshotted for rollback.\n",
  );
  await runSetup({ package: [] });
}

export const LOADOUT_VERSION = "0.5.8";

export function durableSchedulerLauncher(): string[] {
  return [
    join(
      dirname(process.execPath),
      process.platform === "win32" ? "npx.cmd" : "npx",
    ),
    "--yes",
    `loadout-ai@${LOADOUT_VERSION}`,
  ];
}

export function printBeginnerGuide(): void {
  console.log(BEGINNER_GUIDE);
}
