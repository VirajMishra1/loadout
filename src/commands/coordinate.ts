import { Command } from "commander";
import {
  emit,
  readAfterCursor,
  snapshot,
  checkOwnershipConflicts,
  getContracts,
  formatSnapshot,
  formatConflicts,
} from "../core/coordination/coordinator.js";

export function registerCoordinate(program: Command): void {
  const coord = program
    .command("coordinate")
    .alias("coord")
    .description(
      "Live coordination between agents — contracts, ownership, updates, and snapshots",
    );

  coord
    .command("snapshot")
    .description("Current coordination state for an agent")
    .argument("<agent>", "agent requesting the snapshot")
    .option("--json", "machine-readable JSON output")
    .action(async (agent: string, options: { json?: boolean }) => {
      const snap = await snapshot(process.cwd(), agent);
      if (options.json) {
        console.log(JSON.stringify(snap, null, 2));
      } else {
        console.log(formatSnapshot(snap));
      }
    });

  coord
    .command("contract")
    .description("Publish or list API contracts")
    .argument("[name]", "contract name to publish or inspect")
    .option("--agent <agent>", "publishing agent", "user")
    .option("--revision <n>", "revision number", parseInt)
    .option("--body <text>", "contract body")
    .option("--format <fmt>", "format hint: typescript, openapi-yaml, sql")
    .option("--json", "machine-readable JSON output")
    .action(
      async (
        name: string | undefined,
        options: {
          agent: string;
          revision?: number;
          body?: string;
          format?: string;
          json?: boolean;
        },
      ) => {
        const cwd = process.cwd();

        // No name: list active contracts
        if (!name) {
          const contracts = await getContracts(cwd);
          if (options.json) {
            console.log(JSON.stringify([...contracts.values()], null, 2));
          } else if (contracts.size === 0) {
            console.log("No active contracts.");
          } else {
            console.log(`Active contracts (${contracts.size}):`);
            for (const c of contracts.values()) {
              console.log(
                `  ${c.name} rev${c.revision} by ${c.publisher}${c.format ? ` (${c.format})` : ""}`,
              );
            }
          }
          return;
        }

        // Name without body: inspect
        if (!options.body) {
          const contracts = await getContracts(cwd);
          const contract = contracts.get(name);
          if (!contract) {
            console.log(`No contract named '${name}'.`);
            return;
          }
          if (options.json) {
            console.log(JSON.stringify(contract, null, 2));
          } else {
            console.log(
              `${contract.name} rev${contract.revision} by ${contract.publisher}`,
            );
            if (contract.format) console.log(`Format: ${contract.format}`);
            console.log("---");
            console.log(contract.body);
          }
          return;
        }

        // Publish
        if (!options.revision) {
          // Auto-increment
          const contracts = await getContracts(cwd);
          const existing = contracts.get(name);
          options.revision = existing ? existing.revision + 1 : 1;
        }

        const event = await emit(cwd, {
          from: options.agent,
          to: "*",
          type: "contract",
          description: `Contract '${name}' rev${options.revision}`,
          payload: {
            name,
            revision: options.revision,
            body: options.body,
            ...(options.format ? { format: options.format } : {}),
          },
        });
        console.log(
          `Published '${name}' rev${options.revision} (seq ${event.seq})`,
        );
      },
    );

  coord
    .command("own")
    .description("Claim file/directory ownership")
    .argument("<agent>", "claiming agent")
    .argument("<paths...>", "paths to claim")
    .option("--shared", "allow shared access (default is exclusive)")
    .option("--json", "machine-readable JSON output")
    .action(
      async (
        agent: string,
        paths: string[],
        options: { shared?: boolean; json?: boolean },
      ) => {
        const cwd = process.cwd();
        const mode = options.shared ? "shared" : "exclusive";

        const conflicts = await checkOwnershipConflicts(
          cwd,
          agent,
          paths,
          mode,
        );
        if (conflicts.length) {
          console.error(formatConflicts(conflicts));
          process.exitCode = 1;
          return;
        }

        const event = await emit(cwd, {
          from: agent,
          to: "*",
          type: "ownership",
          description: `${agent} claims: ${paths.join(", ")}`,
          payload: { paths, mode },
        });

        if (options.json) {
          console.log(JSON.stringify(event, null, 2));
        } else {
          console.log(
            `${agent} now owns (${mode}): ${paths.join(", ")} (seq ${event.seq})`,
          );
        }
      },
    );

  coord
    .command("decide")
    .description("Record a design decision")
    .argument("<agent>", "deciding agent")
    .argument("<title>", "decision title")
    .option("--rationale <text>", "why this decision was made", "")
    .option("--supersedes <id>", "ID of the decision this replaces")
    .option("--json", "machine-readable JSON output")
    .action(
      async (
        agent: string,
        title: string,
        options: {
          rationale: string;
          supersedes?: string;
          json?: boolean;
        },
      ) => {
        const event = await emit(process.cwd(), {
          from: agent,
          to: "*",
          type: "decision",
          description: title,
          payload: {
            title,
            rationale: options.rationale,
            ...(options.supersedes ? { supersedes: options.supersedes } : {}),
          },
        });

        if (options.json) {
          console.log(JSON.stringify(event, null, 2));
        } else {
          console.log(`Decision recorded: ${title} (seq ${event.seq})`);
        }
      },
    );

  coord
    .command("update")
    .description("Publish a progress update")
    .argument("<agent>", "reporting agent")
    .option("--note <text>", "progress note")
    .option("--files <paths...>", "files modified")
    .option("--blockers <items...>", "blockers")
    .option("--next <text>", "what to do next")
    .option("--json", "machine-readable JSON output")
    .action(
      async (
        agent: string,
        options: {
          note?: string;
          files?: string[];
          blockers?: string[];
          next?: string;
          json?: boolean;
        },
      ) => {
        const payload: Record<string, unknown> = {};
        if (options.note) payload.note = options.note;
        if (options.files) payload.files = options.files;
        if (options.blockers) payload.blockers = options.blockers;
        if (options.next) payload.next = options.next;

        const event = await emit(process.cwd(), {
          from: agent,
          to: "*",
          type: "update",
          description: options.note ?? "Progress update",
          payload,
        });

        if (options.json) {
          console.log(JSON.stringify(event, null, 2));
        } else {
          console.log(`Update published (seq ${event.seq})`);
        }
      },
    );

  coord
    .command("subscribe")
    .description("Read events after a cursor")
    .argument("<agent>", "subscribing agent")
    .option("--cursor <n>", "sequence number to read after", parseInt, -1)
    .option("--json", "machine-readable JSON output")
    .action(
      async (agent: string, options: { cursor: number; json?: boolean }) => {
        const { events, highSeq } = await readAfterCursor(
          process.cwd(),
          options.cursor,
        );
        const relevant = events.filter(
          (e) => e.to === agent || e.to === "*" || e.from === agent,
        );

        if (options.json) {
          console.log(JSON.stringify({ events: relevant, highSeq }, null, 2));
        } else {
          if (!relevant.length) {
            console.log(`No events after seq ${options.cursor} for ${agent}.`);
          } else {
            for (const e of relevant) {
              console.log(
                `  seq=${e.seq} [${e.type}] ${e.from}→${e.to}: ${e.description}`,
              );
            }
          }
          console.log(`High watermark: ${highSeq}`);
        }
      },
    );

  coord
    .command("ack")
    .description("Acknowledge events through a sequence number")
    .argument("<agent>", "acknowledging agent")
    .argument("<seq>", "sequence number to acknowledge through", parseInt)
    .option("--note <text>", "what the agent did with these events")
    .action(async (agent: string, seq: number, options: { note?: string }) => {
      const event = await emit(process.cwd(), {
        from: agent,
        to: "*",
        type: "ack",
        description: `Acknowledged through seq ${seq}`,
        payload: {
          eventSeq: seq,
          ...(options.note ? { note: options.note } : {}),
        },
      });
      console.log(
        `${agent} acknowledged through seq ${seq} (ack seq ${event.seq})`,
      );
    });

  // `loadout serve` — start the MCP coordination server
  program
    .command("serve")
    .description(
      "Start the coordination MCP server for live agent collaboration",
    )
    .action(async () => {
      // Dynamic import avoids a hard dependency on @modelcontextprotocol/sdk.
      // The string concatenation prevents tsc from resolving the specifier.
      const modulePath = ["../core/coordination", "mcp-server.js"].join("/");
      try {
        const mod = (await import(modulePath)) as {
          startMcpServer: (root: string) => Promise<void>;
        };
        await mod.startMcpServer(process.cwd());
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("Cannot find module") ||
            error.message.includes("ERR_MODULE_NOT_FOUND"))
        ) {
          console.error(
            "The MCP server requires @modelcontextprotocol/sdk.\n" +
              "Install it with: npm install @modelcontextprotocol/sdk\n" +
              "Then run: loadout serve",
          );
          process.exitCode = 1;
        } else {
          throw error;
        }
      }
    });
}
