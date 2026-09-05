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
  planPickup,
  readInbox,
  sendHandoff,
} from "../core/delegation/handoff.js";
import {
  createHandoffBundle,
  removeHandoffBundle,
} from "../core/delegation/handoff-bundle.js";
import { completeHandoff } from "../core/delegation/handoff-verification.js";
import {
  applyTemplate,
  deleteTemplate,
  formatTemplateDetail,
  formatTemplateList,
  listTemplates,
  loadTemplate,
  saveTemplate,
  type HandoffTemplate,
} from "../core/delegation/handoff-templates.js";
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
    .option("--verify <criteria>", "acceptance criteria for this task")
    .option(
      "--verify-command <executable>",
      "executable to run on --done (never uses a shell)",
    )
    .option(
      "--verify-args <json>",
      "JSON array of literal arguments for --verify-command",
    )
    .option(
      "--verify-timeout <seconds>",
      "verification timeout in seconds (1-900; default 120)",
    )
    .option("--done <id>", "mark a task finished")
    .option(
      "--run-verification",
      "explicitly approve the stored no-shell verification command",
    )
    .option("--evidence <text>", "manual evidence for human-only criteria")
    .option("--template <name>", "use a handoff template for defaults")
    .option("--json", "emit machine-readable JSON")
    .action(
      async (
        agent: string | undefined,
        taskWords: string[],
        options: {
          context?: string;
          bundle?: string[];
          from: string;
          verify?: string;
          verifyCommand?: string;
          verifyArgs?: string;
          verifyTimeout?: string;
          done?: string;
          runVerification?: boolean;
          evidence?: string;
          template?: string;
          json?: boolean;
        },
      ) => {
        const cwd = process.cwd();

        // Apply template defaults if specified
        if (options.template) {
          const tmpl = await loadTemplate(cwd, options.template);
          if (!tmpl) {
            throw new Error(
              `Unknown template '${options.template}'. List with: loadout template list`,
            );
          }
          const applied = applyTemplate(tmpl, {
            input: taskWords.join(" ").trim() || undefined,
            agent: agent || undefined,
          });
          if (applied.agent && !agent) agent = applied.agent;
          if (applied.description) taskWords = [applied.description];
          if (applied.context && !options.context)
            options.context = applied.context;
          if (applied.bundleGlobs?.length) {
            options.bundle = [
              ...new Set([...(options.bundle ?? []), ...applied.bundleGlobs]),
            ];
          }
          if (applied.verifyCriteria && !options.verify)
            options.verify = applied.verifyCriteria;
          if (applied.verifyCommand && !options.verifyCommand) {
            options.verifyCommand = applied.verifyCommand.executable;
            options.verifyArgs = JSON.stringify(applied.verifyCommand.args);
            options.verifyTimeout = String(
              applied.verifyCommand.timeoutMs / 1000,
            );
          }
        }

        if (options.verifyCommand && !options.verify)
          throw new Error("--verify-command requires --verify");
        if (options.verifyArgs && !options.verifyCommand)
          throw new Error("--verify-args requires --verify-command");
        if (options.verifyTimeout && !options.verifyCommand)
          throw new Error("--verify-timeout requires --verify-command");
        if (options.evidence && !options.done)
          throw new Error("--evidence requires --done");
        if (options.runVerification && !options.done)
          throw new Error("--run-verification requires --done");

        let verifyArgs: string[] = [];
        if (options.verifyArgs) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(options.verifyArgs);
          } catch {
            throw new Error("--verify-args must be a JSON array of strings");
          }
          if (
            !Array.isArray(parsed) ||
            parsed.some((value) => typeof value !== "string")
          )
            throw new Error("--verify-args must be a JSON array of strings");
          verifyArgs = parsed;
        }

        const timeoutSeconds = options.verifyTimeout
          ? Number(options.verifyTimeout)
          : 120;
        if (
          options.verifyCommand &&
          (!Number.isInteger(timeoutSeconds) ||
            timeoutSeconds < 1 ||
            timeoutSeconds > 900)
        )
          throw new Error("--verify-timeout must be an integer from 1 to 900");

        if (options.done) {
          const outcome = await completeHandoff(cwd, options.done, {
            ...(options.runVerification ? { approveCommand: true } : {}),
            ...(options.evidence ? { manualEvidence: options.evidence } : {}),
          });
          console.log(
            options.json
              ? JSON.stringify(outcome, null, 2)
              : outcome.completed
                ? outcome.message.evidence
                  ? `Marked ${options.done} done with verification evidence.`
                  : `Marked ${options.done} done.`
                : `Verification failed for ${options.done}; the task remains pending.\n${outcome.message.evidence?.stderr || outcome.message.evidence?.stdout || "No command output."}`,
          );
          if (!outcome.completed) process.exitCode = 1;
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
            ...(options.verify
              ? {
                  verification: {
                    criteria: options.verify,
                    ...(options.verifyCommand
                      ? {
                          command: {
                            executable: options.verifyCommand,
                            args: verifyArgs,
                            timeoutMs: timeoutSeconds * 1_000,
                          },
                        }
                      : {}),
                  },
                }
              : {}),
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
        if (options.verify)
          console.log(
            options.verifyCommand
              ? `Verification runs only with: loadout handoff --done ${message.id} --run-verification`
              : `Completion requires evidence: loadout handoff --done ${message.id} --evidence "what you checked"`,
          );
        console.log(
          `It will pick this up next session, or now with: loadout handoff ${agent}`,
        );
      },
    );

  // `loadout template` — manage handoff templates
  const template = program
    .command("template")
    .description("Manage reusable handoff task templates");

  template
    .command("list")
    .description("List available templates (built-in and custom)")
    .option("--json", "machine-readable output")
    .action(async (opts: { json?: boolean }) => {
      const templates = await listTemplates(process.cwd());
      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              custom: templates.custom,
              builtin: templates.builtin,
            },
            null,
            2,
          ),
        );
      } else {
        console.log(formatTemplateList(templates));
      }
    });

  template
    .command("show")
    .description("Show details of a template")
    .argument("<name>", "template name")
    .option("--json", "machine-readable output")
    .action(async (name: string, opts: { json?: boolean }) => {
      const tmpl = await loadTemplate(process.cwd(), name);
      if (!tmpl) {
        console.error(`No template named '${name}'.`);
        process.exitCode = 1;
        return;
      }
      if (opts.json) {
        console.log(JSON.stringify(tmpl, null, 2));
      } else {
        console.log(formatTemplateDetail(tmpl));
      }
    });

  template
    .command("create")
    .description("Create a custom handoff template")
    .argument("<name>", "template name (kebab-case)")
    .requiredOption("--description <text>", "one-line description")
    .option("--agent <agent>", "default receiver agent")
    .option("--task <text>", "task template (use {{placeholders}})")
    .option("--context <text>", "default context")
    .option("--bundle <paths...>", "default project-relative bundle paths")
    .option("--verify <criteria>", "default verification criteria")
    .option("--verify-command <executable>", "verification command")
    .option("--verify-args <json>", "JSON array of args for verify command")
    .option("--verify-timeout <seconds>", "verification timeout in seconds")
    .option("--json", "machine-readable output")
    .action(
      async (
        name: string,
        opts: {
          description: string;
          agent?: string;
          task?: string;
          context?: string;
          bundle?: string[];
          verify?: string;
          verifyCommand?: string;
          verifyArgs?: string;
          verifyTimeout?: string;
          json?: boolean;
        },
      ) => {
        const tmpl: HandoffTemplate = {
          name,
          description: opts.description,
          ...(opts.agent ? { defaultAgent: opts.agent } : {}),
          ...(opts.task ? { taskTemplate: opts.task } : {}),
          ...(opts.context ? { context: opts.context } : {}),
          ...(opts.bundle ? { bundleGlobs: opts.bundle } : {}),
          ...(opts.verify ? { verifyCriteria: opts.verify } : {}),
        };

        if (opts.verifyCommand) {
          let args: string[] = [];
          if (opts.verifyArgs) {
            const parsed = JSON.parse(opts.verifyArgs);
            if (
              !Array.isArray(parsed) ||
              parsed.some((v: unknown) => typeof v !== "string")
            )
              throw new Error("--verify-args must be a JSON array of strings");
            args = parsed;
          }
          const timeoutMs = opts.verifyTimeout
            ? Number(opts.verifyTimeout) * 1000
            : 120_000;
          tmpl.verifyCommand = {
            executable: opts.verifyCommand,
            args,
            timeoutMs,
          };
        }

        await saveTemplate(process.cwd(), tmpl);
        if (opts.json) {
          console.log(JSON.stringify(tmpl, null, 2));
        } else {
          console.log(`\x1b[32m✓\x1b[0m Template '${name}' saved.`);
        }
      },
    );

  template
    .command("delete")
    .description("Delete a custom template")
    .argument("<name>", "template name to delete")
    .action(async (name: string) => {
      const deleted = await deleteTemplate(process.cwd(), name);
      if (deleted) {
        console.log(`Deleted template '${name}'.`);
      } else {
        console.error(`No custom template named '${name}'.`);
        process.exitCode = 1;
      }
    });

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
