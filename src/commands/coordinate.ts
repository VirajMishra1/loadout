import { Command } from "commander";
import {
  emit,
  readAfterCursor,
  readCoordLog,
  snapshot,
  claimOwnership,
  OwnershipConflictError,
  publishContract,
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
import { compact, logSize } from "../core/coordination/retention.js";
import { startDaemon } from "../core/coordination/daemon.js";
import {
  getDaemonStatus,
  stopDaemon,
  activateKillSwitch,
  deactivateKillSwitch,
  isKillSwitchActive,
} from "../core/coordination/crash-recovery.js";
import {
  previewConflicts,
  formatConflictPreview,
} from "../core/coordination/conflict-preview.js";
import {
  getContractHistory,
  diffLatestContract,
  diffContracts,
  formatContractDelta,
} from "../core/coordination/contract-diff.js";
import { buildReplay, formatReplay } from "../core/coordination/replay.js";

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

        const event = await publishContract(cwd, {
          from: options.agent,
          name,
          body: options.body,
          revision: options.revision,
          format: options.format,
        });
        const revision = (event.payload as { revision: number }).revision;
        console.log(`Published '${name}' rev${revision} (seq ${event.seq})`);
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

        let event;
        try {
          event = await claimOwnership(cwd, { agent, paths, mode });
        } catch (error) {
          if (error instanceof OwnershipConflictError) {
            console.error(formatConflicts(error.conflicts));
            process.exitCode = 1;
            return;
          }
          throw error;
        }

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

  coord
    .command("conflicts")
    .alias("preview")
    .description(
      "Preview file conflicts before writing — shows what other agents changed",
    )
    .argument("<agent>", "agent about to write")
    .argument("<paths...>", "file paths the agent intends to write")
    .option("--json", "machine-readable JSON output")
    .action(
      async (agent: string, paths: string[], options: { json?: boolean }) => {
        const preview = await previewConflicts(process.cwd(), agent, paths);
        if (options.json) {
          console.log(JSON.stringify(preview, null, 2));
        } else {
          console.log(formatConflictPreview(preview));
        }
      },
    );

  coord
    .command("diff")
    .description(
      "Diff contract revisions — shows exactly what changed between versions",
    )
    .argument("<name>", "contract name to diff")
    .option("--from <n>", "from revision (defaults to previous)", parseInt)
    .option("--to <n>", "to revision (defaults to latest)", parseInt)
    .option("--history", "show full revision history")
    .option("--json", "machine-readable JSON output")
    .action(
      async (
        name: string,
        options: {
          from?: number;
          to?: number;
          history?: boolean;
          json?: boolean;
        },
      ) => {
        const cwd = process.cwd();

        if (options.history) {
          const history = await getContractHistory(cwd, name);
          if (history.length === 0) {
            console.log(`No contract named '${name}'.`);
            return;
          }
          if (options.json) {
            console.log(JSON.stringify(history, null, 2));
          } else {
            console.log(
              `\x1b[1m${name}\x1b[0m — ${history.length} revision(s):`,
            );
            for (const rev of history) {
              console.log(
                `  rev${rev.revision} by ${rev.publisher} at ${rev.timestamp} (seq ${rev.seq})`,
              );
            }
          }
          return;
        }

        // Specific revision range or latest diff
        if (options.from && options.to) {
          const history = await getContractHistory(cwd, name);
          const fromRev = history.find((r) => r.revision === options.from);
          const toRev = history.find((r) => r.revision === options.to);
          if (!fromRev || !toRev) {
            console.log(
              `Could not find rev${options.from} or rev${options.to} for '${name}'.`,
            );
            return;
          }
          const delta = diffContracts(fromRev, toRev);
          if (options.json) {
            console.log(JSON.stringify(delta, null, 2));
          } else {
            console.log(formatContractDelta(delta));
          }
          return;
        }

        const delta = await diffLatestContract(cwd, name);
        if (!delta) {
          console.log(
            `Need at least 2 revisions of '${name}' to diff. Use --history to see revisions.`,
          );
          return;
        }
        if (options.json) {
          console.log(JSON.stringify(delta, null, 2));
        } else {
          console.log(formatContractDelta(delta));
        }
      },
    );

  coord
    .command("replay")
    .description("Replay the full coordination timeline as a narrative story")
    .option("--json", "machine-readable JSON output")
    .action(async (options: { json?: boolean }) => {
      const timeline = await buildReplay(process.cwd());
      if (options.json) {
        console.log(JSON.stringify(timeline, null, 2));
      } else {
        console.log(formatReplay(timeline));
      }
    });

  coord
    .command("compact")
    .description("Compact the coordination log — archive old events")
    .option("--max-events <n>", "max events to keep", parseInt, 10000)
    .option("--max-age <days>", "max age in days", parseInt, 30)
    .option("--json", "machine-readable JSON output")
    .action(
      async (options: {
        maxEvents: number;
        maxAge: number;
        json?: boolean;
      }) => {
        const result = await compact(process.cwd(), {
          maxEvents: options.maxEvents,
          maxAgeDays: options.maxAge,
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (!result.compacted) {
          const size = await logSize(process.cwd());
          console.log(
            `Log has ${size.events} events (${(size.bytes / 1024).toFixed(1)} KB) — under threshold, nothing to compact.`,
          );
        } else {
          console.log(
            `Compacted: ${result.before} → ${result.after} events (removed ${result.removed})`,
          );
        }
      },
    );

  // `loadout daemon` — start/stop the coordination daemon
  const daemon = program
    .command("daemon")
    .description("Local coordination daemon with REST API, SSE, and dashboard");

  daemon
    .command("start")
    .description(
      "Start the coordination daemon — HTTP server with live dashboard",
    )
    .option("--port <n>", "port to listen on", parseInt, 4510)
    .action(async (options: { port: number }) => {
      const cwd = process.cwd();
      console.log(`Starting coordination daemon on port ${options.port}...`);
      try {
        const d = await startDaemon(cwd, options.port);
        console.log(
          `\x1b[32m✓\x1b[0m Daemon running at http://127.0.0.1:${d.port}`,
        );
        console.log(`  Dashboard: http://127.0.0.1:${d.port}`);
        console.log(`  API:       http://127.0.0.1:${d.port}/api/status`);
        console.log(`  SSE:       http://127.0.0.1:${d.port}/api/subscribe`);
        console.log(`\nPress Ctrl+C to stop.`);

        process.on("SIGINT", () => {
          console.log("\nStopping daemon...");
          d.close();
          process.exit(0);
        });

        // Keep alive
        await new Promise(() => {});
      } catch (error) {
        console.error(
          `Failed to start daemon: ${error instanceof Error ? error.message : error}`,
        );
        process.exitCode = 1;
      }
    });

  daemon
    .command("stop")
    .description("Stop a running coordination daemon")
    .action(async () => {
      const result = await stopDaemon(process.cwd());
      if (result.stopped) {
        console.log(`\x1b[32m✓\x1b[0m Daemon stopped (pid ${result.pid})`);
      } else if (result.stale) {
        console.log(
          `Cleaned up stale PID file (pid ${result.pid} was not running)`,
        );
      } else {
        console.log("No daemon running.");
      }
    });

  daemon
    .command("status")
    .description("Check if the coordination daemon is running")
    .option("--json", "machine-readable JSON output")
    .action(async (options: { json?: boolean }) => {
      const cwd = process.cwd();
      const status = await getDaemonStatus(cwd);
      const ks = await isKillSwitchActive(cwd);

      if (options.json) {
        console.log(JSON.stringify({ ...status, killSwitch: ks }, null, 2));
        return;
      }

      if (ks.active) {
        console.log(`\x1b[31m⛔ Kill switch active: ${ks.reason}\x1b[0m`);
        console.log(`  Activated: ${ks.activatedAt}`);
        console.log("  Resume with: loadout daemon resume");
        return;
      }

      if (status.running && status.info) {
        console.log(`\x1b[32m✓\x1b[0m Daemon running`);
        console.log(`  PID:     ${status.info.pid}`);
        console.log(`  Port:    ${status.info.port}`);
        console.log(`  Started: ${status.info.startedAt}`);
        console.log(`  Dashboard: http://127.0.0.1:${status.info.port}`);
      } else if (status.stale) {
        console.log("Daemon not running (cleaned up stale PID file)");
      } else {
        console.log("Daemon not running.");
        console.log("Start with: loadout daemon start");
      }
    });

  daemon
    .command("kill")
    .description("Emergency kill switch — halt all coordination immediately")
    .argument("<reason>", "why coordination is being halted")
    .action(async (reason: string) => {
      await activateKillSwitch(process.cwd(), reason);
      console.log("\x1b[31m⛔ Kill switch activated\x1b[0m");
      console.log(`  Reason: ${reason}`);
      console.log("  Daemon stopped, all coordination halted.");
      console.log("  Resume with: loadout daemon resume");
    });

  daemon
    .command("resume")
    .description("Deactivate the kill switch and resume coordination")
    .action(async () => {
      const deactivated = await deactivateKillSwitch(process.cwd());
      if (deactivated) {
        console.log(
          "\x1b[32m✓\x1b[0m Kill switch deactivated. Coordination resumed.",
        );
        console.log("  Start daemon with: loadout daemon start");
      } else {
        console.log("Kill switch was not active.");
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
