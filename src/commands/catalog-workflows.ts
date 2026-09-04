import type { Command } from "commander";
import { parseAgentSelection } from "../core/agents/paths.js";
import {
  applyFirstPartySkill,
  FIRST_PARTY_SKILLS,
  formatFirstPartySkillList,
  formatFirstPartySkillPlan,
  installedFirstPartySkills,
  planFirstPartySkill,
  removeFirstPartySkill,
} from "../core/delegation/first-party-skills.js";
import {
  applyPickup,
  formatHandoffStatus,
  formatInboxWithBundles,
  getHandoffState,
  initHandoff,
  isHandoffInitialized,
  isPickupTarget,
  markDone,
  planPickup,
  readInbox,
  sendHandoff,
} from "../core/delegation/handoff.js";
import {
  createHandoffBundle,
  removeHandoffBundle,
} from "../core/delegation/handoff-bundle.js";
import {
  completionCommandPaths,
  parseCompletionShell,
  renderShellCompletion,
} from "../core/reporting/completion.js";

export function registerWorkflowCommands(program: Command): void {
  const skills = program
    .command("skills")
    .description(
      "Install the skills Loadout ships so your agents can use Loadout from inside a conversation",
    );

  skills
    .command("list", { isDefault: true })
    .description("Show the skills Loadout ships and whether they are installed")
    .option("--json", "emit machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const installed = await installedFirstPartySkills();
      console.log(
        options.json
          ? JSON.stringify(
              FIRST_PARTY_SKILLS.map((skill) => ({
                ...skill,
                installed: installed.has(skill.id),
              })),
              null,
              2,
            )
          : formatFirstPartySkillList(installed),
      );
    });

  skills
    .command("install")
    .description("Preview or install one Loadout skill into detected agents")
    .argument("<id>", "skill id, for example loadout-handoff")
    .option(
      "--agents <ids>",
      "comma-separated agent ids; defaults to all detected",
    )
    .option("--yes", "apply after previewing")
    .action(async (id: string, options: { agents?: string; yes?: boolean }) => {
      const plan = await planFirstPartySkill(id, {
        ...(options.agents
          ? { agents: parseAgentSelection(options.agents)! }
          : {}),
      });
      console.log(formatFirstPartySkillPlan(plan));
      if (!plan.targets.length) return;
      if (!options.yes) {
        console.log("\nPreview only. Re-run with --yes to install.");
        return;
      }
      const snapshotId = await applyFirstPartySkill(plan);
      console.log(
        `\nInstalled '${plan.skill.id}' for ${plan.targets.length} agent(s). Snapshot: ${snapshotId}\nStart a new agent session to pick it up.`,
      );
    });

  skills
    .command("remove")
    .description("Preview or remove one Loadout skill from detected agents")
    .argument("<id>", "skill id")
    .option(
      "--agents <ids>",
      "comma-separated agent ids; defaults to all detected",
    )
    .option("--yes", "apply after previewing")
    .action(async (id: string, options: { agents?: string; yes?: boolean }) => {
      const plan = await planFirstPartySkill(id, {
        ...(options.agents
          ? { agents: parseAgentSelection(options.agents)! }
          : {}),
      });
      const present = plan.targets.filter((target) => target.replacing);
      if (!present.length) {
        console.log(`'${id}' is not installed for any detected agent.`);
        return;
      }
      for (const target of present)
        console.log(
          `  remove → ${target.destination}  [${target.displayName}]`,
        );
      if (!options.yes) {
        console.log("\nPreview only. Re-run with --yes to remove.");
        return;
      }
      const snapshotId = await removeFirstPartySkill(plan);
      console.log(
        `\nRemoved '${id}' from ${present.length} agent(s). Snapshot: ${snapshotId}`,
      );
    });

  const handoff = program
    .command("handoff")
    .description(
      "Hand a task to your other agent, or see what has been handed to you",
    );

  handoff
    .argument("[agent]", "who should do it, for example codex")
    .argument("[task...]", "what they should do")
    .option("--context <text>", "anything they need that is not in the task")
    .option(
      "--bundle <paths...>",
      "attach bounded snapshots of project-relative text files",
    )
    .option("--from <agent>", "who is sending", "user")
    .option("--done <id>", "mark a task finished")
    .option("--json", "emit machine-readable JSON")
    .action(
      async (
        agent: string | undefined,
        taskWords: string[],
        options: {
          context?: string;
          bundle?: string[];
          from: string;
          done?: string;
          json?: boolean;
        },
      ) => {
        const cwd = process.cwd();

        if (options.done) {
          const message = await markDone(cwd, options.done);
          console.log(
            options.json
              ? JSON.stringify(message, null, 2)
              : `Marked ${options.done} done.`,
          );
          return;
        }

        // No agent named: show what is waiting, for everyone.
        if (!agent) {
          const state = await getHandoffState(cwd);
          console.log(
            options.json
              ? JSON.stringify(state, null, 2)
              : formatHandoffStatus(state),
          );
          return;
        }

        // An agent with no task means "show me my inbox".
        const task = taskWords.join(" ").trim();
        if (!task) {
          const messages = await readInbox(cwd, agent);
          console.log(
            options.json
              ? JSON.stringify(messages, null, 2)
              : await formatInboxWithBundles(cwd, agent, messages),
          );
          return;
        }

        // Sending is the common case, so it sets itself up rather than failing
        // with instructions to run two other commands first.
        const setup: string[] = [];
        if (!(await isHandoffInitialized(cwd))) {
          await initHandoff(cwd);
          setup.push("created .handoff/");
        }
        for (const target of [options.from, agent]) {
          if (!isPickupTarget(target)) continue;
          const plan = await planPickup(cwd, target);
          if (!plan.replacing) {
            await applyPickup(plan);
            setup.push(`told ${target} to check its inbox`);
          }
        }

        const bundle = options.bundle
          ? await createHandoffBundle(cwd, options.bundle)
          : undefined;
        let message;
        try {
          message = await sendHandoff(cwd, agent, task, {
            from: options.from,
            ...(options.context ? { context: options.context } : {}),
            ...(bundle ? { bundle } : {}),
          });
        } catch (error) {
          if (bundle) await removeHandoffBundle(cwd, bundle);
          throw error;
        }

        if (options.json) {
          console.log(JSON.stringify({ message, setup }, null, 2));
          return;
        }
        for (const line of setup) console.log(`  ${line}`);
        console.log(`Sent to ${agent}: ${task}`);
        if (bundle)
          console.log(
            `Bundled ${bundle.fileCount} file(s) at ${bundle.path}${bundle.isTruncated ? " (truncated to safety limits)" : ""}.`,
          );
        console.log(
          `It will pick this up next session, or now with: loadout handoff ${agent}`,
        );
      },
    );

  program
    .command("completion")
    .description(
      "Print a shell-completion script; redirect it to your shell profile",
    )
    .argument("[shell]", "bash, zsh, fish, or powershell")
    .option(
      "--commands-json",
      "print registered command paths as JSON for tooling",
    )
    .action(
      (shell: string | undefined, options: { commandsJson?: boolean }) => {
        if (options.commandsJson) {
          console.log(JSON.stringify(completionCommandPaths(), null, 2));
          return;
        }
        process.stdout.write(
          renderShellCompletion(parseCompletionShell(shell ?? "")),
        );
      },
    );
}
