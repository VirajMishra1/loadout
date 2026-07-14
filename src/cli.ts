#!/usr/bin/env node
import { Command } from "commander";
import { loadEffectiveCatalog, loadCatalog, rankCatalog, refreshCatalog } from "./core/catalog.js";
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
  .description("Plan installing a package from a local directory or public GitHub repository")
  .option("--source <directory>", "local package directory containing SKILL.md")
  .option("--repository <owner/repo>", "public GitHub repository containing SKILL.md")
  .requiredOption("--package <id>", "stable package identifier")
  .option("--agents <ids>", "comma-separated agent ids; defaults to all detected agents")
  .action(async (options: { source?: string; repository?: string; package: string; agents?: string }) => {
    if ((options.source ? 1 : 0) + (options.repository ? 1 : 0) !== 1) throw new Error("Provide exactly one of --source or --repository");
    const fetched = options.repository ? await fetchRepositorySnapshot(options.repository) : undefined;
    const source = fetched?.path ?? options.source!;
    const agents = installedAgents(await detectAgents(), options.agents?.split(",") as AgentId[] | undefined);
    const plan = await buildSkillPlan(source, options.package, agents);
    console.log(JSON.stringify(plan, null, 2));
  });

program.command("install")
  .description("Install a package from a local directory or public GitHub repository")
  .option("--source <directory>", "local package directory containing SKILL.md")
  .option("--repository <owner/repo>", "public GitHub repository containing SKILL.md")
  .requiredOption("--package <id>", "stable package identifier")
  .option("--agents <ids>", "comma-separated agent ids; defaults to all detected agents")
  .option("--yes", "apply without interactive confirmation")
  .action(async (options: { source?: string; repository?: string; package: string; agents?: string; yes?: boolean }) => {
    if ((options.source ? 1 : 0) + (options.repository ? 1 : 0) !== 1) throw new Error("Provide exactly one of --source or --repository");
    const fetched = options.repository ? await fetchRepositorySnapshot(options.repository) : undefined;
    const source = fetched?.path ?? options.source!;
    const agents = installedAgents(await detectAgents(), options.agents?.split(",") as AgentId[] | undefined);
    const plan = await buildSkillPlan(source, options.package, agents);
    console.log(`Installing ${plan.packageId} for ${plan.targetAgents.join(", ")}...`);
    if (!options.yes) console.log("Review the plan with `loadout plan`; use --yes to apply it.");
    if (!options.yes) return;
    const snapshotId = await applySkillInstall(plan, fetched ? { repository: fetched.repository, resolvedCommit: fetched.commit } : undefined);
    console.log(`Installed successfully. Snapshot: ${snapshotId}`);
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
