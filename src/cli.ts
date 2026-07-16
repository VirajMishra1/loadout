#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { createInterface } from "node:readline/promises";
import {
  explainCatalogScore,
  loadEffectiveCatalog,
  loadCatalog,
  rankCatalog,
  refreshCatalog,
  type InstallSelectionMode,
} from "./core/catalog.js";
import { detectAgents, parseAgentSelection } from "./core/paths.js";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  buildSkillPlan,
  applySkillInstall,
  installedAgents,
} from "./core/install.js";
import {
  listSnapshotIds,
  readSnapshot,
  restoreSnapshot,
} from "./core/snapshot.js";
import type { AgentId } from "./shared/types.js";
import { fetchRepositorySnapshot } from "./core/source.js";
import {
  discoverMcpManifests,
  summarizeMcpManifest,
  planMcpConfig,
  summarizeMcpConfigPlan,
  applyMcpConfigPlan,
} from "./core/mcp.js";
import {
  REVIEWED_MCP_RECIPES,
  findMcpRecipe,
  formatMcpRecipePlan,
  planMcpRecipe,
  verifyMcpRecipe,
  verifyMcpRecipeConnection,
} from "./core/mcp-recipes.js";
import type { McpServer } from "./shared/types.js";
import { runDoctor, formatDoctorReport } from "./core/doctor.js";
import {
  applyPackageUpdate,
  buildUpdatePlan,
  formatUpdatePlan,
} from "./core/update.js";
import { startApiServer } from "./core/api.js";
import { inspectPackage, formatPackageInspection } from "./core/package.js";
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
  personalizeRecommendations,
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
  buildAdapterCapabilityGaps,
  formatAdapterCapabilityGaps,
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
import { catalogTrustStage, resolveCatalogProfile } from "./core/profiles.js";
import { discoverHackerNewsRepositories } from "./core/community.js";
import { discoverPrivateRepositories } from "./core/private-discovery.js";
import {
  defaultGitHubDiscoveryQueries,
  discoverGitHubRepositories,
} from "./core/github-discovery.js";
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
  applyNativeSchedulerBundle,
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
  pinReplacement,
  readReplacementPins,
  unpinReplacement,
} from "./core/freshness-alerts.js";
import {
  runHeadToHeadHarness,
  replacementEvidenceFromSignedSnapshot,
  writeSignedHeadToHeadEvidence,
  type HeadToHeadFixture,
  type HeadToHeadTrial,
} from "./core/head-to-head.js";
import {
  parseCompletionShell,
  renderShellCompletion,
} from "./core/completion.js";
import {
  buildCatalogCoverage,
  formatCatalogCoverage,
} from "./core/catalog-coverage.js";
import {
  createCredentialResolver,
  createOsCredentialStore,
} from "./core/credentials.js";
import {
  buildCandidateDossier,
  buildCatalogProposal,
  formatCandidateDossier,
  formatCandidateSummaries,
  listDiscoveryCandidates,
  readCandidateDossier,
  verifyCandidateDossierSource,
  writeCandidateDossier,
} from "./core/candidate-intelligence.js";
import {
  applyCatalogRelease,
  formatCatalogReleasePreview,
  previewCatalogRelease,
} from "./core/catalog-release.js";
import type { OperatingSystem, PackageTier } from "./shared/types.js";
import {
  recoverPendingTransactions,
  withMutationLock,
} from "./core/transaction.js";

const collectOption = (value: string, previous: string[] = []): string[] => [
  ...previous,
  value,
];

async function readCredentialFromStdin(): Promise<string> {
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
          "Loadout is CLI-first. Run `loadout setup --mode stable` for the recommended daily driver, `--mode power` for broader opt-in skills, or `--mode maximum` to download the screened library without activating it.",
        );
        return;
      }
      reader = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const answer = (
        await reader.question(
          "Choose a loadout: [1] Stable Daily Driver (recommended), [2] Power Boost, [3] Maximum Library, [4] Custom: ",
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
    const selection = setupSelection(mode, packageIds);
    console.log(
      "\nPreparing a read-only install plan from screened immutable commits…",
    );
    const prepared = await prepareCatalogInstall(selection, {
      requestedAgents: parseAgentSelection(options.agents),
      onProgress: printSetupProgress,
    });
    console.log(`\n${formatPreparedCatalogInstall(prepared)}\n`);
    const risky = riskyPackageSummary(prepared);
    let approved = Boolean(options.yes);
    let riskApproved = Boolean(options.approveRisk);
    if (!approved) {
      if (!interactive) {
        console.log(
          "Preview complete; nothing was changed. Re-run with --yes to install this exact screened plan.",
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

const LOADOUT_VERSION = "0.1.0";

function durableSchedulerLauncher(): string[] {
  return [
    join(
      dirname(process.execPath),
      process.platform === "win32" ? "npx.cmd" : "npx",
    ),
    "--yes",
    `loadout-ai@${LOADOUT_VERSION}`,
  ];
}

const program = new Command();
program
  .name("loadout")
  .description("The trusted upgrade layer for AI coding agents")
  .version(LOADOUT_VERSION)
  .option(
    "--json-errors",
    "emit a machine-readable error object on stderr; normal output is unchanged",
  )
  // Commander normally calls process.exit() immediately after rendering help
  // or version output. Large top-level help can then be truncated to one pipe
  // buffer when Loadout is invoked by another process. Keep control in this
  // module so Node has time to flush stdout before exiting naturally.
  .exitOverride()
  // The catch block below is the single error renderer. Commander otherwise
  // writes its own parse error first, producing two stderr documents and
  // breaking --json-errors consumers.
  .configureOutput({ writeErr: () => undefined });

program
  .command("setup")
  .description(
    "Preview and install a screened skill loadout for detected agents",
  )
  .option("--mode <mode>", "stable, power, maximum, or custom")
  .option("--agents <ids>", "comma-separated target agent ids")
  .option("--package <id>", "package id for custom mode", collectOption, [])
  .option("-y, --yes", "install after preparing the screened plan")
  .option(
    "--approve-risk",
    "approve reviewed safety findings in non-interactive mode",
  )
  .action((options: SetupOptions) => runSetup(options));

program
  .command("init")
  .description("Create a shareable loadout.json manifest")
  .option("--path <path>", "manifest path", "loadout.json")
  .option("--name <name>", "Loadout name")
  .option("--agents <ids>", "comma-separated agent ids", "codex,claude-code")
  .option("--scope <scope>", "project or global", "project")
  .action(
    async (options: {
      path: string;
      name?: string;
      agents: string;
      scope: string;
    }) => {
      const manifest = await initManifest(options.path, {
        name: options.name,
        agents: parseAgentSelection(options.agents)!,
        scope: options.scope as "project" | "global",
      });
      console.log(`Created ${options.path} for ${manifest.agents.join(", ")}.`);
    },
  );

program
  .command("lock")
  .description("Write exact installed state to loadout.lock")
  .option("--manifest <path>", "manifest path", "loadout.json")
  .option("--output <path>", "lockfile path", "loadout.lock")
  .action(async (options: { manifest: string; output: string }) => {
    const lockfile = await writeLockfile(
      await readManifest(options.manifest),
      options.output,
    );
    console.log(
      `Wrote ${options.output} with ${lockfile.packages.length} resolved package(s).`,
    );
  });

program
  .command("export")
  .description("Export a portable Loadout manifest and optional lockfile")
  .argument("<output>", "new portable JSON file")
  .option("--manifest <path>", "manifest path", "loadout.json")
  .option("--lock <path>", "include this exact lockfile")
  .action(
    async (output: string, options: { manifest: string; lock?: string }) => {
      const bundle = await exportPortableLoadout(
        options.manifest,
        output,
        options.lock,
      );
      console.log(
        `Exported ${bundle.manifest.packages.length} package(s) to ${output}.${bundle.lockfile ? " Exact lockfile included." : ""}`,
      );
    },
  );

program
  .command("import")
  .description("Preview or apply a portable Loadout manifest and lockfile")
  .argument("<source>", "portable JSON file")
  .option("--manifest <path>", "manifest destination", "loadout.json")
  .option("--lock <path>", "lockfile destination", "loadout.lock")
  .option("--yes", "apply the import; otherwise remain read-only")
  .option(
    "--overwrite",
    "replace existing destination files after snapshotting them",
  )
  .action(
    async (
      source: string,
      options: {
        manifest: string;
        lock: string;
        yes?: boolean;
        overwrite?: boolean;
      },
    ) => {
      const preview = await planPortableImport(
        source,
        options.manifest,
        options.lock,
      );
      console.log(JSON.stringify(preview.plan, null, 2));
      if (!options.yes)
        return console.log(
          "Dry run only. Re-run with --yes to import this Loadout.",
        );
      const result = await applyPortableImport(
        source,
        options.manifest,
        options.lock,
        { overwrite: options.overwrite },
      );
      console.log(
        `Imported successfully. Recovery snapshot: ${result.snapshotId}.`,
      );
    },
  );

program
  .command("audit")
  .description(
    "Verify manifest, lockfile, installed state, and managed file hashes for CI",
  )
  .option("--manifest <path>", "manifest path", "loadout.json")
  .option("--lock <path>", "lockfile path", "loadout.lock")
  .option("--json", "emit machine-readable JSON")
  .action(
    async (options: { manifest: string; lock: string; json?: boolean }) => {
      const report = await auditLoadout(options.manifest, options.lock);
      console.log(
        options.json
          ? JSON.stringify(report, null, 2)
          : formatAuditReport(report),
      );
      if (!report.valid) process.exitCode = 1;
    },
  );

program
  .command("create")
  .description("Create a new Loadout package directory")
  .argument("<directory>", "new package directory")
  .requiredOption("--name <name>", "lowercase package name")
  .option("--description <text>", "package description")
  .option("--version <version>", "semantic version", "0.1.0")
  .action(
    async (
      directory: string,
      options: { name: string; description?: string; version: string },
    ) => {
      const descriptor = await createPackage(directory, options);
      console.log(
        `Created ${descriptor.name}@${descriptor.version} in ${directory}.`,
      );
    },
  );

program
  .command("pack")
  .description(
    "Validate a package and print its deterministic inventory digest",
  )
  .argument("[directory]", "package directory", ".")
  .option("--json", "emit machine-readable JSON")
  .action(async (directory: string, options: { json?: boolean }) => {
    const packed = await packPackage(directory);
    console.log(
      options.json
        ? JSON.stringify(packed, null, 2)
        : `${packed.descriptor.name}@${packed.descriptor.version} — ${packed.files.length} file(s) — sha256:${packed.digest}`,
    );
  });

program
  .command("publish")
  .description(
    "Publish an immutable package version to a local or remote Loadout registry",
  )
  .argument("[directory]", "package directory", ".")
  .option("--local", "publish to the local registry")
  .option("--registry-url <url>", "remote registry base URL")
  .option(
    "--credential-keychain <service>",
    "resolve the remote registry token from the OS credential store",
  )
  .option("--credential-account <account>", "OS credential account")
  .option(
    "--approve-risk",
    "explicitly approve publishing scripts, hooks, or binaries",
  )
  .action(
    async (
      directory: string,
      options: {
        local?: boolean;
        registryUrl?: string;
        credentialKeychain?: string;
        credentialAccount?: string;
        approveRisk?: boolean;
      },
    ) => {
      if (
        Number(Boolean(options.local)) +
          Number(Boolean(options.registryUrl)) !==
        1
      )
        throw new Error(
          "Choose exactly one destination: --local or --registry-url",
        );
      if (options.local) {
        if (options.credentialKeychain)
          throw new Error("Local publishing does not require a credential");
        const packed = await publishLocalPackage(directory, {
          approveRisk: options.approveRisk,
        });
        console.log(
          `Published ${packed.descriptor.name}@${packed.descriptor.version} with digest ${packed.digest}.`,
        );
        return;
      }
      const token = await createCredentialResolver()(
        options.credentialKeychain
          ? {
              kind: "os-keychain",
              service: options.credentialKeychain,
              ...(options.credentialAccount
                ? { account: options.credentialAccount }
                : {}),
            }
          : { kind: "environment", name: "LOADOUT_REGISTRY_TOKEN" },
      );
      if (!token)
        throw new Error(
          "Remote publishing credential did not resolve; set LOADOUT_REGISTRY_TOKEN or use --credential-keychain",
        );
      const published = await publishRemotePackage(
        directory,
        options.registryUrl!,
        token,
        { approveRisk: options.approveRisk },
      );
      console.log(
        `Published ${published.name}@${published.version} with digest ${published.digest}.`,
      );
    },
  );

program
  .command("registry-serve")
  .description("Run the Loadout registry protocol server")
  .option("--host <host>", "listen host", "127.0.0.1")
  .option("--port <port>", "listen port", "7331")
  .option(
    "--credential-keychain <service>",
    "resolve the server token from the OS credential store",
  )
  .option("--credential-account <account>", "OS credential account")
  .action(
    async (options: {
      host: string;
      port: string;
      credentialKeychain?: string;
      credentialAccount?: string;
    }) => {
      const token = await createCredentialResolver()(
        options.credentialKeychain
          ? {
              kind: "os-keychain",
              service: options.credentialKeychain,
              ...(options.credentialAccount
                ? { account: options.credentialAccount }
                : {}),
            }
          : { kind: "environment", name: "LOADOUT_REGISTRY_TOKEN" },
      );
      if (!token)
        throw new Error(
          "Set LOADOUT_REGISTRY_TOKEN before starting a registry server",
        );
      const handle = await startRegistryServer({
        host: options.host,
        port: Number(options.port),
        token,
      });
      console.log(
        `Loadout registry listening at http://${handle.host}:${handle.port}.`,
      );
      await new Promise<void>((resolve) => {
        const stop = () => {
          process.off("SIGINT", stop);
          process.off("SIGTERM", stop);
          void handle.close().then(resolve);
        };
        process.on("SIGINT", stop);
        process.on("SIGTERM", stop);
      });
    },
  );

program
  .command("search")
  .description("Search the bundled catalog and local registry")
  .argument("[query]", "search text", "")
  .option("--json", "emit machine-readable JSON")
  .action(async (query: string, options: { json?: boolean }) => {
    const catalog = (await loadEffectiveCatalog())
      .filter(
        (pkg) =>
          !query ||
          `${pkg.id} ${pkg.displayName} ${pkg.description}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      )
      .map((pkg) => ({
        source: "catalog",
        name: pkg.id,
        description: pkg.description,
        repository: pkg.repository,
      }));
    const local = (await searchLocalRegistry(query)).map((pkg) => ({
      source: "registry",
      ...pkg,
    }));
    if (options.json)
      return console.log(JSON.stringify([...catalog, ...local], null, 2));
    for (const item of [...catalog, ...local])
      console.log(
        `${item.name}${"version" in item ? `@${item.version}` : ""} [${item.source}] — ${item.description}`,
      );
    if (!catalog.length && !local.length)
      console.log("No matching packages found.");
  });

program
  .command("add")
  .description("Add a catalog, GitHub, or local package to loadout.json")
  .argument("<id>", "package id")
  .option("--manifest <path>", "manifest path", "loadout.json")
  .option("--catalog <id>", "catalog package id")
  .option("--repository <owner/repo>", "public GitHub repository")
  .option("--git <url>", "generic HTTPS or SSH Git repository")
  .option("--registry <name@version>", "exact local registry package version")
  .option(
    "--remote-registry <url>",
    "fetch --registry name@version from this remote registry",
  )
  .option("--ref <ref>", "Git branch, tag, or ref")
  .option("--path <path>", "GitHub repository subpath or local path")
  .option("--local", "treat --path as a local source")
  .option("--agents <ids>", "comma-separated target agents")
  .option("--depends-on <ids>", "comma-separated package dependencies")
  .action(
    async (
      id: string,
      options: {
        manifest: string;
        catalog?: string;
        repository?: string;
        git?: string;
        registry?: string;
        remoteRegistry?: string;
        ref?: string;
        path?: string;
        local?: boolean;
        agents?: string;
        dependsOn?: string;
      },
    ) => {
      const selected =
        Number(Boolean(options.catalog)) +
        Number(Boolean(options.repository)) +
        Number(Boolean(options.git)) +
        Number(Boolean(options.registry)) +
        Number(Boolean(options.local));
      if (selected !== 1)
        throw new Error(
          "Choose exactly one source: --catalog, --repository, --git, --registry, or --local with --path",
        );
      if (options.local && !options.path)
        throw new Error("--local requires --path <directory>");
      const registry = options.registry?.match(/^([a-z0-9][a-z0-9._-]*)@(.+)$/);
      if (options.registry && !registry)
        throw new Error("--registry expects name@version");
      if (options.remoteRegistry && !registry)
        throw new Error("--remote-registry requires --registry name@version");
      const source = options.catalog
        ? { type: "catalog" as const, id: options.catalog }
        : options.repository
          ? {
              type: "github" as const,
              repository: options.repository,
              ...(options.ref ? { ref: options.ref } : {}),
              ...(options.path ? { path: options.path } : {}),
            }
          : options.git
            ? {
                type: "git" as const,
                url: options.git,
                ...(options.ref ? { ref: options.ref } : {}),
                ...(options.path ? { path: options.path } : {}),
              }
            : registry && options.remoteRegistry
              ? {
                  type: "remote-registry" as const,
                  registry: options.remoteRegistry,
                  name: registry[1],
                  version: registry[2],
                }
              : registry
                ? {
                    type: "registry" as const,
                    name: registry[1],
                    version: registry[2],
                  }
                : { type: "local" as const, path: options.path! };
      const manifest = await addManifestPackage(options.manifest, {
        id,
        source,
        ...(options.agents
          ? { agents: parseAgentSelection(options.agents)! }
          : {}),
        ...(options.dependsOn
          ? { dependsOn: options.dependsOn.split(",") }
          : {}),
      });
      console.log(
        `Added ${id} to ${options.manifest}. ${manifest.packages.length} package(s) configured.`,
      );
    },
  );

program
  .command("unadd")
  .description(
    "Remove a desired package from loadout.json without touching installed files",
  )
  .argument("<id>", "package id")
  .option("--manifest <path>", "manifest path", "loadout.json")
  .action(async (id: string, options: { manifest: string }) => {
    const manifest = await removeManifestPackage(options.manifest, id);
    console.log(
      `Removed ${id} from ${options.manifest}. ${manifest.packages.length} package(s) configured.`,
    );
  });

program
  .command("list")
  .alias("ls")
  .description("List packages managed by Loadout")
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    const state = await readInstallState();
    if (options.json)
      return console.log(JSON.stringify(state.installs, null, 2));
    if (!state.installs.length)
      return console.log("No Loadout-managed packages are installed.");
    for (const item of state.installs)
      console.log(
        `${item.packageId} — ${item.targetAgents.join(", ")} — ${item.resolvedCommit?.slice(0, 12) ?? "local"} — ${item.files.length} file(s)`,
      );
  });

program
  .command("library")
  .description(
    "Show separate cache, review, installation, and per-agent activation state",
  )
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    const report = await buildLibraryStateReport();
    console.log(
      options.json
        ? JSON.stringify(report, null, 2)
        : formatLibraryStateReport(report),
    );
  });

program
  .command("report")
  .description(
    "Print a privacy-safe shareable summary without paths, code, prompts, or secrets",
  )
  .option("--json", "emit the machine-readable artifact")
  .action(async (options: { json?: boolean }) => {
    const report = await buildPrivacySafeReport();
    console.log(
      options.json
        ? JSON.stringify(report, null, 2)
        : formatPrivacySafeReport(report),
    );
  });

program
  .command("outcomes")
  .description(
    "Show privacy-safe local outcome signals; never uploads project or prompt data",
  )
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    const store = await readLocalOutcomes();
    console.log(
      options.json
        ? JSON.stringify(store, null, 2)
        : [
            `Local outcomes: ${store.events.length}`,
            ...store.events.map(
              (event) =>
                `${event.recordedAt} — ${event.selector} — ${event.agent}/${event.taskFamily} — ${event.result}`,
            ),
            "Privacy: local only; no project names, paths, prompts, code, filenames, or secrets.",
          ].join("\n"),
    );
  });

program
  .command("outcome")
  .description("Record an explicit local, agent/task-scoped skill outcome")
  .argument("<selector>", "exact package/skill selector")
  .requiredOption("--agent <id>", "agent id")
  .requiredOption(
    "--task <family>",
    "general, frontend, testing, javascript, python, backend, security, or documentation",
  )
  .requiredOption(
    "--result <value>",
    "accept, reject, success, failure, activation, disable, or rollback",
  )
  .action(
    async (
      selector: string,
      options: { agent: string; task: string; result: string },
    ) => {
      const knownAgents = new Set(
        (await detectAgents()).map((agent) => agent.id),
      );
      if (!knownAgents.has(options.agent as AgentId))
        throw new Error(`Unknown agent id: ${options.agent}`);
      const event = await recordLocalOutcome({
        selector,
        agent: options.agent as AgentId,
        taskFamily: options.task as OutcomeTaskFamily,
        result: options.result as OutcomeResult,
      });
      console.log(
        `Recorded local outcome ${event.id}. No project, prompt, or source data was stored.`,
      );
    },
  );

program
  .command("share")
  .description("Write the privacy-safe Loadout report to a JSON artifact")
  .argument("<output>", "new or replacement report path")
  .action(async (output: string) => {
    const report = await buildPrivacySafeReport();
    await writePrivacySafeReport(output, report);
    console.log(
      `Wrote privacy-safe Loadout report to ${output}. Review it before sharing.`,
    );
  });

for (const workflow of ["activate", "optimize"] as const) {
  program
    .command(workflow)
    .description(
      workflow === "activate"
        ? "Select and activate reviewed library skills for a project"
        : "Scan a project and propose the best reviewed active-set additions",
    )
    .option("--project <path>", "project directory to scan", ".")
    .option("--agents <ids>", "comma-separated agent ids")
    .option("--limit <count>", "maximum active skills per agent", "40")
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
  .command("health")
  .description("Quickly check agents, installed packages, and local file drift")
  .option("--json", "emit machine-readable JSON")
  .option("--updates", "also perform live network update checks")
  .action(async (options: { json?: boolean; updates?: boolean }) => {
    const report = await buildHealthReport({ checkUpdates: options.updates });
    console.log(
      options.json
        ? JSON.stringify(report, null, 2)
        : formatHealthReport(report),
    );
  });

program
  .command("alerts")
  .description(
    "Explain evidence-backed archive, staleness, reviewed-commit, and permission alerts",
  )
  .option("--updates", "perform live update safety checks")
  .option("--all", "include ignored alerts")
  .option("--evidence <path>", "verified signed head-to-head evidence path")
  .option("--public-key <path>", "trusted public key for --evidence")
  .option("--json", "emit machine-readable JSON")
  .action(
    async (options: {
      updates?: boolean;
      all?: boolean;
      evidence?: string;
      publicKey?: string;
      json?: boolean;
    }) => {
      if (Boolean(options.evidence) !== Boolean(options.publicKey))
        throw new Error(
          "--evidence and --public-key must be provided together",
        );
      const replacementEvidence = options.evidence
        ? replacementEvidenceFromSignedSnapshot(
            JSON.parse(await readFile(resolve(options.evidence), "utf8")),
            await readFile(resolve(options.publicKey!), "utf8"),
          )
        : undefined;
      const alerts = await buildFreshnessAlerts({
        checkUpdates: options.updates,
        replacementEvidence,
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

program
  .command("remove")
  .description("Safely remove only files managed for one package")
  .argument("<package>", "managed package id")
  .option("--yes", "apply removal; otherwise show a plan")
  .option("--force", "also remove managed files changed outside Loadout")
  .action(
    async (packageId: string, options: { yes?: boolean; force?: boolean }) => {
      const plan = await planRemove(packageId);
      console.log(JSON.stringify(plan, null, 2));
      if (!options.yes)
        return console.log(
          "Dry run only. Re-run with --yes to remove these files.",
        );
      const snapshot = await applyRemove(plan, { force: options.force });
      console.log(`Removed ${packageId}. Snapshot: ${snapshot}`);
    },
  );

program
  .command("recommend")
  .description("Recommend catalog packages from local project signals")
  .option("--project <path>", "project directory", process.cwd())
  .option(
    "--agent <id>",
    "personalize with local-only outcomes recorded for one supported agent",
  )
  .option("--json", "emit machine-readable JSON")
  .action(
    async (options: { project: string; agent?: string; json?: boolean }) => {
      const signals = await scanProject(options.project);
      let recommendations = recommendPackages(
        signals,
        await loadEffectiveCatalog(),
      );
      if (options.agent) {
        const agents = parseAgentSelection(options.agent)!;
        if (agents.length !== 1)
          throw new Error("--agent accepts exactly one id");
        recommendations = personalizeRecommendations(
          recommendations,
          signals,
          await readLocalOutcomes(),
          agents[0],
        );
      }
      console.log(
        options.json
          ? JSON.stringify(
              {
                signals,
                recommendations,
                personalization: options.agent
                  ? {
                      agent: options.agent,
                      privacy: "local-only-no-project-or-content",
                    }
                  : undefined,
              },
              null,
              2,
            )
          : formatRecommendations(signals, recommendations),
      );
    },
  );

program
  .command("profiles")
  .description("List tested Loadout profiles or inspect one profile")
  .argument("[name]", "profile name")
  .option("--json", "emit machine-readable JSON")
  .option(
    "--apply-to <path>",
    "add the selected profile packages to a manifest",
  )
  .action(
    async (
      name: string | undefined,
      options: { json?: boolean; applyTo?: string },
    ) => {
      if (!name)
        return console.log(
          options.json
            ? JSON.stringify(TESTED_PROFILES, null, 2)
            : Object.entries(TESTED_PROFILES)
                .map(([id, profile]) => `${id} — ${profile.description}`)
                .join("\n"),
        );
      const packages = profileManifestPackages(
        name,
        await loadEffectiveCatalog(),
      );
      if (options.applyTo) {
        const manifest = await applyProfileToManifest(
          options.applyTo,
          name,
          packages,
        );
        console.log(
          `Applied profile ${name} to ${options.applyTo}. ${manifest.packages.length} package(s) configured.`,
        );
        return;
      }
      console.log(
        options.json
          ? JSON.stringify(
              { name, ...TESTED_PROFILES[name], packages },
              null,
              2,
            )
          : `${name}: ${TESTED_PROFILES[name].description}\n${packages.map((pkg) => `  ${pkg.id} — ${pkg.repository}`).join("\n")}`,
      );
    },
  );

program
  .command("improve")
  .description(
    "Propose the next evidence-backed improvement without changing anything",
  )
  .option("--json", "emit machine-readable JSON")
  .option("--write", "persist the cycle record and reusable prompt locally")
  .option(
    "--output <directory>",
    "output directory; defaults to private Loadout state",
  )
  .action(
    async (options: { json?: boolean; write?: boolean; output?: string }) => {
      const cycle = await buildImprovementCycle();
      console.log(
        options.json
          ? JSON.stringify(cycle, null, 2)
          : formatImprovementCycle(cycle),
      );
      if (options.write) {
        const paths = await writeImprovementCycle(cycle, options.output);
        console.log(
          `Cycle record: ${paths.json}\nLoop prompt: ${paths.prompt}`,
        );
      }
    },
  );

program
  .command("improve-feedback")
  .description(
    "Record a human-reviewed outcome for a persisted improvement cycle",
  )
  .requiredOption("--id <id>", "cycle id")
  .requiredOption("--outcome <outcome>", "success, failure, or partial")
  .option("--note <text>", "short non-secret lesson")
  .option("--directory <path>", "improvement history directory")
  .action(
    async (options: {
      id: string;
      outcome: string;
      note?: string;
      directory?: string;
    }) => {
      if (
        !(["success", "failure", "partial"] as string[]).includes(
          options.outcome,
        )
      )
        throw new Error("--outcome must be success, failure, or partial");
      await recordImprovementOutcome(
        options.id,
        options.outcome as "success" | "failure" | "partial",
        options.note,
        options.directory,
      );
      console.log(`Recorded ${options.outcome} outcome for ${options.id}.`);
    },
  );

program
  .command("sync")
  .description("Reproduce a loadout.json manifest as one safe transaction")
  .option("--manifest <path>", "manifest path", "loadout.json")
  .option("--lock <path>", "lockfile output", "loadout.lock")
  .option("--yes", "apply the plan; otherwise remain read-only")
  .option(
    "--approve-risk",
    "explicitly approve plans containing scripts, hooks, or binaries",
  )
  .action(
    async (options: {
      manifest: string;
      lock: string;
      yes?: boolean;
      approveRisk?: boolean;
    }) => {
      const plan = await buildSyncPlan(options.manifest);
      console.log(
        JSON.stringify(
          {
            manifest: plan.manifest,
            packages: plan.packages.map((entry) => ({
              ...entry.plan,
              safety: entry.safety,
            })),
            mcpChanges: plan.mcpPlans.map((entry) => ({
              packageId: entry.packageId,
              path: entry.plan.path,
              changes: entry.plan.changes,
              warnings: entry.plan.warnings,
            })),
            skipped: plan.skipped,
            policyViolations: plan.policyViolations,
          },
          null,
          2,
        ),
      );
      if (!options.yes)
        return console.log(
          "Dry run only. Re-run with --yes to synchronize this Loadout.",
        );
      const result = await applySyncPlan(plan, options.lock, {
        approveRisk: options.approveRisk,
      });
      console.log(
        `Synchronized successfully.${result.snapshotId ? ` Snapshot: ${result.snapshotId}.` : ""} Lockfile: ${result.lockfile}`,
      );
    },
  );

program
  .command("scan")
  .description(
    "Inventory existing agent skills, ownership, fingerprints, and duplicates without changing anything",
  )
  .option(
    "--agents <ids>",
    "comma-separated agent ids; defaults to detected agents",
  )
  .option(
    "--refresh-provenance",
    "fetch exact reviewed commits and rebuild the local catalog skill index",
  )
  .option("--json", "emit the complete machine-readable inventory")
  .action(
    async (options: {
      agents?: string;
      refreshProvenance?: boolean;
      json?: boolean;
    }) => {
      const detected = await detectAgents();
      const requested = parseAgentSelection(options.agents);
      const selected = requested?.length
        ? detected.filter((agent) => requested.includes(agent.id))
        : detected.filter((agent) => agent.installed);
      if (!selected.length)
        throw new Error("No detected agent profile is available to scan");
      const report = await scanInstalledSkills(selected);
      const catalog = await loadEffectiveCatalog();
      const resolved = await resolveCatalogSkillIndex({
        refresh: options.refreshProvenance,
        offline: !options.refreshProvenance,
        build: {
          catalog,
          onProgress: options.refreshProvenance
            ? printProvenanceProgress
            : undefined,
        },
      });
      const enriched = enrichInventoryWithProvenance(
        report,
        resolved.index,
        resolved.source,
      );
      console.log(
        options.json
          ? JSON.stringify(enriched, null, 2)
          : `${formatInstalledSkillInventory(enriched)}\n${formatProvenanceSummary(enriched)}`,
      );
    },
  );

program
  .command("adopt")
  .description(
    "Take ownership of one explicitly selected installed skill without changing its bytes",
  )
  .argument("<skill>", "installed skill name, directory name, or exact path")
  .requiredOption("--agent <id>", "agent that owns the installed skill")
  .option("--refresh-provenance", "rebuild the reviewed catalog skill index")
  .option("--yes", "record ownership; otherwise show a dry-run plan")
  .option("--json", "emit machine-readable JSON")
  .action(
    async (
      skill: string,
      options: {
        agent: string;
        refreshProvenance?: boolean;
        yes?: boolean;
        json?: boolean;
      },
    ) => {
      const detected = await detectAgents();
      const agent = detected.find(
        (item) => item.id === options.agent && item.installed,
      );
      if (!agent)
        throw new Error(
          `Agent '${options.agent}' is unknown or is not installed`,
        );
      const resolved = await resolveCatalogSkillIndex({
        refresh: options.refreshProvenance,
        offline: !options.refreshProvenance,
        build: {
          catalog: await loadEffectiveCatalog(),
          onProgress: options.refreshProvenance
            ? printProvenanceProgress
            : undefined,
        },
      });
      const plan = await planSkillAdoption(skill, agent, resolved.index);
      if (!options.yes) {
        console.log(
          options.json
            ? JSON.stringify(plan, null, 2)
            : `${formatAdoptionPlan(plan)}\nDry run only. Re-run with --yes to adopt this one skill.`,
        );
        return;
      }
      const snapshotId = await applySkillAdoption(plan);
      console.log(
        options.json
          ? JSON.stringify({ plan, snapshotId }, null, 2)
          : `${formatAdoptionPlan(plan)}\nAdopted without changing skill bytes. Snapshot: ${snapshotId}`,
      );
    },
  );

program
  .command("compare")
  .description(
    "Compare an installed or reviewed skill with evidence-related catalog alternatives without changing anything",
  )
  .argument(
    "<skill>",
    "installed skill name, directory name, or catalog package id",
  )
  .option("--agent <id>", "select one installed agent when names are ambiguous")
  .option("--refresh", "rebuild the reviewed catalog skill index")
  .option("--offline", "never fetch; use the existing local index only")
  .option("--limit <count>", "maximum alternatives to show", "10")
  .option("--json", "emit the complete machine-readable comparison")
  .action(
    async (
      skill: string,
      options: {
        agent?: string;
        refresh?: boolean;
        offline?: boolean;
        limit: string;
        json?: boolean;
      },
    ) => {
      if (options.refresh && options.offline)
        throw new Error("--refresh and --offline cannot be used together");
      const limit = Number(options.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50)
        throw new Error("--limit must be an integer from 1 to 50");
      const detected = await detectAgents();
      const agent = options.agent as AgentId | undefined;
      if (agent && !detected.some((item) => item.id === agent))
        throw new Error(`Unknown agent id: ${options.agent}`);
      const selected = detected.filter((item) => item.installed);
      if (!selected.length)
        throw new Error("No detected agent profile is available to compare");
      const catalog = await loadEffectiveCatalog();
      const resolved = await resolveCatalogSkillIndex({
        refresh: options.refresh,
        offline: options.offline,
        build: {
          catalog,
          onProgress: options.offline ? undefined : printProvenanceProgress,
        },
      });
      if (!resolved.index)
        throw new Error(
          "No local catalog skill index exists. Re-run without --offline or use --refresh.",
        );
      const inventory = enrichInventoryWithProvenance(
        await scanInstalledSkills(selected),
        resolved.index,
        resolved.source,
      );
      const comparison = compareSkill(
        skill,
        inventory,
        resolved.index.records,
        catalog,
        {
          ...(agent ? { agent } : {}),
          limit,
          indexGeneratedAt: resolved.index.generatedAt,
          failures: resolved.index.failures,
        },
      );
      console.log(
        options.json
          ? JSON.stringify(comparison, null, 2)
          : formatSkillComparison(comparison),
      );
    },
  );

program
  .command("status")
  .description(
    "Show detected coding agents and their managed component inventory",
  )
  .option("--json", "emit machine-readable inventory")
  .action(async (options: { json?: boolean }) => {
    const agents = await detectAgents();
    const inventory = await inspectAgents(agents);
    if (options.json) return console.log(JSON.stringify(inventory, null, 2));
    for (const item of inventory) console.log(formatAgentInventory(item));
  });

program
  .command("demo")
  .alias("test-drive")
  .description(
    "Test-drive a reviewed install + rollback in a disposable profile; never touches local agent config",
  )
  .option(
    "--repository <owner/repo>",
    "public GitHub skill repository",
    "obra/superpowers",
  )
  .option("--package <id>", "package identifier", "obra-superpowers")
  .option("--agents <ids>", "comma-separated virtual demo targets", "codex")
  .option("--keep", "retain the isolated profile after install for inspection")
  .option("--json", "emit the demo result as JSON")
  .action(
    async (options: {
      repository: string;
      package: string;
      agents: string;
      keep?: boolean;
      json?: boolean;
    }) => {
      const result = await runIsolatedDemo({
        repository: options.repository,
        packageId: options.package,
        agents: parseAgentSelection(options.agents)!,
        keep: options.keep,
      });
      console.log(
        options.json
          ? JSON.stringify(result, null, 2)
          : formatDemoResult(result),
      );
    },
  );

program
  .command("capabilities")
  .description(
    "Show honest native, adapted, and unsupported adapter capabilities",
  )
  .option("--json", "emit machine-readable JSON")
  .option(
    "--inspect",
    "also inspect managed component directories on this machine",
  )
  .option(
    "--gaps",
    "show the evidence-gated backlog for unsupported adapter combinations",
  )
  .action(
    async (options: { json?: boolean; inspect?: boolean; gaps?: boolean }) => {
      if (options.gaps) {
        if (options.inspect)
          throw new Error("Choose either --inspect or --gaps");
        const gaps = buildAdapterCapabilityGaps();
        return console.log(
          options.json
            ? JSON.stringify(gaps, null, 2)
            : formatAdapterCapabilityGaps(),
        );
      }
      if (!options.inspect)
        return console.log(
          options.json
            ? JSON.stringify(ADAPTER_CAPABILITIES, null, 2)
            : formatCapabilityMatrix(),
        );
      const inventory = await inspectAgents(await detectAgents());
      if (options.json)
        return console.log(
          JSON.stringify(
            { capabilities: ADAPTER_CAPABILITIES, inventory },
            null,
            2,
          ),
        );
      console.log(
        `${formatCapabilityMatrix()}\n\nLocal managed-component inventory:`,
      );
      for (const item of inventory) console.log(formatAgentInventory(item));
    },
  );

program
  .command("doctor")
  .description(
    "Check agents, skill directories, permissions, and Loadout setup",
  )
  .option("--json", "print a machine-readable report")
  .action(async (options: { json?: boolean }) => {
    const report = await runDoctor();
    console.log(
      options.json
        ? JSON.stringify(report, null, 2)
        : formatDoctorReport(report),
    );
  });

program
  .command("catalog")
  .description("List the real package catalog")
  .option("--refresh", "fetch current GitHub stars and repository metadata")
  .option(
    "--explain <id>",
    "print the evidence and guardrails behind one package's ranking",
  )
  .option("--history <id>", "show locally recorded stars and release history")
  .option(
    "--coverage",
    "show capability, evidence, license, and overlap metrics",
  )
  .option("--json", "emit machine-readable output")
  .action(
    async (options: {
      refresh?: boolean;
      explain?: string;
      history?: string;
      coverage?: boolean;
      json?: boolean;
    }) => {
      if (
        [options.explain, options.history, options.coverage].filter(Boolean)
          .length > 1
      )
        throw new Error("Choose one of --explain, --history, or --coverage");
      const base = await loadCatalog();
      const result = options.refresh
        ? await refreshCatalog(base, { forceRefresh: true })
        : {
            catalog: await loadEffectiveCatalog(),
            failures: [],
            observationFailures: [],
          };
      if (options.history) {
        const pkg = result.catalog.find((item) => item.id === options.history);
        if (!pkg)
          throw new Error(`Unknown catalog package '${options.history}'`);
        console.log(
          formatStarHistory(await readCatalogObservations(pkg.repository)),
        );
        return;
      }
      if (options.explain) {
        const pkg = result.catalog.find((item) => item.id === options.explain);
        if (!pkg)
          throw new Error(`Unknown catalog package '${options.explain}'`);
        console.log(
          JSON.stringify(
            {
              package: {
                id: pkg.id,
                displayName: pkg.displayName,
                category: pkg.category,
                tier: pkg.tier,
                trustStage: catalogTrustStage(pkg),
              },
              ranking: explainCatalogScore(pkg),
            },
            null,
            2,
          ),
        );
        return;
      }
      if (options.coverage) {
        const coverage = buildCatalogCoverage(result.catalog);
        console.log(
          options.json
            ? JSON.stringify(coverage, null, 2)
            : formatCatalogCoverage(coverage),
        );
        return;
      }
      for (const pkg of rankCatalog(result.catalog)) {
        const topics = pkg.topics?.length ? ` — ${pkg.topics.join(", ")}` : "";
        const updated = pkg.lastUpdatedAt
          ? ` — updated ${pkg.lastUpdatedAt.slice(0, 10)}`
          : "";
        console.log(
          `${pkg.displayName} [${pkg.tier}; ${catalogTrustStage(pkg)}] ★${pkg.stars ?? "?"} — ${pkg.repository}${topics}${updated}`,
        );
      }
      for (const failure of result.failures)
        console.error(
          `Warning: could not refresh ${failure.repository}: ${failure.error}`,
        );
      for (const failure of result.observationFailures)
        console.error(
          `Warning: could not record release observation for ${failure.repository}: ${failure.error}`,
        );
    },
  );

const candidate = program
  .command("candidate")
  .description(
    "Triage and statically inspect daily discovery candidates; never auto-promotes",
  );

candidate
  .command("list")
  .allowExcessArguments(false)
  .description(
    "Rank discovery leads for human triage, not as universal quality",
  )
  .option("--limit <count>", "maximum candidates", "20")
  .option("--query <words>", "require all search words")
  .option("--include-reviewed", "include repositories already in the catalog")
  .option("--feed <path>", "alternate discovered.json evidence feed")
  .option("--json", "emit machine-readable JSON")
  .action(
    async (options: {
      limit: string;
      query?: string;
      includeReviewed?: boolean;
      feed?: string;
      json?: boolean;
    }) => {
      const limit = Number(options.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500)
        throw new Error("--limit must be an integer from 1 to 500");
      const result = await listDiscoveryCandidates({
        limit,
        query: options.query,
        includeReviewed: options.includeReviewed,
        path: options.feed,
      });
      console.log(
        options.json
          ? JSON.stringify(result, null, 2)
          : formatCandidateSummaries(result),
      );
    },
  );

candidate
  .command("inspect")
  .allowExcessArguments(false)
  .description(
    "Clone one lead at an immutable commit and build a static evidence dossier",
  )
  .argument("<repository>", "owner/repository present in the discovery feed")
  .option("--feed <path>", "alternate discovered.json evidence feed")
  .option("--write", "persist the dossier in private Loadout state")
  .option("--output <path>", "persist at an explicit path (implies --write)")
  .option("--json", "emit the complete dossier as JSON")
  .action(
    async (
      repository: string,
      options: {
        feed?: string;
        write?: boolean;
        output?: string;
        json?: boolean;
      },
    ) => {
      const dossier = await buildCandidateDossier(repository, {
        discoveryPath: options.feed,
      });
      const path =
        options.write || options.output
          ? await writeCandidateDossier(dossier, options.output)
          : undefined;
      if (options.json)
        return console.log(
          JSON.stringify(
            {
              dossier,
              persisted: Boolean(path),
              ...(path ? { path } : {}),
            },
            null,
            2,
          ),
        );
      console.log(formatCandidateDossier(dossier));
      if (path) console.log(`Dossier: ${path}`);
      else {
        console.log(
          "Preview only. Re-run with --write to persist this dossier.",
        );
      }
    },
  );

candidate
  .command("propose")
  .allowExcessArguments(false)
  .description(
    "Convert a reviewed dossier into a catalog-record proposal; never edits the catalog",
  )
  .argument("<dossier>", "persisted candidate dossier JSON")
  .requiredOption("--id <id>", "lowercase kebab-case catalog id")
  .requiredOption("--category <category>", "reviewed catalog category")
  .requiredOption(
    "--platforms <ids>",
    "explicitly reviewed comma-separated platforms: windows,macos,linux",
  )
  .option("--display-name <name>", "reviewed display name")
  .option("--description <text>", "reviewed description")
  .option("--license <spdx>", "human-reviewed license override")
  .option(
    "--tier <tier>",
    "official, stable, trending, or community",
    "community",
  )
  .option("--approve", "confirm human review and write the proposal")
  .option(
    "--output <path>",
    "proposal JSON output path; required with --approve",
  )
  .option("--json", "emit machine-readable JSON")
  .action(
    async (
      dossierPath: string,
      options: {
        id: string;
        category: string;
        platforms: string;
        displayName?: string;
        description?: string;
        license?: string;
        tier: string;
        approve?: boolean;
        output?: string;
        json?: boolean;
      },
    ) => {
      const platforms = options.platforms
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const knownPlatforms = new Set(["windows", "macos", "linux"]);
      if (platforms.some((item) => !knownPlatforms.has(item)))
        throw new Error("--platforms supports only windows, macos, and linux");
      const knownTiers = new Set([
        "official",
        "stable",
        "trending",
        "community",
      ]);
      if (!knownTiers.has(options.tier)) throw new Error("--tier is invalid");
      if (options.approve && !options.output)
        throw new Error(
          "--approve requires --output so catalog mutation stays separate",
        );
      const proposal = buildCatalogProposal(
        await verifyCandidateDossierSource(
          await readCandidateDossier(dossierPath),
        ),
        {
          id: options.id,
          category: options.category,
          operatingSystems: platforms as OperatingSystem[],
          tier: options.tier as PackageTier,
          displayName: options.displayName,
          description: options.description,
          license: options.license,
        },
        await loadEffectiveCatalog(),
      );
      const output = options.approve ? resolve(options.output!) : undefined;
      if (output)
        await writeFileAtomically(
          output,
          `${JSON.stringify(proposal, null, 2)}\n`,
        );
      if (options.json)
        return console.log(
          JSON.stringify(
            {
              proposal,
              approved: Boolean(output),
              catalogMutated: false,
              ...(output ? { output } : {}),
            },
            null,
            2,
          ),
        );
      console.log(JSON.stringify(proposal, null, 2));
      if (!output)
        console.log(
          "Proposal preview only. Human review is still required; use --approve --output <path> to persist it.",
        );
      else console.log(`Approved proposal written to ${output}.`);
    },
  );

program
  .command("catalog-update")
  .allowExcessArguments(false)
  .description(
    "Verify, diff, and explicitly apply a signed catalog release from a file or HTTPS",
  )
  .requiredOption("--source <path-or-url>", "signed catalog envelope")
  .requiredOption("--public-key <path>", "trusted Ed25519 public key")
  .option("--yes", "atomically apply after signature and evidence validation")
  .option(
    "--allow-removals",
    "explicitly allow reviewed packages to be removed by this release",
  )
  .option("--json", "emit machine-readable preview")
  .action(
    async (options: {
      source: string;
      publicKey: string;
      yes?: boolean;
      allowRemovals?: boolean;
      json?: boolean;
    }) => {
      const preview = await previewCatalogRelease({
        source: options.source,
        publicKeyPath: options.publicKey,
        currentCatalog: await loadEffectiveCatalog(),
      });
      const result = options.yes
        ? await applyCatalogRelease(preview, {
            allowRemovals: options.allowRemovals,
          })
        : undefined;
      if (options.json)
        return console.log(
          JSON.stringify(
            {
              source: preview.source,
              createdAt: preview.createdAt,
              fingerprint: preview.fingerprint,
              packageCount: preview.packageCount,
              diff: result?.diff ?? preview.diff,
              replay: preview.replay,
              applied: Boolean(result),
              ...(result
                ? { path: result.path, snapshotId: result.snapshotId }
                : {}),
            },
            null,
            2,
          ),
        );
      console.log(formatCatalogReleasePreview(preview));
      if (!result)
        console.log("Preview only. Re-run with --yes to trust this release.");
      else
        console.log(
          `Applied signed catalog atomically. Snapshot: ${result.snapshotId}\nState: ${result.path}`,
        );
    },
  );

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
    "--credential-keychain <service>",
    "resolve the private GitHub token from the OS credential store",
  )
  .option("--credential-account <account>", "OS credential account")
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
      credentialKeychain?: string;
      credentialAccount?: string;
      queue?: boolean;
      json?: boolean;
    }) => {
      const limit = Number(options.limit);
      if (!Number.isInteger(limit) || limit < 1)
        throw new Error("--limit must be a positive integer");
      if (options.credentialKeychain && !options.private)
        throw new Error("--credential-keychain requires --private");
      if (options.private) {
        const token = options.credentialKeychain
          ? await createCredentialResolver()({
              kind: "os-keychain",
              service: options.credentialKeychain,
              ...(options.credentialAccount
                ? { account: options.credentialAccount }
                : {}),
            })
          : undefined;
        if (options.credentialKeychain && !token)
          throw new Error("Private GitHub keychain credential did not resolve");
        const repositories = await discoverPrivateRepositories({ token });
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
            ...(options.query
              ? { query: options.query }
              : { queries: defaultGitHubDiscoveryQueries() }),
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
          ...(hackerNews.status === "fulfilled"
            ? hackerNews.value.candidates
            : []),
        ];
        if (!leads.length) {
          const failures = [github, hackerNews]
            .filter(
              (result): result is PromiseRejectedResult =>
                result.status === "rejected",
            )
            .map((result) =>
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
            );
          throw new Error(
            `All discovery sources failed: ${failures.join("; ")}`,
          );
        }
        const sourceWarnings = [github, hackerNews]
          .filter(
            (result): result is PromiseRejectedResult =>
              result.status === "rejected",
          )
          .map((result) =>
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
          );
        const queue = options.queue
          ? await mergeReviewQueue(leads, await loadEffectiveCatalog())
          : undefined;
        const output = { leads, queue, sourceWarnings };
        if (options.json) return console.log(JSON.stringify(output, null, 2));
        if (queue) console.log(formatReviewQueue(queue));
        else
          console.log(
            `Multi-source discovery: ${leads.length} public lead(s).`,
          );
        for (const warning of sourceWarnings)
          console.error(`Warning: ${warning}`);
        return;
      }
      if (options.source === "github") {
        const repositories = await discoverGitHubRepositories({
          ...(options.query
            ? { query: options.query }
            : { queries: defaultGitHubDiscoveryQueries() }),
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

const credentials = program
  .command("credentials")
  .description(
    "Store, inspect, or remove secrets in the native OS credential store",
  );

credentials
  .command("status")
  .description("Check whether the native OS credential backend is available")
  .option("--json", "emit machine-readable status")
  .action(async (options: { json?: boolean }) => {
    const status = await createOsCredentialStore().status();
    console.log(
      options.json
        ? JSON.stringify(status, null, 2)
        : `${status.backend}: ${status.available ? "available" : "unavailable"}`,
    );
    if (!status.available) process.exitCode = 1;
  });

credentials
  .command("set")
  .description(
    "Store a credential read from stdin; its value is never placed in arguments or output",
  )
  .argument("<service>", "credential service identifier")
  .option("--account <account>", "credential account")
  .requiredOption("--stdin", "require secret input from stdin")
  .action(async (service: string, options: { account?: string }) => {
    await createOsCredentialStore().set(
      {
        kind: "os-keychain",
        service,
        ...(options.account ? { account: options.account } : {}),
      },
      await readCredentialFromStdin(),
    );
    console.log(`Stored '${service}' in the native OS credential store.`);
  });

credentials
  .command("check")
  .description("Check whether one credential resolves without printing it")
  .argument("<service>", "credential service identifier")
  .option("--account <account>", "credential account")
  .option("--json", "emit machine-readable status")
  .action(
    async (service: string, options: { account?: string; json?: boolean }) => {
      const found = Boolean(
        await createOsCredentialStore().get({
          kind: "os-keychain",
          service,
          ...(options.account ? { account: options.account } : {}),
        }),
      );
      console.log(
        options.json
          ? JSON.stringify({ service, found })
          : `${service}: ${found ? "stored" : "not found"}`,
      );
      if (!found) process.exitCode = 1;
    },
  );

credentials
  .command("delete")
  .description("Remove one credential from the native OS store")
  .argument("<service>", "credential service identifier")
  .option("--account <account>", "credential account")
  .action(async (service: string, options: { account?: string }) => {
    const deleted = await createOsCredentialStore().delete({
      kind: "os-keychain",
      service,
      ...(options.account ? { account: options.account } : {}),
    });
    console.log(`${service}: ${deleted ? "deleted" : "not found"}`);
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
    "environment variable reference (default: OPENROUTER_API_KEY)",
  )
  .option(
    "--credential-keychain <service>",
    "native OS credential service reference",
  )
  .option("--credential-account <account>", "native credential account")
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
      credentialEnv?: string;
      credentialKeychain?: string;
      credentialAccount?: string;
      agents?: string;
      config?: string;
      yes?: boolean;
      json?: boolean;
    }) => {
      if (options.credentialEnv && options.credentialKeychain)
        throw new Error(
          "Choose either --credential-env or --credential-keychain",
        );
      if (options.credentialAccount && !options.credentialKeychain)
        throw new Error("--credential-account requires --credential-keychain");
      const credential = options.credentialKeychain
        ? {
            kind: "os-keychain" as const,
            service: options.credentialKeychain,
            ...(options.credentialAccount
              ? { account: options.credentialAccount }
              : {}),
          }
        : {
            kind: "environment" as const,
            name: options.credentialEnv ?? "OPENROUTER_API_KEY",
          };
      const plan = await planProviderModelSelection(
        {
          id: options.id,
          provider: options.provider,
          model: options.model,
          endpoint: options.endpoint,
          credential,
          ...(options.agents
            ? { targetAgents: parseAgentSelection(options.agents)! }
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
    "Make one explicit minimal provider request using the referenced credential",
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
        resolveCredential: createCredentialResolver(),
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
  .command("completion")
  .description(
    "Print a shell-completion script; redirect it to your shell profile",
  )
  .argument("<shell>", "bash, zsh, fish, or powershell")
  .action((shell: string) => {
    process.stdout.write(renderShellCompletion(parseCompletionShell(shell)));
  });

program
  .command("mcp-recipe")
  .description(
    "Preview/configure a reviewed MCP recipe, or explicitly verify its real connection",
  )
  .argument("[id]", "recipe id; omit to list reviewed recipes")
  .option("--config <path>", "target JSON MCP config path")
  .option("--yes", "write the reviewed server entry after preview")
  .option("--verify", "verify the configured entry without starting a server")
  .option(
    "--connect",
    "launch the exact pinned artifact and perform an MCP initialize handshake",
  )
  .option(
    "--credential <mapping>",
    "credential mapping NAME=env:VARIABLE or NAME=keychain:SERVICE (repeatable)",
    collectOption,
    [],
  )
  .option("--credential-account <account>", "account for keychain mappings")
  .option("--timeout <milliseconds>", "real connection timeout", "8000")
  .option(
    "--approve-risk",
    "approve launching the reviewed pinned MCP artifact for --connect",
  )
  .option("--json", "emit machine-readable JSON")
  .action(
    async (
      id: string | undefined,
      options: {
        config?: string;
        yes?: boolean;
        verify?: boolean;
        connect?: boolean;
        credential: string[];
        credentialAccount?: string;
        timeout: string;
        approveRisk?: boolean;
        json?: boolean;
      },
    ) => {
      if (!id) {
        if (options.connect || options.verify || options.yes)
          throw new Error("Select an MCP recipe id for this operation");
        const listed = REVIEWED_MCP_RECIPES.map((recipe) => ({
          id: recipe.id,
          displayName: recipe.displayName,
          source: recipe.source,
          permissions: recipe.permissions,
          environment: recipe.environment,
        }));
        console.log(
          options.json
            ? JSON.stringify(listed, null, 2)
            : listed
                .map(
                  (recipe) =>
                    `${recipe.id} — ${recipe.displayName} — env: ${recipe.environment.length ? recipe.environment.join(", ") : "none"}`,
                )
                .join("\n"),
        );
        return;
      }
      if (options.connect) {
        if (options.verify || options.yes)
          throw new Error(
            "--connect cannot be combined with --verify or --yes",
          );
        const recipe = findMcpRecipe(id);
        const credentialReferences: Record<
          string,
          | { kind: "environment"; name: string }
          | { kind: "os-keychain"; service: string; account?: string }
        > = {};
        for (const mapping of options.credential) {
          const separator = mapping.indexOf("=");
          if (separator <= 0)
            throw new Error(
              `Invalid --credential '${mapping}'; expected NAME=env:VARIABLE or NAME=keychain:SERVICE`,
            );
          const name = mapping.slice(0, separator);
          const value = mapping.slice(separator + 1);
          if (!recipe.environment.includes(name))
            throw new Error(
              `Credential '${name}' is not required by recipe '${id}'`,
            );
          if (value.startsWith("env:"))
            credentialReferences[name] = {
              kind: "environment",
              name: value.slice(4),
            };
          else if (value.startsWith("keychain:"))
            credentialReferences[name] = {
              kind: "os-keychain",
              service: value.slice(9),
              ...(options.credentialAccount
                ? { account: options.credentialAccount }
                : {}),
            };
          else
            throw new Error(
              `Invalid --credential '${mapping}'; use env: or keychain:`,
            );
        }
        const timeoutMs = Number(options.timeout);
        const controller = new AbortController();
        const abort = () => controller.abort();
        process.once("SIGINT", abort);
        process.once("SIGTERM", abort);
        try {
          const result = await verifyMcpRecipeConnection(id, {
            approveRisk: Boolean(options.approveRisk),
            credentialReferences,
            timeoutMs,
            signal: controller.signal,
          });
          console.log(
            options.json
              ? JSON.stringify(result, null, 2)
              : `Connected: ${result.recipeId} · MCP ${result.protocolVersion}${result.serverInfo ? ` · ${result.serverInfo.name}${result.serverInfo.version ? ` ${result.serverInfo.version}` : ""}` : ""}\n${result.checks.join("\n")}`,
          );
        } finally {
          process.off("SIGINT", abort);
          process.off("SIGTERM", abort);
        }
        return;
      }
      if (!options.config)
        throw new Error("--config is required for recipe planning or --verify");
      if (options.verify) {
        if (options.yes)
          throw new Error("--verify cannot be combined with --yes");
        const verification = await verifyMcpRecipe(id, options.config);
        console.log(
          options.json
            ? JSON.stringify(verification, null, 2)
            : `${verification.configured ? "Configured" : "Not configured"}: ${verification.recipeId}\n${[...verification.checks, ...verification.warnings].join("\n")}`,
        );
        if (!verification.configured) process.exitCode = 1;
        return;
      }
      const plan = await planMcpRecipe(id, options.config);
      if (!options.yes) {
        console.log(
          options.json
            ? JSON.stringify(plan, null, 2)
            : `${formatMcpRecipePlan(plan)}\nDry run only. Re-run with --yes to write this server entry.`,
        );
        return;
      }
      const snapshot = await applyMcpConfigPlan(plan.config);
      console.log(
        options.json
          ? JSON.stringify({ plan, snapshot }, null, 2)
          : `${formatMcpRecipePlan(plan)}\nConfigured. Snapshot: ${snapshot.id}\nAuthorize the service separately, then run: loadout mcp-recipe ${id} --config ${plan.config.path} --verify`,
      );
    },
  );

program
  .command("mcp")
  .description("Inspect MCP manifests without executing servers or scripts")
  .option("--source <directory>", "local repository directory")
  .option("--repository <owner/repo>", "public GitHub repository")
  .option("--json", "emit normalized JSON")
  .action(
    async (options: {
      source?: string;
      repository?: string;
      json?: boolean;
    }) => {
      if ((options.source ? 1 : 0) + (options.repository ? 1 : 0) !== 1) {
        throw new Error("Provide exactly one of --source or --repository");
      }
      const source = options.repository
        ? (await fetchRepositorySnapshot(options.repository)).path
        : options.source!;
      const manifests = await discoverMcpManifests(source);
      if (options.json) console.log(JSON.stringify(manifests, null, 2));
      else if (manifests.length === 0)
        console.log("No supported MCP manifests found.");
      else
        for (const manifest of manifests)
          console.log(summarizeMcpManifest(manifest));
    },
  );

program
  .command("inspect")
  .description(
    "Inspect skills and MCP components in a local directory or public GitHub repository",
  )
  .option("--source <directory>", "local package directory")
  .option("--repository <owner/repo>", "public GitHub repository")
  .option("--json", "emit normalized JSON")
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
      const result = await inspectPackage(source);
      console.log(
        options.json
          ? JSON.stringify(result, null, 2)
          : formatPackageInspection(result),
      );
    },
  );

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
      `${action === "schedule" ? "Install" : "Remove"} a native daily read-only update or candidate-discovery check`,
    )
    .option("--time <HH:MM>", "local daily check time", "09:00")
    .option("--job <updates|discovery>", "daily read-only job", "updates")
    .option("--yes", "apply the native scheduler change")
    .option("--json", "emit machine-readable JSON")
    .action(
      async (options: {
        time: string;
        job: string;
        yes?: boolean;
        json?: boolean;
      }) => {
        if (options.job !== "updates" && options.job !== "discovery")
          throw new Error("--job must be updates or discovery");
        const plan = planNativeScheduler(action, {
          time: options.time,
          launcher: durableSchedulerLauncher(),
          job: options.job,
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
  .requiredOption("--config <path>", "MCP JSON configuration path")
  .requiredOption("--name <name>", "server name")
  .option("--command <command>", "local server command")
  .option("--url <url>", "remote MCP server URL")
  .option(
    "--arg <value>",
    "server argument (repeatable)",
    (value: string, previous: string[] = []) => [...previous, value],
    [],
  )
  .option(
    "--env <NAME=VALUE>",
    "environment variable (repeatable; values are never printed)",
    (value: string, previous: string[] = []) => [...previous, value],
    [],
  )
  .option("--yes", "apply the change; without this flag only a plan is shown")
  .action(
    async (options: {
      config: string;
      name: string;
      command?: string;
      url?: string;
      arg: string[];
      env: string[];
      yes?: boolean;
    }) => {
      if ((options.command ? 1 : 0) + (options.url ? 1 : 0) !== 1)
        throw new Error("Provide exactly one of --command or --url");
      const env: Record<string, string> = {};
      for (const item of options.env) {
        const separator = item.indexOf("=");
        if (separator <= 0)
          throw new Error(`Invalid --env '${item}'; expected NAME=VALUE`);
        const key = item.slice(0, separator);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
          throw new Error(`Invalid environment variable name '${key}'`);
        env[key] = item.slice(separator + 1);
      }
      const server: McpServer = {
        name: options.name,
        command: options.command,
        url: options.url,
        args: options.arg,
        env,
        sourcePath: options.config,
        warnings: [],
      };
      const plan = await planMcpConfig(options.config, server);
      console.log(summarizeMcpConfigPlan(plan));
      if (!options.yes) {
        console.log("Dry run only. Re-run with --yes to apply this change.");
        return;
      }
      const snapshot = await applyMcpConfigPlan(plan);
      console.log(`Applied successfully. Snapshot: ${snapshot.id}`);
    },
  );

program
  .command("codex-mcp-config")
  .description("Plan or add a Codex TOML MCP server (dry-run by default)")
  .option(
    "--config <path>",
    "Codex config.toml path",
    defaultCodexMcpConfigPath(),
  )
  .requiredOption("--name <name>", "server name")
  .option("--command <command>", "local server command")
  .option("--url <url>", "remote MCP server URL")
  .option(
    "--arg <value>",
    "server argument (repeatable)",
    (value: string, previous: string[] = []) => [...previous, value],
    [],
  )
  .option(
    "--env <NAME=VALUE>",
    "environment variable (repeatable; values are never printed)",
    (value: string, previous: string[] = []) => [...previous, value],
    [],
  )
  .option("--yes", "apply the change; without this flag only a plan is shown")
  .action(
    async (options: {
      config: string;
      name: string;
      command?: string;
      url?: string;
      arg: string[];
      env: string[];
      yes?: boolean;
    }) => {
      if ((options.command ? 1 : 0) + (options.url ? 1 : 0) !== 1)
        throw new Error("Provide exactly one of --command or --url");
      const env: Record<string, string> = {};
      for (const item of options.env) {
        const separator = item.indexOf("=");
        if (separator <= 0)
          throw new Error(`Invalid --env '${item}'; expected NAME=VALUE`);
        const key = item.slice(0, separator);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
          throw new Error(`Invalid environment variable name '${key}'`);
        env[key] = item.slice(separator + 1);
      }
      const server: McpServer = {
        name: options.name,
        command: options.command,
        url: options.url,
        args: options.arg,
        env,
        sourcePath: options.config,
        warnings: [],
      };
      const plan = await planCodexMcpConfig(options.config, server);
      console.log(`Codex config: ${plan.path}\n  - ${plan.summary}`);
      if (!options.yes)
        return console.log(
          "Dry run only. Re-run with --yes to add this Codex MCP server.",
        );
      const snapshot = await applyCodexMcpConfigPlan(plan);
      console.log(`Applied successfully. Snapshot: ${snapshot.id}`);
    },
  );

program
  .command("plan")
  .description(
    "Plan installing packages from a local directory, catalog, or public GitHub repository",
  )
  .option("--source <directory>", "local package directory containing SKILL.md")
  .option(
    "--repository <owner/repo>",
    "public GitHub repository containing SKILL.md",
  )
  .option(
    "--package <id>",
    "package identifier (repeat for custom mode)",
    (value: string, previous: string[] = []) => [...previous, value],
    [],
  )
  .option(
    "--mode <mode>",
    "catalog selection mode: stable, power, maximum, or custom",
  )
  .option(
    "--agents <ids>",
    "comma-separated agent ids; defaults to all detected agents",
  )
  .action(
    async (options: {
      source?: string;
      repository?: string;
      package: string[];
      mode?: string;
      agents?: string;
    }) => {
      const packageIds = options.package ?? [];
      const hasSource = Boolean(options.source || options.repository);
      if (hasSource && options.mode)
        throw new Error(
          "--mode cannot be combined with --source or --repository",
        );
      if (hasSource && packageIds.length !== 1)
        throw new Error(
          "A source or repository requires exactly one --package",
        );
      if (!hasSource && !options.mode)
        throw new Error(
          "Provide --mode or exactly one of --source/--repository",
        );
      if (!hasSource) {
        const prepared = await prepareCatalogInstall(
          setupSelection(options.mode!, packageIds),
          {
            requestedAgents: parseAgentSelection(options.agents),
            onProgress: printSetupProgress,
          },
        );
        console.log(
          JSON.stringify(
            {
              mode: prepared.selection.mode,
              agents: prepared.agents.map((agent) => agent.id),
              packages: prepared.entries.map((entry) => ({
                ...entry.plan,
                repository: entry.metadata?.repository,
                resolvedCommit: entry.metadata?.resolvedCommit,
                safety: entry.safety,
              })),
              skipped: prepared.skipped,
              profile: {
                deferred: prepared.resolution.deferred.map((pkg) => pkg.id),
                conflicts: prepared.resolution.conflicts,
                warnings: prepared.resolution.warnings,
              },
            },
            null,
            2,
          ),
        );
        return;
      }
      const resolution = hasSource
        ? undefined
        : resolveCatalogProfile(await loadEffectiveCatalog(), {
            mode: options.mode as InstallSelectionMode,
            packageIds,
          });
      const selected = hasSource
        ? [{ id: packageIds[0] }]
        : resolution!.packages;
      const agents = installedAgents(
        await detectAgents(),
        parseAgentSelection(options.agents),
      );
      const plans = [];
      const skipped: Array<{ packageId: string; reason: string }> = [];
      for (const pkg of selected) {
        const fetched = options.repository
          ? await fetchRepositorySnapshot(options.repository)
          : !options.source
            ? await fetchRepositorySnapshot(
                (pkg as { repository: string }).repository,
              )
            : undefined;
        try {
          plans.push(
            await buildSkillPlan(
              fetched?.path ?? options.source!,
              pkg.id,
              agents,
            ),
          );
        } catch (error) {
          if (
            !options.mode ||
            !(error instanceof Error) ||
            !error.message.startsWith("No SKILL.md found")
          )
            throw error;
          skipped.push({
            packageId: pkg.id,
            reason:
              "No SKILL.md found; this package is not skill-installable yet (inspect its MCP manifest instead).",
          });
        }
      }
      console.log(
        JSON.stringify(
          options.mode
            ? {
                mode: options.mode,
                packages: plans,
                skipped,
                profile: resolution && {
                  deferred: resolution.deferred.map((pkg) => pkg.id),
                  conflicts: resolution.conflicts,
                  warnings: resolution.warnings,
                },
              }
            : plans[0],
          null,
          2,
        ),
      );
    },
  );

program
  .command("install")
  .description(
    "Install packages from a local directory, catalog, or public GitHub repository",
  )
  .option("--source <directory>", "local package directory containing SKILL.md")
  .option(
    "--repository <owner/repo>",
    "public GitHub repository containing SKILL.md",
  )
  .option(
    "--package <id>",
    "package identifier (repeat for custom mode)",
    (value: string, previous: string[] = []) => [...previous, value],
    [],
  )
  .option(
    "--mode <mode>",
    "catalog selection mode: stable, power, maximum, or custom",
  )
  .option(
    "--agents <ids>",
    "comma-separated agent ids; defaults to all detected agents",
  )
  .option("--yes", "apply without interactive confirmation")
  .option("--approve-risk", "approve reviewed safety findings for catalog mode")
  .action(
    async (options: {
      source?: string;
      repository?: string;
      package: string[];
      mode?: string;
      agents?: string;
      yes?: boolean;
      approveRisk?: boolean;
    }) => {
      const packageIds = options.package ?? [];
      const hasSource = Boolean(options.source || options.repository);
      if (hasSource && options.mode)
        throw new Error(
          "--mode cannot be combined with --source or --repository",
        );
      if (hasSource && packageIds.length !== 1)
        throw new Error(
          "A source or repository requires exactly one --package",
        );
      if (!hasSource && !options.mode)
        throw new Error(
          "Provide --mode or exactly one of --source/--repository",
        );
      if (!hasSource) {
        const prepared = await prepareCatalogInstall(
          setupSelection(options.mode!, packageIds),
          {
            requestedAgents: parseAgentSelection(options.agents),
            onProgress: printSetupProgress,
          },
        );
        console.log(formatPreparedCatalogInstall(prepared));
        if (!options.yes) {
          console.log(
            "Preview complete; nothing was changed. Use --yes after reviewing to install this exact plan.",
          );
          return;
        }
        const snapshotId = await applyPreparedCatalogInstall(prepared, {
          approveRisk: options.approveRisk,
        });
        console.log(
          `Installed ${prepared.entries.length} repositories as one transaction. Snapshot: ${snapshotId}`,
        );
        return;
      }
      const resolution = hasSource
        ? undefined
        : resolveCatalogProfile(await loadEffectiveCatalog(), {
            mode: options.mode as InstallSelectionMode,
            packageIds,
          });
      const selected = hasSource
        ? [{ id: packageIds[0] }]
        : resolution!.packages;
      const agents = installedAgents(
        await detectAgents(),
        parseAgentSelection(options.agents),
      );
      const plans: Array<{
        plan: Awaited<ReturnType<typeof buildSkillPlan>>;
        repository?: string;
        commit?: string;
      }> = [];
      const skipped: Array<{ packageId: string; reason: string }> = [];
      for (const pkg of selected) {
        const fetched = options.repository
          ? await fetchRepositorySnapshot(options.repository)
          : !options.source
            ? await fetchRepositorySnapshot(
                (pkg as { repository: string }).repository,
              )
            : undefined;
        try {
          plans.push({
            plan: await buildSkillPlan(
              fetched?.path ?? options.source!,
              pkg.id,
              agents,
            ),
            repository: fetched?.repository,
            commit: fetched?.commit,
          });
        } catch (error) {
          if (
            !options.mode ||
            !(error instanceof Error) ||
            !error.message.startsWith("No SKILL.md found")
          )
            throw error;
          skipped.push({
            packageId: pkg.id,
            reason:
              "No SKILL.md found; this package is not skill-installable yet (inspect its MCP manifest instead).",
          });
        }
      }
      console.log(
        `Installing ${plans.map(({ plan }) => plan.packageId).join(", ")} for ${agents.map((agent) => agent.id).join(", ")}...`,
      );
      for (const warning of resolution?.warnings ?? [])
        console.log(`Profile warning: ${warning}`);
      for (const entry of skipped)
        console.log(`Skipping ${entry.packageId}: ${entry.reason}`);
      if (!options.yes)
        console.log(
          "Review the plan with `loadout plan`; use --yes to apply it.",
        );
      if (!options.yes) return;
      for (const entry of plans) {
        const snapshotId = await applySkillInstall(
          entry.plan,
          entry.repository
            ? { repository: entry.repository, resolvedCommit: entry.commit }
            : undefined,
        );
        console.log(
          `Installed ${entry.plan.packageId} successfully. Snapshot: ${snapshotId}`,
        );
      }
    },
  );

program
  .command("rollback")
  .description("Restore the most recent Loadout snapshot")
  .option("--snapshot <id>", "specific snapshot id")
  .option("--list", "list snapshot ids without restoring anything")
  .action(async (options: { snapshot?: string; list?: boolean }) => {
    if (options.list) {
      const snapshotIds = await listSnapshotIds();
      if (!snapshotIds.length)
        return console.log("No Loadout snapshots found.");
      for (const id of snapshotIds) console.log(id);
      return;
    }
    const selected = await withMutationLock(async () => {
      const snapshotIds = await listSnapshotIds();
      const chosen = options.snapshot ?? snapshotIds.at(-1);
      if (!chosen) throw new Error("No Loadout snapshots found");
      await restoreSnapshot(await readSnapshot(chosen));
      return chosen;
    });
    console.log(`Restored snapshot ${selected}`);
  });

program
  .command("update")
  .description("Plan updates, or apply one explicitly selected package update")
  .option("--json", "emit machine-readable JSON")
  .option("--apply", "apply the selected update")
  .option("--package <id>", "managed package id to update")
  .option(
    "--approve-risk",
    "explicitly approve an update containing blocked safety findings",
  )
  .action(
    async (options: {
      json?: boolean;
      apply?: boolean;
      package?: string;
      approveRisk?: boolean;
    }) => {
      if (options.apply) {
        if (!options.package)
          throw new Error("--apply requires --package <id>");
        const result = await applyPackageUpdate(options.package, {
          approveRisk: options.approveRisk,
        });
        console.log(
          `Updated ${options.package} to ${result.commit}. Snapshot: ${result.snapshotId}`,
        );
        return;
      }
      const plans = await buildUpdatePlan();
      console.log(
        options.json ? JSON.stringify(plans, null, 2) : formatUpdatePlan(plans),
      );
    },
  );

program
  .command("convert")
  .description(
    "Convert a subagent or hook into a static, loss-reported artifact",
  )
  .requiredOption("--kind <kind>", "subagent or hook")
  .requiredOption(
    "--target <target>",
    "codex-skill, claude-skill, or static-review",
  )
  .requiredOption("--name <name>", "source component name")
  .requiredOption("--input <path>", "UTF-8 instruction or hook source file")
  .requiredOption("--output <directory>", "artifact output directory")
  .option("--yes", "write the artifact; otherwise preview only")
  .option("--json", "emit machine-readable JSON")
  .action(
    async (options: {
      kind: string;
      target: string;
      name: string;
      input: string;
      output: string;
      yes?: boolean;
      json?: boolean;
    }) => {
      const kinds: ConversionKind[] = ["subagent", "hook"];
      const targets: ConversionTarget[] = [
        "codex-skill",
        "claude-skill",
        "static-review",
      ];
      if (!kinds.includes(options.kind as ConversionKind))
        throw new Error("--kind must be subagent or hook");
      if (!targets.includes(options.target as ConversionTarget))
        throw new Error(
          "--target must be codex-skill, claude-skill, or static-review",
        );
      const result = compileConversion(
        {
          kind: options.kind as ConversionKind,
          name: options.name,
          body: await readFile(options.input, "utf8"),
        },
        options.target as ConversionTarget,
      );
      const destination = resolve(options.output, result.relativePath);
      if (options.yes)
        await writeFileAtomically(destination, result.content, 0o600);
      const report = {
        ...result,
        ...(options.yes
          ? { destination }
          : { destination, write: "preview-only" as const }),
      };
      console.log(
        options.json
          ? JSON.stringify(report, null, 2)
          : `${options.yes ? "Wrote" : "Previewed"} ${destination}.\n` +
              `Preserved: ${result.preserved.join(", ")}. Dropped: ${result.dropped.length} field(s).\n` +
              (result.requiresApproval
                ? "Manual approval is required before using this artifact."
                : "No additional approval is required."),
      );
    },
  );

program
  .command("canary")
  .description(
    "Run a static canary policy gate for a candidate without installing it",
  )
  .requiredOption("--source <directory>", "candidate package directory")
  .requiredOption("--package <id>", "candidate package id")
  .option("--repository <owner/repo>", "candidate repository")
  .option("--commit <sha>", "candidate immutable commit")
  .option("--approve", "approve promotion if a promotion callback is supplied")
  .option("--allow-unready", "allow review findings in the static gate")
  .option("--json", "emit machine-readable JSON")
  .action(
    async (options: {
      source: string;
      package: string;
      repository?: string;
      commit?: string;
      approve?: boolean;
      allowUnready?: boolean;
      json?: boolean;
    }) => {
      const result = await runCanary(
        {
          packageId: options.package,
          root: options.source,
          ...(options.repository ? { repository: options.repository } : {}),
          ...(options.commit ? { commit: options.commit } : {}),
        },
        { enabled: true, requireStaticReady: !options.allowUnready },
        { approve: options.approve },
      );
      console.log(
        options.json
          ? JSON.stringify(result, null, 2)
          : formatCanaryResult(result),
      );
      if (result.status === "blocked") process.exitCode = 1;
    },
  );

program
  .command("dashboard")
  .description("Start the local Loadout dashboard on a loopback-only port")
  .option("--port <port>", "TCP port (0 selects an available port)", "0")
  .action(async (options: { port: string }) => {
    const port = Number(options.port);
    if (!Number.isInteger(port) || port < 0 || port > 65_535)
      throw new Error("--port must be an integer between 0 and 65535");
    const handle = await startDashboardServer({}, port);
    console.log(`Loadout dashboard: http://${handle.host}:${handle.port}`);
    await new Promise<void>((resolve) => {
      const stop = () => {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        void handle.close().then(resolve);
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    });
  });

program
  .command("serve")
  .description(
    "Start a loopback-only read-only API for status, health, catalog, and updates",
  )
  .option("--port <port>", "TCP port (0 selects an available port)", "0")
  .action(async (options: { port: string }) => {
    const handle = await startApiServer({ port: Number(options.port) });
    console.log(
      `Loadout API listening at http://${handle.host}:${handle.port}`,
    );
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
    await handle.close();
  });

program.action(() => runSetup({ package: [] }));

try {
  await recoverPendingTransactions();
  await program.parseAsync();
} catch (error) {
  if (
    error instanceof CommanderError &&
    (error.code === "commander.helpDisplayed" ||
      error.code === "commander.version")
  ) {
    // Help/version were already rendered successfully by Commander.
  } else {
    const message = error instanceof Error ? error.message : String(error);
    const jsonErrors =
      process.argv.includes("--json-errors") ||
      Boolean((program.opts() as { jsonErrors?: boolean }).jsonErrors);
    console.error(
      jsonErrors
        ? JSON.stringify({
            error: {
              code:
                error instanceof CommanderError ? error.code : "loadout.error",
              message,
            },
          })
        : `Error: ${message}`,
    );
    process.exitCode = 1;
  }
}
