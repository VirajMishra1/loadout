#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { HIDDEN_FROM_FIRST_SCREEN } from "./core/reporting/cli-guide.js";
import { registerCompletionCommands } from "./core/reporting/completion.js";
import { recoverPendingTransactions } from "./core/install/transaction.js";
import {
  LOADOUT_VERSION,
  printBeginnerGuide,
  runWizard,
} from "./commands/support.js";
import { registerSetup } from "./commands/setup.js";
import { registerSharing } from "./commands/sharing.js";
import { registerAgents } from "./commands/agents.js";
import { registerHealth } from "./commands/health.js";
import { registerInventory } from "./commands/inventory.js";
import { registerCatalog } from "./commands/catalog.js";
import { registerMcp } from "./commands/mcp.js";
import { registerLifecycle } from "./commands/lifecycle.js";
import { registerCoordinate } from "./commands/coordinate.js";

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

registerSetup(program);
registerSharing(program);
registerAgents(program);
registerHealth(program);
registerInventory(program);
registerCatalog(program);
registerMcp(program);
registerLifecycle(program);
registerCoordinate(program);

registerCompletionCommands(
  program.commands.map((command) => ({
    name: command.name(),
    subcommands: command.commands.map((sub) => sub.name()),
  })),
);

for (const command of program.commands)
  // Commander supports `hidden` when a command is created. These commands are
  // registered by separate feature blocks, so use the same runtime flag here
  // rather than `Option#hideHelp`, which does not exist on Command objects.
  if (HIDDEN_FROM_FIRST_SCREEN.has(command.name()))
    (command as unknown as { _hidden: boolean })._hidden = true;

program.addHelpText(
  "after",
  "\nStart here: `loadout guide` shows the safe everyday path. `loadout advanced` lists the retained maintainer and integration commands.\n",
);

program.argument("[unknown-command]");
program.action(async (unknownCommand?: string) => {
  if (unknownCommand)
    throw new Error(
      `Unknown command '${unknownCommand}'. Run 'loadout --help' to list available commands.`,
    );
  // A real terminal gets the interactive front door; piped/CI callers get the
  // read-only guide and never mutate, keeping bare invocation scriptable.
  if (process.stdin.isTTY && process.stdout.isTTY) {
    await runWizard();
    return;
  }
  printBeginnerGuide();
});

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
