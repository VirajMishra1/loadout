import { Command } from "commander";

import { detectAgents, parseAgentSelection } from "../core/paths.js";
import { DEFAULT_ACTIVE_SKILL_LIMIT } from "../core/active-limit.js";

import type { AgentId } from "../shared/types.js";

import {
  applyActivationChange,
  formatActivationPlan,
  planActivationChange,
  type ActivationAction,
} from "../core/active-set.js";
import {
  applyProjectActivation,
  formatProjectActivation,
  planProjectActivation,
} from "../core/active-policy.js";

import {
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

import { collectOption, durableSchedulerLauncher } from "./support.js";

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
    .command("tool")
    .description(
      "Preview, install, or remove an explicitly reviewed runtime-tool recipe",
    )
    .argument("[id]", "runtime tool id; omit to list reviewed recipes")
    .option("--agents <ids>", "comma-separated target agent ids")
    .option(
      "--remove",
      "restore pre-install agent state and remove the runtime",
    )
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
