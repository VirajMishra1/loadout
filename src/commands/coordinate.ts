import { Command } from "commander";
import {
  emit,
  readAfterCursor,
  readCoordLog,
  snapshot,
  checkOwnershipConflicts,
  getContracts,
  getOwnership,
  getAckState,
  formatSnapshot,
  formatConflicts,
} from "../core/coordination/coordinator.js";
import {
  watchCoordination,
  formatLiveEvent,
} from "../core/coordination/watcher.js";

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

  coord
    .command("watch")
    .description(
      "Watch for coordination events in real time — live terminal feed",
    )
    .argument("[agent]", "filter events for this agent")
    .option("--cursor <n>", "start from this sequence number", parseInt)
    .action(async (agent: string | undefined, options: { cursor?: number }) => {
      const cwd = process.cwd();
      console.log(
        `\x1b[1mWatching coordination events${agent ? ` for ${agent}` : ""}...\x1b[0m`,
      );
      console.log("Press Ctrl+C to stop.\n");

      // Show recent events first
      const log = await readCoordLog(cwd);
      const startCursor = options.cursor ?? Math.max(log.highSeq - 10, -1);
      const recent = log.events.filter((e) => e.seq > startCursor);
      const filtered = agent
        ? recent.filter(
            (e) => e.to === agent || e.to === "*" || e.from === agent,
          )
        : recent;

      if (filtered.length) {
        console.log("\x1b[90m── recent ──\x1b[0m");
        for (const e of filtered) {
          console.log(formatLiveEvent(e));
        }
        console.log("\x1b[90m── live ──\x1b[0m\n");
      }

      const watcher = await watchCoordination(cwd, {
        agent,
        cursor: log.highSeq,
        onEvents(events) {
          for (const e of events) {
            console.log(formatLiveEvent(e));
          }
        },
        onError(error) {
          console.error(`Watch error: ${error.message}`);
        },
      });

      // Keep alive until Ctrl+C
      process.on("SIGINT", () => {
        watcher.stop();
        console.log("\nStopped watching.");
        process.exit(0);
      });

      // Prevent Node from exiting
      await new Promise(() => {});
    });

  coord
    .command("status")
    .description("Show live coordination status — ownership, contracts, acks")
    .option("--json", "machine-readable JSON output")
    .action(async (options: { json?: boolean }) => {
      const cwd = process.cwd();
      const log = await readCoordLog(cwd);
      const contracts = await getContracts(cwd);
      const ownership = await getOwnership(cwd);
      const ackState = await getAckState(cwd);

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              events: log.events.length,
              highSeq: log.highSeq,
              corrupt: log.corrupt.length,
              contracts: [...contracts.values()],
              ownership: [...ownership.values()],
              ackCursors: Object.fromEntries(ackState.cursors),
              unacked: ackState.unacked.length,
            },
            null,
            2,
          ),
        );
        return;
      }

      if (log.events.length === 0) {
        console.log("No coordination events yet.");
        console.log("Start with: loadout coord own <agent> <paths...>");
        return;
      }

      console.log(
        `\x1b[1mCoordination status\x1b[0m (${log.events.length} events, seq ${log.highSeq})`,
      );

      if (contracts.size) {
        console.log(`\n\x1b[36mContracts (${contracts.size}):\x1b[0m`);
        for (const c of contracts.values()) {
          console.log(
            `  ${c.name} rev${c.revision} by ${c.publisher}${c.format ? ` (${c.format})` : ""}`,
          );
        }
      }

      if (ownership.size) {
        console.log(
          `\n\x1b[33mFile ownership (${ownership.size} paths):\x1b[0m`,
        );
        const byAgent = new Map<string, { paths: string[]; mode: string }>();
        for (const claim of ownership.values()) {
          const existing = byAgent.get(claim.agent);
          if (existing) {
            existing.paths.push(...claim.paths);
          } else {
            byAgent.set(claim.agent, {
              paths: [...claim.paths],
              mode: claim.mode,
            });
          }
        }
        for (const [agent, info] of byAgent) {
          console.log(`  ${agent} (${info.mode}): ${info.paths.join(", ")}`);
        }
      }

      if (ackState.cursors.size) {
        console.log(`\n\x1b[32mAck cursors:\x1b[0m`);
        for (const [agent, cursor] of ackState.cursors) {
          const behind = log.highSeq - cursor;
          console.log(
            `  ${agent}: seq ${cursor}${behind > 0 ? ` (${behind} behind)` : " (up to date)"}`,
          );
        }
      }

      if (ackState.unacked.length) {
        console.log(
          `\n\x1b[31m${ackState.unacked.length} unacknowledged event(s)\x1b[0m`,
        );
      }

      if (log.corrupt.length) {
        console.log(
          `\n\x1b[31mWarning: ${log.corrupt.length} corrupt line(s)\x1b[0m`,
        );
      }
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
