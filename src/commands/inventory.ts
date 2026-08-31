import { Command } from "commander";
import { loadEffectiveCatalog } from "../core/catalog.js";
import { detectAgents, parseAgentSelection } from "../core/paths.js";
import { resolve } from "node:path";

import { runDoctor, formatDoctorReport } from "../core/doctor.js";

import { applyProfileToManifest } from "../core/manifest.js";
import {
  buildHealthReport,
  formatStatusScreen,
  gradeHealth,
} from "../core/health.js";

import { applyRemove, planRemove } from "../core/remove.js";
import {
  applyUninstall,
  buildUninstallPlan,
  formatUninstallPlan,
  uninstallGlobalCli,
} from "../core/uninstall.js";

import {
  formatRecommendations,
  personalizeRecommendations,
  profileManifestPackages,
  recommendPackages,
  RECOMMENDATION_BOUNDARY,
  scanProject,
  TESTED_PROFILES,
} from "../core/recommend.js";
import { applySyncPlan, buildSyncPlan } from "../core/sync.js";

import {
  formatAgentInventory,
  inspectAgents,
} from "../core/agent-inspection.js";

import {
  formatInstalledSkillInventory,
  scanInstalledSkills,
} from "../core/skill-inventory.js";
import {
  enrichInventoryWithProvenance,
  formatProvenanceSummary,
  resolveCatalogSkillIndex,
} from "../core/provenance.js";

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

import { readLocalOutcomes } from "../core/outcomes.js";

import {
  formatAgentVersions,
  inspectAgentVersions,
} from "../core/agent-versions.js";

import { scanSkillSecurity } from "../core/skill-security.js";

import { printProvenanceProgress } from "./support.js";

export function registerInventory(program: Command): void {
  program
    .command("remove")
    .description("Safely remove only files managed for one package")
    .argument("<package>", "managed package id")
    .option("--yes", "apply removal; otherwise show a plan")
    .option("--force", "also remove managed files changed outside Loadout")
    .action(
      async (
        packageId: string,
        options: { yes?: boolean; force?: boolean },
      ) => {
        const plan = await planRemove(packageId);
        console.log(JSON.stringify(plan, null, 2));
        if (!options.yes)
          return console.log(
            "Dry run only. Re-run with --yes to apply this removal plan.",
          );
        const snapshot = await applyRemove(plan, { force: options.force });
        console.log(`Removed ${packageId}. Snapshot: ${snapshot}`);
      },
    );

  program
    .command("uninstall")
    .description("Preview or completely remove Loadout-managed data")
    .option("--yes", "remove managed data; otherwise show a preview")
    .option("--force", "also remove managed files changed outside Loadout")
    .option("--remove-cli", "also uninstall the global loadout-ai npm command")
    .action(
      async (options: {
        yes?: boolean;
        force?: boolean;
        removeCli?: boolean;
      }) => {
        const plan = await buildUninstallPlan();
        console.log(
          formatUninstallPlan(plan, { applying: Boolean(options.yes) }),
        );
        if (!options.yes) return;
        const result = await applyUninstall(plan, undefined, {
          force: options.force,
          onProgress: (message) => console.log(`→ ${message}`),
        });
        console.log(
          `Removed ${result.removedPackages} managed package(s), ${result.removedRuntimeTools} runtime tool(s), daily jobs, cache, library, and Loadout state.`,
        );
        if (options.removeCli) {
          await uninstallGlobalCli();
          console.log(
            "Removed the global loadout-ai CLI. Open a new shell before checking the command again.",
          );
        } else {
          console.log(
            "The CLI is still installed. Remove it too with: npm uninstall -g loadout-ai",
          );
        }
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
                  recommendationBoundary: RECOMMENDATION_BOUNDARY,
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
    .description("List Loadout policy profiles or inspect one profile")
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
        if (name === "custom" && !options.applyTo) {
          const profile = TESTED_PROFILES.custom;
          return console.log(
            options.json
              ? JSON.stringify({ name, ...profile, packages: [] }, null, 2)
              : `custom: ${profile.description}\n  Use: loadout setup --mode custom --package <id>`,
          );
        }
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
    .command("reconcile")
    .description(
      "Match existing unmanaged skills to pinned sources, group mirrors, and preview safe ownership or updates",
    )
    .option(
      "--agents <ids>",
      "comma-separated agent ids; defaults to detected agents",
    )
    .option("--refresh", "rebuild the inspected catalog skill index")
    .option(
      "--replace-outdated",
      "replace unambiguous outdated trees with their reviewed pinned source",
    )
    .option(
      "--approve-risk",
      "approve the exact safety findings shown for outdated replacements",
    )
    .option("--yes", "apply the displayed transaction; otherwise preview")
    .option("--json", "emit machine-readable output")
    .action(
      async (options: {
        agents?: string;
        refresh?: boolean;
        replaceOutdated?: boolean;
        approveRisk?: boolean;
        yes?: boolean;
        json?: boolean;
      }) => {
        const detected = await detectAgents();
        const requested = parseAgentSelection(options.agents);
        const selected = requested?.length
          ? detected.filter(
              (agent) => requested.includes(agent.id) && agent.installed,
            )
          : detected.filter((agent) => agent.installed);
        if (!selected.length)
          throw new Error(
            "No detected agent profile is available to reconcile",
          );
        const resolved = await resolveCatalogSkillIndex({
          refresh: options.refresh,
          build: {
            catalog: await loadEffectiveCatalog(),
            onProgress: options.refresh ? printProvenanceProgress : undefined,
          },
        });
        if (!resolved.index)
          throw new Error("No reviewed catalog skill index is available");
        const plan = await buildReconcilePlan(selected, resolved.index);
        if (!options.yes) {
          console.log(
            options.json
              ? JSON.stringify(plan, null, 2)
              : `${formatReconcilePlan(plan)}\n\nDry run only. Re-run with --yes to adopt exact matches.${plan.summary.outdated ? " Add --replace-outdated to include the reviewed updates shown above." : ""}`,
          );
          return;
        }
        const result = await applyReconcilePlan(plan, {
          replaceOutdated: options.replaceOutdated,
          approveRisk: options.approveRisk,
        });
        console.log(
          options.json
            ? JSON.stringify({ plan, result }, null, 2)
            : `${formatReconcilePlan(plan)}\n\nReconciled ${result.adopted} exact group(s) and ${result.updated} outdated group(s). Snapshot: ${result.snapshotId}`,
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
    .option("--refresh-provenance", "rebuild the inspected catalog skill index")
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
    .command("status")
    .description(
      "Home screen: a health grade, detected agents, and the next thing to do",
    )
    .option(
      "--details",
      "show per-component adapter compatibility for each agent",
    )
    .option("--json", "emit machine-readable status")
    .action(async (options: { details?: boolean; json?: boolean }) => {
      const agents = await detectAgents();
      const [inventory, report] = await Promise.all([
        inspectAgents(agents),
        buildHealthReport({}),
      ]);
      if (options.json)
        return console.log(
          JSON.stringify(
            { grade: gradeHealth(report), report, inventory },
            null,
            2,
          ),
        );
      console.log(
        formatStatusScreen(
          report,
          inventory.map((item) =>
            formatAgentInventory(item, { details: options.details }),
          ),
        ),
      );
    });

  program
    .command("versions")
    .description(
      "Detect installed agent versions with bounded read-only commands",
    )
    .option("--json", "emit machine-readable version evidence")
    .action(async (options: { json?: boolean }) => {
      const evidence = await inspectAgentVersions();
      console.log(
        options.json
          ? JSON.stringify(evidence, null, 2)
          : formatAgentVersions(evidence),
      );
    });

  program
    .command("skill-audit")
    .description(
      "Statically inspect one Agent Skill and emit its security/capability inventory",
    )
    .argument("<directory>", "skill directory containing SKILL.md")
    .option("--json", "emit the complete machine-readable report")
    .action(async (directory: string, options: { json?: boolean }) => {
      const report = await scanSkillSecurity(resolve(directory));
      console.log(
        options.json
          ? JSON.stringify(report, null, 2)
          : [
              `Skill audit: ${report.specification.name ?? report.rootName}`,
              `Verdict: ${report.verdict}`,
              `Inventory: ${report.inventory.totalFiles} files, ${report.inventory.totalBytes} bytes, sha256:${report.inventory.treeHash}`,
              `Capabilities: ${report.capabilities.executableFiles.length} executable/script files, ${report.capabilities.dependencyNames.length} named dependencies, ${report.capabilities.domains.length} domains, ${report.capabilities.environmentNames.length} environment names`,
              ...report.deterministicFindings.map(
                (item) =>
                  `${item.severity === "critical" ? "✗" : "!"} ${item.severity}/${item.category}: ${item.message} (${item.paths.join(", ")})`,
              ),
              ...(!report.deterministicFindings.length
                ? [
                    "No deterministic findings within the bounded static policy.",
                  ]
                : []),
              "Static inspection cannot prove runtime safety or task quality.",
            ].join("\n"),
      );
      if (report.verdict === "blocked") process.exitCode = 2;
    });

  program
    .command("doctor")
    .description(
      "Check agents, skill directories, permissions, and Loadout setup",
    )
    .option("--verbose", "show per-component detail for each agent")
    .option("--json", "print a machine-readable report")
    .action(async (options: { verbose?: boolean; json?: boolean }) => {
      const report = await runDoctor();
      console.log(
        options.json
          ? JSON.stringify(report, null, 2)
          : formatDoctorReport(report, { verbose: options.verbose }),
      );
    });
}
