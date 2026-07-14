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
import { applyPackageUpdate, buildUpdatePlan, formatUpdatePlan } from "./core/update.js";
import { startApiServer } from "./core/api.js";
import { inspectPackage, formatPackageInspection } from "./core/package.js";
import { initManifest, readManifest, writeLockfile } from "./core/manifest.js";
import { buildHealthReport, formatHealthReport } from "./core/health.js";
import { readInstallState } from "./core/state.js";
import { applyRemove, planRemove } from "./core/remove.js";
import { formatRecommendations, profileManifestPackages, recommendPackages, scanProject, TESTED_PROFILES } from "./core/recommend.js";
import { buildImprovementCycle, formatImprovementCycle } from "./core/improve.js";
import { applySyncPlan, buildSyncPlan } from "./core/sync.js";

const program = new Command();
program.name("loadout").description("Universal upgrade manager for AI coding agents").version("0.1.0");

program.command("init")
  .description("Create a shareable loadout.json manifest")
  .option("--path <path>", "manifest path", "loadout.json")
  .option("--name <name>", "Loadout name")
  .option("--agents <ids>", "comma-separated agent ids", "codex,claude-code")
  .option("--scope <scope>", "project or global", "project")
  .action(async (options: { path: string; name?: string; agents: string; scope: string }) => {
    const manifest = await initManifest(options.path, { name: options.name, agents: options.agents.split(",") as AgentId[], scope: options.scope as "project" | "global" });
    console.log(`Created ${options.path} for ${manifest.agents.join(", ")}.`);
  });

program.command("lock")
  .description("Write exact installed state to loadout.lock")
  .option("--manifest <path>", "manifest path", "loadout.json")
  .option("--output <path>", "lockfile path", "loadout.lock")
  .action(async (options: { manifest: string; output: string }) => {
    const lockfile = await writeLockfile(await readManifest(options.manifest), options.output);
    console.log(`Wrote ${options.output} with ${lockfile.packages.length} resolved package(s).`);
  });

program.command("list")
  .alias("ls")
  .description("List packages managed by Loadout")
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    const state = await readInstallState();
    if (options.json) return console.log(JSON.stringify(state.installs, null, 2));
    if (!state.installs.length) return console.log("No Loadout-managed packages are installed.");
    for (const item of state.installs) console.log(`${item.packageId} — ${item.targetAgents.join(", ")} — ${item.resolvedCommit?.slice(0, 12) ?? "local"} — ${item.files.length} file(s)`);
  });

program.command("health")
  .description("Check agents, installed packages, updates, and file drift")
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    const report = await buildHealthReport();
    console.log(options.json ? JSON.stringify(report, null, 2) : formatHealthReport(report));
  });

program.command("remove")
  .description("Safely remove only files managed for one package")
  .argument("<package>", "managed package id")
  .option("--yes", "apply removal; otherwise show a plan")
  .option("--force", "also remove managed files changed outside Loadout")
  .action(async (packageId: string, options: { yes?: boolean; force?: boolean }) => {
    const plan = await planRemove(packageId);
    console.log(JSON.stringify(plan, null, 2));
    if (!options.yes) return console.log("Dry run only. Re-run with --yes to remove these files.");
    const snapshot = await applyRemove(plan, { force: options.force });
    console.log(`Removed ${packageId}. Snapshot: ${snapshot}`);
  });

program.command("recommend")
  .description("Recommend catalog packages from local project signals")
  .option("--project <path>", "project directory", process.cwd())
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { project: string; json?: boolean }) => {
    const signals = await scanProject(options.project);
    const recommendations = recommendPackages(signals, await loadEffectiveCatalog());
    console.log(options.json ? JSON.stringify({ signals, recommendations }, null, 2) : formatRecommendations(signals, recommendations));
  });

program.command("profiles")
  .description("List tested Loadout profiles or inspect one profile")
  .argument("[name]", "profile name")
  .option("--json", "emit machine-readable JSON")
  .action(async (name: string | undefined, options: { json?: boolean }) => {
    if (!name) return console.log(options.json ? JSON.stringify(TESTED_PROFILES, null, 2) : Object.entries(TESTED_PROFILES).map(([id, profile]) => `${id} — ${profile.description}`).join("\n"));
    const packages = profileManifestPackages(name, await loadEffectiveCatalog());
    console.log(options.json ? JSON.stringify({ name, ...TESTED_PROFILES[name], packages }, null, 2) : `${name}: ${TESTED_PROFILES[name].description}\n${packages.map((pkg) => `  ${pkg.id} — ${pkg.repository}`).join("\n")}`);
  });

program.command("improve")
  .description("Propose the next evidence-backed improvement without changing anything")
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    const cycle = await buildImprovementCycle();
    console.log(options.json ? JSON.stringify(cycle, null, 2) : formatImprovementCycle(cycle));
  });

program.command("sync")
  .description("Reproduce a loadout.json manifest as one safe transaction")
  .option("--manifest <path>", "manifest path", "loadout.json")
  .option("--lock <path>", "lockfile output", "loadout.lock")
  .option("--yes", "apply the plan; otherwise remain read-only")
  .action(async (options: { manifest: string; lock: string; yes?: boolean }) => {
    const plan = await buildSyncPlan(options.manifest);
    console.log(JSON.stringify({ manifest: plan.manifest, packages: plan.packages.map((entry) => entry.plan), skipped: plan.skipped }, null, 2));
    if (!options.yes) return console.log("Dry run only. Re-run with --yes to synchronize this Loadout.");
    const result = await applySyncPlan(plan, options.lock);
    console.log(`Synchronized successfully.${result.snapshotId ? ` Snapshot: ${result.snapshotId}.` : ""} Lockfile: ${result.lockfile}`);
  });

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

program.command("mcp")
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

program.command("mcp-config")
  .description("Plan or apply a safe MCP server configuration change (dry-run by default)")
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
  .description("Plan updates, or apply one explicitly selected package update")
  .option("--json", "emit machine-readable JSON")
  .option("--apply", "apply the selected update")
  .option("--package <id>", "managed package id to update")
  .option("--approve-risk", "explicitly approve an update containing blocked safety findings")
  .action(async (options: { json?: boolean; apply?: boolean; package?: string; approveRisk?: boolean }) => {
    if (options.apply) {
      if (!options.package) throw new Error("--apply requires --package <id>");
      const result = await applyPackageUpdate(options.package, { approveRisk: options.approveRisk });
      console.log(`Updated ${options.package} to ${result.commit}. Snapshot: ${result.snapshotId}`);
      return;
    }
    const plans = await buildUpdatePlan();
    console.log(options.json ? JSON.stringify(plans, null, 2) : formatUpdatePlan(plans));
  });

program.command("serve")
  .description("Start a loopback-only read-only API for status, health, catalog, and updates")
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
