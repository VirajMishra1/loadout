import { Command } from "commander";

import { parseAgentSelection } from "../core/paths.js";

import { formatHealthReport } from "../core/health.js";

import {
  applyUpgrade,
  formatUpgradePlan,
  planUpgrade,
  summarizeUpgradePlan,
} from "../core/upgrade.js";

import { parseModelApiAccess } from "../core/access.js";

import { ADVANCED_GUIDE } from "../core/cli-guide.js";
import {
  collectOption,
  setupSelection,
  printSetupProgress,
  runSetup,
  printBeginnerGuide,
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
