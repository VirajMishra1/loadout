#!/usr/bin/env node
import { Command } from "commander";
import { loadCatalog, rankCatalog } from "./core/catalog.js";
import { detectAgents } from "./core/paths.js";
import { readFile, readdir } from "node:fs/promises";
import { buildSkillPlan, applySkillInstall, installedAgents } from "./core/install.js";
import { restoreSnapshot } from "./core/snapshot.js";
import type { AgentId } from "./shared/types.js";

const program = new Command();
program.name("loadout").description("Universal upgrade manager for AI coding agents").version("0.1.0");

program.command("status").description("Show detected coding agents").action(async () => {
  const agents = await detectAgents();
  for (const agent of agents) {
    console.log(`${agent.installed ? "✓" : "○"} ${agent.displayName} — ${agent.skillsDirectory}`);
  }
});

program.command("catalog").description("List the bundled real package catalog").action(async () => {
  const packages = rankCatalog(await loadCatalog());
  for (const pkg of packages) console.log(`${pkg.displayName} [${pkg.tier}] — ${pkg.repository}`);
});

program.command("plan")
  .description("Plan installing a local skill package into detected agents")
  .requiredOption("--source <directory>", "local package directory containing SKILL.md")
  .requiredOption("--package <id>", "stable package identifier")
  .option("--agents <ids>", "comma-separated agent ids; defaults to all detected agents")
  .action(async (options: { source: string; package: string; agents?: string }) => {
    const agents = installedAgents(await detectAgents(), options.agents?.split(",") as AgentId[] | undefined);
    const plan = await buildSkillPlan(options.source, options.package, agents);
    console.log(JSON.stringify(plan, null, 2));
  });

program.command("install")
  .description("Install a local skill package into detected agents")
  .requiredOption("--source <directory>", "local package directory containing SKILL.md")
  .requiredOption("--package <id>", "stable package identifier")
  .option("--agents <ids>", "comma-separated agent ids; defaults to all detected agents")
  .option("--yes", "apply without interactive confirmation")
  .action(async (options: { source: string; package: string; agents?: string; yes?: boolean }) => {
    const agents = installedAgents(await detectAgents(), options.agents?.split(",") as AgentId[] | undefined);
    const plan = await buildSkillPlan(options.source, options.package, agents);
    console.log(`Installing ${plan.packageId} for ${plan.targetAgents.join(", ")}...`);
    if (!options.yes) console.log("Review the plan with `loadout plan`; use --yes to apply it.");
    if (!options.yes) return;
    const snapshotId = await applySkillInstall(plan);
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

program.action(async () => {
  const agents = await detectAgents();
  const packages = rankCatalog(await loadCatalog());
  console.log("Loadout detected:");
  for (const agent of agents) console.log(`  ${agent.installed ? "✓" : "○"} ${agent.displayName}`);
  console.log(`\n${packages.length} real catalog packages are available.`);
  console.log("Run `loadout status` or `loadout catalog` for details.");
});

await program.parseAsync();
