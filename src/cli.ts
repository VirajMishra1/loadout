#!/usr/bin/env node
import { Command } from "commander";
import { loadEffectiveCatalog, loadCatalog, rankCatalog, refreshCatalog, selectCatalogPackages, type InstallSelectionMode } from "./core/catalog.js";
import { detectAgents } from "./core/paths.js";
import { readFile, readdir } from "node:fs/promises";
import { buildSkillPlan, applySkillInstall, installedAgents } from "./core/install.js";
import { restoreSnapshot } from "./core/snapshot.js";
import type { AgentId } from "./shared/types.js";
import { fetchRepositorySnapshot } from "./core/source.js";
import { discoverMcpManifests, summarizeMcpManifest, planMcpConfig, summarizeMcpConfigPlan, applyMcpConfigPlan } from "./core/mcp.js";
import type { McpServer } from "./shared/types.js";
import { runDoctor, formatDoctorReport } from "./core/doctor.js";
import { buildUpdatePlan, formatUpdatePlan } from "./core/update.js";
import { startApiServer } from "./core/api.js";
import { inspectPackage, formatPackageInspection } from "./core/package.js";
<<<<<<< Updated upstream
=======
import {
  addManifestPackage,
  applyProfileToManifest,
  initManifest,
  readManifest,
  removeManifestPackage,
  writeLockfile,
} from "./core/manifest.js";
import { buildHealthReport, formatHealthReport } from "./core/health.js";
import { readInstallState } from "./core/state.js";
import { applyRemove, planRemove } from "./core/remove.js";
import {
  formatRecommendations,
  profileManifestPackages,
  recommendPackages,
  scanProject,
  TESTED_PROFILES,
} from "./core/recommend.js";
import {
  buildImprovementCycle,
  formatImprovementCycle,
  recordImprovementOutcome,
  writeImprovementCycle,
} from "./core/improve.js";
import { applySyncPlan, buildSyncPlan } from "./core/sync.js";
import {
  createPackage,
  packPackage,
  publishLocalPackage,
  publishRemotePackage,
  searchLocalRegistry,
} from "./core/registry.js";
import { startRegistryServer } from "./core/registry-api.js";
import { auditLoadout, formatAuditReport } from "./core/audit.js";
import {
  ADAPTER_CAPABILITIES,
  formatCapabilityMatrix,
} from "./core/adapters.js";
import {
  formatAgentInventory,
  inspectAgents,
} from "./core/agent-inspection.js";
import {
  generateSigningKeys,
  signJsonFile,
  verifyJsonFile,
} from "./core/signing.js";
import {
  applyPortableImport,
  exportPortableLoadout,
  planPortableImport,
} from "./core/portable.js";
import {
  applyCodexMcpConfigPlan,
  defaultCodexMcpConfigPath,
  planCodexMcpConfig,
} from "./core/codex-mcp.js";
import { formatDemoResult, runIsolatedDemo } from "./core/demo.js";
import { resolveCatalogProfile } from "./core/profiles.js";
import { discoverHackerNewsRepositories } from "./core/community.js";
import { discoverPrivateRepositories } from "./core/private-discovery.js";
import { discoverGitHubRepositories } from "./core/github-discovery.js";
import {
  formatStarHistory,
  readCatalogObservations,
} from "./core/observations.js";
import { evaluatePackage, formatPackageEvaluation } from "./core/evaluate.js";
import { checkForUpdates, startUpdateWatcher } from "./core/update-watch.js";
import { runDisposableSandbox } from "./core/sandbox.js";
import {
  compileConversion,
  type ConversionKind,
  type ConversionTarget,
} from "./core/conversion.js";
import { writeFileAtomically } from "./core/atomic-file.js";
import { formatCanaryResult, runCanary } from "./core/canary.js";
import { startDashboardServer } from "./dashboard.js";
import {
  applyPreparedCatalogInstall,
  formatPreparedCatalogInstall,
  prepareCatalogInstall,
  type CatalogInstallProgress,
  type PreparedCatalogInstall,
} from "./core/catalog-install.js";
import {
  formatInstalledSkillInventory,
  scanInstalledSkills,
} from "./core/skill-inventory.js";
import {
  enrichInventoryWithProvenance,
  formatProvenanceSummary,
  resolveCatalogSkillIndex,
  type CatalogSkillIndexProgress,
} from "./core/provenance.js";
import { compareSkill, formatSkillComparison } from "./core/skill-compare.js";
import {
  applyActivationChange,
  buildLibraryStateReport,
  formatActivationPlan,
  formatLibraryStateReport,
  planActivationChange,
  type ActivationAction,
} from "./core/active-set.js";
import {
  applyProjectActivation,
  formatProjectActivation,
  planProjectActivation,
} from "./core/active-policy.js";
import {
  applySkillAdoption,
  formatAdoptionPlan,
  planSkillAdoption,
} from "./core/adopt.js";
import {
  formatReviewQueue,
  mergeReviewQueue,
  readReviewQueue,
  setReviewDecision,
  type ReviewDecision,
} from "./core/review-queue.js";
import {
  applyProviderModelSelection,
  defaultModelConfigurationPath,
  formatProviderModelConfiguration,
  planProviderModelSelection,
  readProviderModelConfiguration,
  requestOpenRouter,
} from "./core/model-config.js";
import {
  applyNativeScheduler,
  formatNativeScheduler,
  planNativeScheduler,
  type SchedulerAction,
} from "./core/scheduler.js";
import {
  buildPrivacySafeReport,
  formatPrivacySafeReport,
  writePrivacySafeReport,
} from "./core/share-report.js";
import {
  readLocalOutcomes,
  recordLocalOutcome,
  type OutcomeResult,
  type OutcomeTaskFamily,
} from "./core/outcomes.js";
import {
  buildFreshnessAlerts,
  formatFreshnessAlerts,
  ignoreFreshnessAlert,
} from "./core/freshness-alerts.js";
import {
  runHeadToHeadHarness,
  writeSignedHeadToHeadEvidence,
  type HeadToHeadFixture,
  type HeadToHeadTrial,
} from "./core/head-to-head.js";

const collectOption = (value: string, previous: string[] = []): string[] => [
  ...previous,
  value,
];

interface SetupOptions {
  mode?: string;
  agents?: string;
  package: string[];
  yes?: boolean;
  approveRisk?: boolean;
}

function setupSelection(
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

function printSetupProgress(progress: CatalogInstallProgress): void {
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

function printProvenanceProgress(progress: CatalogSkillIndexProgress): void {
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

function riskyPackageSummary(prepared: PreparedCatalogInstall): string {
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

async function runSetup(options: SetupOptions): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  let mode = options.mode;
  let packageIds = options.package ?? [];
  let reader: ReturnType<typeof createInterface> | undefined;
  try {
    if (!mode) {
      if (!interactive) {
        console.log(
          "Loadout is CLI-first. Run `loadout setup --mode power` for the broad daily driver, `--mode stable` for the smallest foundation, or `--mode maximum` to download the reviewed library without activating it.",
        );
        return;
      }
      reader = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const answer = (
        await reader.question(
          "Choose a loadout: [1] Power Boost (recommended), [2] Stable Boost, [3] Maximum Library, [4] Custom: ",
        )
      ).trim();
      mode =
        answer === "2"
          ? "stable"
          : answer === "3"
            ? "maximum"
            : answer === "4"
              ? "custom"
              : "power";
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
    const selection = setupSelection(mode, packageIds);
    console.log("\nPreparing a read-only install plan from reviewed commits…");
    const prepared = await prepareCatalogInstall(selection, {
      requestedAgents: options.agents?.split(",") as AgentId[] | undefined,
      onProgress: printSetupProgress,
    });
    console.log(`\n${formatPreparedCatalogInstall(prepared)}\n`);
    const risky = riskyPackageSummary(prepared);
    let approved = Boolean(options.yes);
    let riskApproved = Boolean(options.approveRisk);
    if (!approved) {
      if (!interactive) {
        console.log(
          "Preview complete; nothing was changed. Re-run with --yes to install this exact reviewed plan.",
        );
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
          `The reviewed skills contain additional safety findings: ${risky}. Inspect the preview and add --approve-risk to proceed.`,
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
      "Next: `loadout status`, `loadout update`, or `loadout rollback`.",
    );
  } finally {
    reader?.close();
  }
}
>>>>>>> Stashed changes

const program = new Command();
program.name("loadout").description("Universal upgrade manager for AI coding agents").version("0.1.0");

program.command("status").description("Show detected coding agents").action(async () => {
  const agents = await detectAgents();
  for (const agent of agents) {
    console.log(`${agent.installed ? "✓" : "○"} ${agent.displayName} — ${agent.skillsDirectory}`);
  }
});

program.command("doctor")
  .description("Check agents, skill directories, permissions, and Loadout setup")
  .option("--json", "print a machine-readable report")
  .action(async (options: { json?: boolean }) => {
    const report = await runDoctor();
    console.log(options.json ? JSON.stringify(report, null, 2) : formatDoctorReport(report));
  });

program.command("catalog").description("List the real package catalog")
  .option("--refresh", "fetch current GitHub stars and repository metadata")
  .action(async (options: { refresh?: boolean }) => {
  const base = await loadCatalog();
  const result = options.refresh ? await refreshCatalog(base, { forceRefresh: true }) : { catalog: await loadEffectiveCatalog(), failures: [] };
  for (const pkg of rankCatalog(result.catalog)) {
    const topics = pkg.topics?.length ? ` — ${pkg.topics.join(", ")}` : "";
    const updated = pkg.lastUpdatedAt ? ` — updated ${pkg.lastUpdatedAt.slice(0, 10)}` : "";
    console.log(`${pkg.displayName} [${pkg.tier}] ★${pkg.stars ?? "?"} — ${pkg.repository}${topics}${updated}`);
  }
  for (const failure of result.failures) console.error(`Warning: could not refresh ${failure.repository}: ${failure.error}`);
});

<<<<<<< Updated upstream
program.command("mcp")
=======
program
  .command("discover")
  .description("Find public community leads; discovery never installs anything")
  .option(
    "--source <source>",
    "community source: github, hacker-news, or all",
    "hacker-news",
  )
  .option("--limit <count>", "front-page stories to inspect", "50")
  .option("--min-score <count>", "minimum Hacker News score", "20")
  .option(
    "--query <words>",
    "comma-separated words that must appear in a story (for example: codex,mcp,agent)",
  )
  .option(
    "--private",
    "opt into private GitHub metadata discovery using GITHUB_TOKEN",
  )
  .option(
    "--queue",
    "persist deduplicated public leads for human review; never promotes them",
  )
  .option("--json", "emit source evidence as JSON")
  .action(
    async (options: {
      source: string;
      limit: string;
      minScore: string;
      query?: string;
      private?: boolean;
      queue?: boolean;
      json?: boolean;
    }) => {
      const limit = Number(options.limit);
      if (!Number.isInteger(limit) || limit < 1)
        throw new Error("--limit must be a positive integer");
      if (options.private) {
        const repositories = await discoverPrivateRepositories();
        if (options.json)
          return console.log(JSON.stringify(repositories, null, 2));
        console.log(`Private GitHub repositories: ${repositories.length}`);
        for (const repository of repositories)
          console.log(`${repository.repository} — ${repository.description}`);
        return;
      }
      if (options.source === "all") {
        const minScore = Number(options.minScore);
        if (!Number.isFinite(minScore) || minScore < 0)
          throw new Error("--min-score must be a non-negative number");
        const [github, hackerNews] = await Promise.allSettled([
          discoverGitHubRepositories({
            query:
              options.query ??
              "(topic:mcp OR topic:agent OR topic:skills) created:>=2026-01-01",
            limit,
          }),
          discoverHackerNewsRepositories({
            limit,
            minScore,
            keywords: options.query?.split(",") ?? [],
          }),
        ]);
        const leads = [
          ...(github.status === "fulfilled" ? github.value : []),
          ...(hackerNews.status === "fulfilled" ? hackerNews.value.candidates : []),
        ];
        if (!leads.length) {
          const failures = [github, hackerNews]
            .filter((result): result is PromiseRejectedResult => result.status === "rejected")
            .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
          throw new Error(`All discovery sources failed: ${failures.join("; ")}`);
        }
        const sourceWarnings = [github, hackerNews]
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
        const queue = options.queue
          ? await mergeReviewQueue(leads, await loadEffectiveCatalog())
          : undefined;
        const output = { leads, queue, sourceWarnings };
        if (options.json) return console.log(JSON.stringify(output, null, 2));
        if (queue) console.log(formatReviewQueue(queue));
        else console.log(`Multi-source discovery: ${leads.length} public lead(s).`);
        for (const warning of sourceWarnings) console.error(`Warning: ${warning}`);
        return;
      }
      if (options.source === "github") {
        const repositories = await discoverGitHubRepositories({
          query:
            options.query ??
            "(topic:mcp OR topic:agent OR topic:skills) created:>=2026-01-01",
          limit,
        });
        if (options.queue) {
          const queue = await mergeReviewQueue(
            repositories,
            await loadEffectiveCatalog(),
          );
          if (options.json) return console.log(JSON.stringify(queue, null, 2));
          console.log(formatReviewQueue(queue));
          return;
        }
        if (options.json)
          return console.log(JSON.stringify(repositories, null, 2));
        console.log(`GitHub: ${repositories.length} repository lead(s)`);
        for (const repository of repositories)
          console.log(
            `★${repository.stars} · ${repository.repository} — ${repository.description}`,
          );
        return;
      }
      if (options.source !== "hacker-news")
        throw new Error(
          `Unsupported discovery source '${options.source}'. Supported: github, hacker-news, all`,
        );
      const minScore = Number(options.minScore);
      if (!Number.isFinite(minScore) || minScore < 0)
        throw new Error("--min-score must be a non-negative number");
      const result = await discoverHackerNewsRepositories({
        limit,
        minScore,
        keywords: options.query?.split(",") ?? [],
      });
      if (options.queue) {
        const queue = await mergeReviewQueue(
          result.candidates,
          await loadEffectiveCatalog(),
        );
        if (options.json) return console.log(JSON.stringify(queue, null, 2));
        console.log(formatReviewQueue(queue));
        return;
      }
      if (options.json) return console.log(JSON.stringify(result, null, 2));
      console.log(
        `Hacker News: ${result.candidates.length} GitHub repository lead(s) from ${result.storiesScanned} stories.`,
      );
      for (const candidate of result.candidates) {
        console.log(
          `★${candidate.score} · ${candidate.repository} — ${candidate.title}\n  ${candidate.discussionUrl}`,
        );
      }
    },
  );

program
  .command("review-queue")
  .description(
    "Show deduplicated discovery leads awaiting human review; never installs",
  )
  .option("--decision <value>", "filter: pending, shortlisted, or ignored")
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { decision?: string; json?: boolean }) => {
    const queue = await readReviewQueue();
    if (
      options.decision &&
      !["pending", "shortlisted", "ignored"].includes(options.decision)
    )
      throw new Error("--decision must be pending, shortlisted, or ignored");
    const filtered = options.decision
      ? {
          ...queue,
          items: queue.items.filter(
            (item) => item.decision === options.decision,
          ),
        }
      : queue;
    console.log(
      options.json
        ? JSON.stringify(filtered, null, 2)
        : formatReviewQueue(filtered),
    );
  });

program
  .command("review")
  .description(
    "Record a human queue decision; shortlisting still does not promote or install",
  )
  .argument("<repository>", "owner/repository")
  .requiredOption("--decision <value>", "pending, shortlisted, or ignored")
  .action(async (repository: string, options: { decision: string }) => {
    if (!["pending", "shortlisted", "ignored"].includes(options.decision))
      throw new Error("--decision must be pending, shortlisted, or ignored");
    const item = await setReviewDecision(
      repository,
      options.decision as ReviewDecision,
    );
    console.log(
      `${item.repository}: ${item.decision}. No catalog or agent files changed.`,
    );
  });

const models = program
  .command("models")
  .description(
    "Plan, apply, inspect, or verify secret-free provider model selections",
  );

models
  .command("status")
  .description("Show configured model metadata and credential references")
  .option("--config <path>", "model configuration path")
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { config?: string; json?: boolean }) => {
    const configuration = await readProviderModelConfiguration(
      options.config ?? defaultModelConfigurationPath(),
    );
    console.log(
      options.json
        ? JSON.stringify(configuration ?? null, null, 2)
        : formatProviderModelConfiguration(configuration),
    );
  });

models
  .command("set")
  .description("Plan or store one provider selection; never stores a raw key")
  .requiredOption("--id <id>", "selection id")
  .requiredOption("--model <model>", "provider model identifier")
  .option("--provider <provider>", "provider id", "openrouter")
  .option(
    "--endpoint <url>",
    "provider HTTPS endpoint",
    "https://openrouter.ai/api/v1",
  )
  .option(
    "--credential-env <name>",
    "environment variable reference",
    "OPENROUTER_API_KEY",
  )
  .option("--agents <ids>", "comma-separated target agent ids")
  .option("--config <path>", "model configuration path")
  .option("--yes", "apply after preview")
  .option("--json", "emit machine-readable JSON")
  .action(
    async (options: {
      id: string;
      model: string;
      provider: string;
      endpoint: string;
      credentialEnv: string;
      agents?: string;
      config?: string;
      yes?: boolean;
      json?: boolean;
    }) => {
      const plan = await planProviderModelSelection(
        {
          id: options.id,
          provider: options.provider,
          model: options.model,
          endpoint: options.endpoint,
          credential: {
            kind: "environment",
            name: options.credentialEnv,
          },
          ...(options.agents
            ? { targetAgents: options.agents.split(",") as AgentId[] }
            : {}),
        },
        options.config ?? defaultModelConfigurationPath(),
      );
      if (!options.yes) {
        console.log(
          options.json
            ? JSON.stringify(plan, null, 2)
            : `${formatProviderModelConfiguration(plan.configuration)}\nPath: ${plan.path}\nDry run only. Re-run with --yes to save metadata and the credential reference.`,
        );
        return;
      }
      const snapshotId = await applyProviderModelSelection(plan);
      console.log(
        options.json
          ? JSON.stringify(
              { configuration: plan.configuration, snapshotId },
              null,
              2,
            )
          : `${formatProviderModelConfiguration(plan.configuration)}\nSaved. Snapshot: ${snapshotId}`,
      );
    },
  );

models
  .command("verify")
  .description(
    "Make one explicit minimal provider request using the referenced environment key",
  )
  .argument("<id>", "selection id")
  .option("--config <path>", "model configuration path")
  .action(async (id: string, options: { config?: string }) => {
    const configuration = await readProviderModelConfiguration(
      options.config ?? defaultModelConfigurationPath(),
    );
    if (!configuration)
      throw new Error("No provider model configuration exists");
    await requestOpenRouter(
      configuration,
      id,
      [
        {
          role: "user",
          content: "Reply with the single word OK.",
        },
      ],
      {
        resolveCredential: async (reference) => {
          if (reference.kind !== "environment")
            throw new Error(
              "OS keychain resolution is not available in this build",
            );
          return process.env[reference.name];
        },
      },
    );
    console.log(
      `Verified model selection '${id}'. No credential value was stored or printed.`,
    );
  });

program
  .command("keygen")
  .description("Generate an Ed25519 signing keypair outside the repository")
  .requiredOption("--private-key <path>", "new private key path (owner-only)")
  .requiredOption("--public-key <path>", "new public key path")
  .action(async (options: { privateKey: string; publicKey: string }) => {
    const result = await generateSigningKeys(
      options.privateKey,
      options.publicKey,
    );
    console.log(
      `Generated signing keys. Public fingerprint: ${result.fingerprint}\nPrivate key: ${result.privateKey}\nPublic key: ${result.publicKey}`,
    );
  });

program
  .command("catalog-sign")
  .description("Create a signed immutable catalog envelope")
  .requiredOption("--catalog <path>", "catalog JSON path")
  .requiredOption("--private-key <path>", "Ed25519 private key path")
  .requiredOption("--output <path>", "new signed snapshot path")
  .action(
    async (options: {
      catalog: string;
      privateKey: string;
      output: string;
    }) => {
      const envelope = await signJsonFile(
        options.catalog,
        options.privateKey,
        options.output,
      );
      console.log(
        `Signed catalog snapshot with ${envelope.publicKeyFingerprint}.`,
      );
    },
  );

program
  .command("catalog-verify")
  .description("Verify a signed catalog snapshot before trusting it")
  .requiredOption("--snapshot <path>", "signed snapshot path")
  .requiredOption("--public-key <path>", "trusted Ed25519 public key path")
  .action(async (options: { snapshot: string; publicKey: string }) => {
    const result = await verifyJsonFile(options.snapshot, options.publicKey);
    console.log(
      `${result.valid ? "VALID" : "INVALID"} catalog signature (${result.fingerprint})`,
    );
    if (!result.valid) process.exitCode = 1;
  });

program
  .command("mcp")
>>>>>>> Stashed changes
  .description("Inspect MCP manifests without executing servers or scripts")
  .option("--source <directory>", "local repository directory")
  .option("--repository <owner/repo>", "public GitHub repository")
  .option("--json", "emit normalized JSON")
  .action(async (options: { source?: string; repository?: string; json?: boolean }) => {
    if ((options.source ? 1 : 0) + (options.repository ? 1 : 0) !== 1) {
      throw new Error("Provide exactly one of --source or --repository");
    }
    const source = options.repository ? (await fetchRepositorySnapshot(options.repository)).path : options.source!;
    const manifests = await discoverMcpManifests(source);
    if (options.json) console.log(JSON.stringify(manifests, null, 2));
    else if (manifests.length === 0) console.log("No supported MCP manifests found.");
    else for (const manifest of manifests) console.log(summarizeMcpManifest(manifest));
  });

program.command("inspect")
  .description("Inspect skills and MCP components in a local directory or public GitHub repository")
  .option("--source <directory>", "local package directory")
  .option("--repository <owner/repo>", "public GitHub repository")
  .option("--json", "emit normalized JSON")
  .action(async (options: { source?: string; repository?: string; json?: boolean }) => {
    if ((options.source ? 1 : 0) + (options.repository ? 1 : 0) !== 1) throw new Error("Provide exactly one of --source or --repository");
    const source = options.repository ? (await fetchRepositorySnapshot(options.repository)).path : options.source!;
    const result = await inspectPackage(source);
    console.log(options.json ? JSON.stringify(result, null, 2) : formatPackageInspection(result));
  });

<<<<<<< Updated upstream
program.command("mcp-config")
  .description("Plan or apply a safe MCP server configuration change (dry-run by default)")
=======
program
  .command("evaluate")
  .description(
    "Evaluate static skill and MCP evidence without executing package code",
  )
  .option("--source <directory>", "local package directory")
  .option("--repository <owner/repo>", "public GitHub repository")
  .option("--json", "emit evaluation JSON")
  .action(
    async (options: {
      source?: string;
      repository?: string;
      json?: boolean;
    }) => {
      if ((options.source ? 1 : 0) + (options.repository ? 1 : 0) !== 1)
        throw new Error("Provide exactly one of --source or --repository");
      const source = options.repository
        ? (await fetchRepositorySnapshot(options.repository)).path
        : options.source!;
      const result = await evaluatePackage(source);
      console.log(
        options.json
          ? JSON.stringify(result, null, 2)
          : formatPackageEvaluation(result),
      );
    },
  );

program
  .command("head-to-head")
  .description(
    "Score synthetic workflow or code-review trials and write signed evidence; never executes candidate content",
  )
  .requiredOption("--fixture <path>", "synthetic fixture JSON path")
  .requiredOption("--trials <path>", "declared trial observations JSON path")
  .requiredOption("--private-key <path>", "Ed25519 private key PEM path")
  .requiredOption("--output <path>", "new signed evidence JSON path")
  .option("--json", "emit the signed envelope as JSON")
  .action(
    async (options: {
      fixture: string;
      trials: string;
      privateKey: string;
      output: string;
      json?: boolean;
    }) => {
      const [fixture, trials, privateKey] = await Promise.all([
        readFile(resolve(options.fixture), "utf8").then(
          (value) => JSON.parse(value) as HeadToHeadFixture,
        ),
        readFile(resolve(options.trials), "utf8").then(
          (value) => JSON.parse(value) as HeadToHeadTrial[],
        ),
        readFile(resolve(options.privateKey), "utf8"),
      ]);
      const evidence = runHeadToHeadHarness(fixture, trials);
      const envelope = await writeSignedHeadToHeadEvidence(
        evidence,
        privateKey,
        options.output,
      );
      console.log(
        options.json
          ? JSON.stringify(envelope, null, 2)
          : `Signed ${evidence.category} evidence for ${evidence.results.length} trial(s).\nOutput: ${resolve(options.output)}\nFingerprint: ${envelope.publicKeyFingerprint}`,
      );
    },
  );

program
  .command("watch")
  .description(
    "Watch for read-only updates; never applies changes automatically",
  )
  .option("--interval <minutes>", "check interval", "1440")
  .option("--once", "check once and exit")
  .option("--json", "emit each notification as JSON")
  .action(
    async (options: { interval: string; once?: boolean; json?: boolean }) => {
      const minutes = Number(options.interval);
      if (!Number.isFinite(minutes) || minutes <= 0)
        throw new Error("--interval must be a positive number of minutes");
      const notify = (
        notification: Awaited<ReturnType<typeof checkForUpdates>>,
      ) =>
        console.log(
          options.json
            ? JSON.stringify(notification)
            : `${notification.checkedAt}: ${notification.message}`,
        );
      if (options.once) {
        notify(await checkForUpdates());
        return;
      }
      const stop = startUpdateWatcher({
        intervalMs: minutes * 60_000,
        notify,
      });
      const shutdown = () => {
        stop();
        process.exit(0);
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
      await new Promise<void>(() => undefined);
    },
  );

for (const action of [
  "schedule",
  "unschedule",
] as const satisfies SchedulerAction[]) {
  program
    .command(action)
    .description(
      `${action === "schedule" ? "Install" : "Remove"} the native daily read-only update check`,
    )
    .option("--time <HH:MM>", "local daily check time", "09:00")
    .option("--yes", "apply the native scheduler change")
    .option("--json", "emit machine-readable JSON")
    .action(
      async (options: { time: string; yes?: boolean; json?: boolean }) => {
        const plan = planNativeScheduler(action, {
          time: options.time,
          cliPath: process.argv[1],
        });
        if (!options.yes) {
          console.log(
            options.json
              ? JSON.stringify(plan, null, 2)
              : `${formatNativeScheduler(plan)}\nDry run only. Re-run with --yes to change the native scheduler.`,
          );
          return;
        }
        const snapshotId = await applyNativeScheduler(plan);
        console.log(
          options.json
            ? JSON.stringify({ plan, snapshotId }, null, 2)
            : `${formatNativeScheduler(plan)}\nApplied. Snapshot: ${snapshotId}`,
        );
      },
    );
}

program
  .command("sandbox-run")
  .description(
    "Run an explicitly approved command in a disposable networkless Docker sandbox",
  )
  .requiredOption("--source <directory>", "read-only source directory")
  .requiredOption("--image <image>", "reviewed/pinned Docker image reference")
  .requiredOption(
    "--command <argument>",
    "command argument (repeatable; first is executable)",
    (value: string, previous: string[] = []) => [...previous, value],
    [],
  )
  .requiredOption("--approve-risk", "explicitly approve sandbox execution")
  .option("--timeout <milliseconds>", "execution timeout", "120000")
  .option("--json", "emit result JSON")
  .action(
    async (options: {
      source: string;
      image: string;
      command: string[];
      approveRisk: boolean;
      timeout: string;
      json?: boolean;
    }) => {
      const result = await runDisposableSandbox({
        sourceDirectory: options.source,
        image: options.image,
        command: options.command,
        approveRisk: options.approveRisk,
        timeoutMs: Number(options.timeout),
      });
      console.log(
        options.json
          ? JSON.stringify(result, null, 2)
          : `Sandbox exited ${result.exitCode}\n${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`,
      );
      if (result.exitCode !== 0) process.exitCode = result.exitCode;
    },
  );

program
  .command("mcp-config")
  .description(
    "Plan or apply a safe MCP server configuration change (dry-run by default)",
  )
>>>>>>> Stashed changes
  .requiredOption("--config <path>", "MCP JSON configuration path")
  .requiredOption("--name <name>", "server name")
  .option("--command <command>", "local server command")
  .option("--url <url>", "remote MCP server URL")
  .option("--arg <value>", "server argument (repeatable)", (value: string, previous: string[] = []) => [...previous, value], [])
  .option("--env <NAME=VALUE>", "environment variable (repeatable; values are never printed)", (value: string, previous: string[] = []) => [...previous, value], [])
  .option("--yes", "apply the change; without this flag only a plan is shown")
  .action(async (options: { config: string; name: string; command?: string; url?: string; arg: string[]; env: string[]; yes?: boolean }) => {
    if ((options.command ? 1 : 0) + (options.url ? 1 : 0) !== 1) throw new Error("Provide exactly one of --command or --url");
    const env: Record<string, string> = {};
    for (const item of options.env) {
      const separator = item.indexOf("=");
      if (separator <= 0) throw new Error(`Invalid --env '${item}'; expected NAME=VALUE`);
      const key = item.slice(0, separator);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid environment variable name '${key}'`);
      env[key] = item.slice(separator + 1);
    }
    const server: McpServer = { name: options.name, command: options.command, url: options.url, args: options.arg, env, sourcePath: options.config, warnings: [] };
    const plan = await planMcpConfig(options.config, server);
    console.log(summarizeMcpConfigPlan(plan));
    if (!options.yes) {
      console.log("Dry run only. Re-run with --yes to apply this change.");
      return;
    }
    const snapshot = await applyMcpConfigPlan(plan);
    console.log(`Applied successfully. Snapshot: ${snapshot.id}`);
  });

program.command("plan")
  .description("Plan installing packages from a local directory, catalog, or public GitHub repository")
  .option("--source <directory>", "local package directory containing SKILL.md")
  .option("--repository <owner/repo>", "public GitHub repository containing SKILL.md")
  .option("--package <id>", "package identifier (repeat for custom mode)", (value: string, previous: string[] = []) => [...previous, value], [])
  .option("--mode <mode>", "catalog selection mode: stable, maximum, or custom")
  .option("--agents <ids>", "comma-separated agent ids; defaults to all detected agents")
  .action(async (options: { source?: string; repository?: string; package: string[]; mode?: string; agents?: string }) => {
    const packageIds = options.package ?? [];
    const hasSource = Boolean(options.source || options.repository);
    if (hasSource && options.mode) throw new Error("--mode cannot be combined with --source or --repository");
    if (hasSource && packageIds.length !== 1) throw new Error("A source or repository requires exactly one --package");
    if (!hasSource && !options.mode) throw new Error("Provide --mode or exactly one of --source/--repository");
    const selected = hasSource ? [{ id: packageIds[0] }] : selectCatalogPackages(await loadEffectiveCatalog(), { mode: options.mode as InstallSelectionMode, packageIds });
    const agents = installedAgents(await detectAgents(), options.agents?.split(",") as AgentId[] | undefined);
    const plans = [];
    const skipped: Array<{ packageId: string; reason: string }> = [];
    for (const pkg of selected) {
      const fetched = options.repository ? await fetchRepositorySnapshot(options.repository) : (!options.source ? await fetchRepositorySnapshot((pkg as { repository: string }).repository) : undefined);
      try {
        plans.push(await buildSkillPlan(fetched?.path ?? options.source!, pkg.id, agents));
      } catch (error) {
        if (!options.mode || !(error instanceof Error) || !error.message.startsWith("No SKILL.md found")) throw error;
        skipped.push({ packageId: pkg.id, reason: "No SKILL.md found; this package is not skill-installable yet (inspect its MCP manifest instead)." });
      }
    }
    console.log(JSON.stringify(options.mode ? { mode: options.mode, packages: plans, skipped } : plans[0], null, 2));
  });

program.command("install")
  .description("Install packages from a local directory, catalog, or public GitHub repository")
  .option("--source <directory>", "local package directory containing SKILL.md")
  .option("--repository <owner/repo>", "public GitHub repository containing SKILL.md")
  .option("--package <id>", "package identifier (repeat for custom mode)", (value: string, previous: string[] = []) => [...previous, value], [])
  .option("--mode <mode>", "catalog selection mode: stable, maximum, or custom")
  .option("--agents <ids>", "comma-separated agent ids; defaults to all detected agents")
  .option("--yes", "apply without interactive confirmation")
  .action(async (options: { source?: string; repository?: string; package: string[]; mode?: string; agents?: string; yes?: boolean }) => {
    const packageIds = options.package ?? [];
    const hasSource = Boolean(options.source || options.repository);
    if (hasSource && options.mode) throw new Error("--mode cannot be combined with --source or --repository");
    if (hasSource && packageIds.length !== 1) throw new Error("A source or repository requires exactly one --package");
    if (!hasSource && !options.mode) throw new Error("Provide --mode or exactly one of --source/--repository");
    const selected = hasSource ? [{ id: packageIds[0] }] : selectCatalogPackages(await loadEffectiveCatalog(), { mode: options.mode as InstallSelectionMode, packageIds });
    const agents = installedAgents(await detectAgents(), options.agents?.split(",") as AgentId[] | undefined);
    const plans: Array<{ plan: Awaited<ReturnType<typeof buildSkillPlan>>; repository?: string; commit?: string }> = [];
    const skipped: Array<{ packageId: string; reason: string }> = [];
    for (const pkg of selected) {
      const fetched = options.repository ? await fetchRepositorySnapshot(options.repository) : (!options.source ? await fetchRepositorySnapshot((pkg as { repository: string }).repository) : undefined);
      try {
        plans.push({ plan: await buildSkillPlan(fetched?.path ?? options.source!, pkg.id, agents), repository: fetched?.repository, commit: fetched?.commit });
      } catch (error) {
        if (!options.mode || !(error instanceof Error) || !error.message.startsWith("No SKILL.md found")) throw error;
        skipped.push({ packageId: pkg.id, reason: "No SKILL.md found; this package is not skill-installable yet (inspect its MCP manifest instead)." });
      }
    }
    console.log(`Installing ${plans.map(({ plan }) => plan.packageId).join(", ")} for ${agents.map((agent) => agent.id).join(", ")}...`);
    for (const entry of skipped) console.log(`Skipping ${entry.packageId}: ${entry.reason}`);
    if (!options.yes) console.log("Review the plan with `loadout plan`; use --yes to apply it.");
    if (!options.yes) return;
    for (const entry of plans) {
      const snapshotId = await applySkillInstall(entry.plan, entry.repository ? { repository: entry.repository, resolvedCommit: entry.commit } : undefined);
      console.log(`Installed ${entry.plan.packageId} successfully. Snapshot: ${snapshotId}`);
    }
  });

program.command("rollback")
  .description("Restore the most recent Loadout snapshot")
  .option("--snapshot <id>", "specific snapshot id")
  .action(async (options: { snapshot?: string }) => {
    const directory = process.env.LOADOUT_HOME ?? `${process.env.HOME ?? process.cwd()}/.loadout`;
    const snapshotFiles = (await readdir(`${directory}/snapshots`)).filter((file) => file.endsWith(".json")).sort();
    const selected = options.snapshot ? `${options.snapshot}.json` : snapshotFiles.at(-1);
    if (!selected) throw new Error("No Loadout snapshots found");
    const snapshot = JSON.parse(await readFile(`${directory}/snapshots/${selected}`, "utf8"));
    await restoreSnapshot(snapshot);
    console.log(`Restored snapshot ${selected.replace(/\.json$/, "")}`);
  });

program.command("update")
  .description("Plan updates for installed packages without changing files")
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    const plans = await buildUpdatePlan();
    console.log(options.json ? JSON.stringify(plans, null, 2) : formatUpdatePlan(plans));
  });

program.command("serve")
  .description("Start a loopback-only read-only API for status, catalog, and updates")
  .option("--host <host>", "bind address (defaults to 127.0.0.1)", "127.0.0.1")
  .option("--port <port>", "TCP port (0 selects an available port)", "0")
  .action(async (options: { host: string; port: string }) => {
    const handle = await startApiServer({ host: options.host, port: Number(options.port) });
    console.log(`Loadout API listening at http://${handle.host}:${handle.port}`);
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
    await handle.close();
  });

program.action(async () => {
  const agents = await detectAgents();
  const packages = rankCatalog(await loadEffectiveCatalog());
  console.log("Loadout detected:");
  for (const agent of agents) console.log(`  ${agent.installed ? "✓" : "○"} ${agent.displayName}`);
  console.log(`\n${packages.length} real catalog packages are available.`);
  console.log("Run `loadout status` or `loadout catalog` for details.");
});

await program.parseAsync();
