import { Command } from "commander";

import { parseAgentSelection } from "../core/agents/paths.js";

import { buildUpdatePlan } from "../core/install/update.js";

import {
  buildHealthReport,
  formatHealthReport,
} from "../core/reporting/health.js";

import {
  buildFreshnessAlerts,
  formatFreshnessAlerts,
  ignoreFreshnessAlert,
  pinReplacement,
  readReplacementPins,
  unpinReplacement,
} from "../core/reporting/freshness-alerts.js";

import { formatAgentHealthScore } from "../core/agents/agent-health-score.js";
import { buildLocalAgentHealthScores } from "../core/agents/health-score-evidence.js";

export function registerHealth(program: Command): void {
  program
    .command("health")
    .description(
      "Quickly check agents, installed packages, and local file drift",
    )
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
              (score) =>
                !selectedAgents || selectedAgents.includes(score.agent),
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
