/**
 * MCP server for live coordination between AI coding agents.
 *
 * Exposes the coordination tools over stdio MCP so both Claude Code and Codex
 * can connect to the same project coordinator. Phase 1: backed by the
 * append-only JSONL log, no daemon required.
 *
 * Start with: loadout serve
 * Connect from Claude Code: add to .claude/settings.local.json mcp servers
 * Connect from Codex: add to .agents/mcp.json
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  emit,
  readAfterCursor,
  snapshot,
  checkOwnershipConflicts,
  formatSnapshot,
  formatConflicts,
} from "./coordinator.js";

const TOOL_DEFINITIONS = [
  {
    name: "claim_task",
    description:
      "Reserve a task and optionally declare file ownership. Returns the task event and any ownership conflicts.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent: {
          type: "string",
          description: "Agent claiming the task (e.g. 'claude-code', 'codex')",
        },
        taskId: {
          type: "string",
          description:
            "ID of the pending task to claim, or omit to create a new task",
        },
        description: {
          type: "string",
          description: "Task description (required when creating a new task)",
        },
        ownPaths: {
          type: "array",
          items: { type: "string" },
          description:
            "File/directory paths to claim exclusive ownership of during this task",
        },
      },
      required: ["agent"],
    },
  },
  {
    name: "publish_contract",
    description:
      "Publish a versioned API contract (endpoint, schema, types). Other agents are notified of the new revision.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent: {
          type: "string",
          description: "Publishing agent",
        },
        name: {
          type: "string",
          description: "Stable contract name (e.g. 'auth-api', 'user-schema')",
        },
        revision: {
          type: "number",
          description: "Monotonically increasing revision number",
        },
        body: {
          type: "string",
          description:
            "Contract body — TypeScript types, OpenAPI fragment, SQL, etc.",
        },
        format: {
          type: "string",
          description:
            "Format hint: 'typescript', 'openapi-yaml', 'sql', 'json-schema'",
        },
      },
      required: ["agent", "name", "revision", "body"],
    },
  },
  {
    name: "publish_update",
    description:
      "Report progress: files touched, commands run, blockers, next action.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent: {
          type: "string",
          description: "Reporting agent",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Files modified since last update",
        },
        commands: {
          type: "array",
          items: {
            type: "object",
            properties: {
              command: { type: "string" },
              exitCode: { type: "number" },
              summary: { type: "string" },
            },
            required: ["command"],
          },
          description: "Commands run and their outcomes",
        },
        note: { type: "string", description: "Free-form progress note" },
        blockers: {
          type: "array",
          items: { type: "string" },
          description: "Blockers preventing further progress",
        },
        next: {
          type: "string",
          description: "What this agent plans to do next",
        },
      },
      required: ["agent"],
    },
  },
  {
    name: "subscribe",
    description:
      "Read events after a cursor (sequence number). Returns new events and the current high watermark for reconnection.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent: {
          type: "string",
          description: "Subscribing agent (filters to relevant events)",
        },
        cursor: {
          type: "number",
          description:
            "Sequence number to read after (-1 for all). Events with seq > cursor are returned.",
        },
      },
      required: ["agent", "cursor"],
    },
  },
  {
    name: "ack",
    description:
      "Acknowledge that an agent has incorporated events up to a sequence number.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent: {
          type: "string",
          description: "Acknowledging agent",
        },
        eventSeq: {
          type: "number",
          description: "Sequence number of the event being acknowledged",
        },
        note: {
          type: "string",
          description: "Optional note about what the agent did with this event",
        },
      },
      required: ["agent", "eventSeq"],
    },
  },
  {
    name: "snapshot",
    description:
      "Get a bounded summary of current coordination state for a reconnecting agent: pending tasks, active contracts, file ownership, unacked events.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent: {
          type: "string",
          description: "Agent requesting the snapshot",
        },
      },
      required: ["agent"],
    },
  },
] as const;

export async function startMcpServer(projectRoot: string): Promise<void> {
  const server = new Server(
    { name: "loadout-coordinator", version: "0.9.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...TOOL_DEFINITIONS],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case "claim_task": {
          const agent = args.agent as string;
          const results: string[] = [];

          // Check ownership conflicts if paths requested
          if (args.ownPaths) {
            const paths = args.ownPaths as string[];
            const conflicts = await checkOwnershipConflicts(
              projectRoot,
              agent,
              paths,
              "exclusive",
            );
            if (conflicts.length) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Cannot claim task: ${formatConflicts(conflicts)}`,
                  },
                ],
                isError: true,
              };
            }

            // Record ownership
            await emit(projectRoot, {
              from: agent,
              to: "*",
              type: "ownership",
              description: `${agent} claims: ${paths.join(", ")}`,
              payload: { paths, mode: "exclusive" },
            });
            results.push(`Claimed ownership: ${paths.join(", ")}`);
          }

          // Create or claim task
          const description =
            (args.description as string) ?? "Claimed existing task";
          const event = await emit(projectRoot, {
            from: agent,
            to: "*",
            type: "task",
            description,
            ...(args.taskId ? { resolves: args.taskId as string } : {}),
          });
          results.push(`Task ${event.id} (seq ${event.seq}): ${description}`);

          return {
            content: [{ type: "text", text: results.join("\n") }],
          };
        }

        case "publish_contract": {
          const event = await emit(projectRoot, {
            from: args.agent as string,
            to: "*",
            type: "contract",
            description: `Contract '${args.name}' rev${args.revision}`,
            payload: {
              name: args.name,
              revision: args.revision,
              body: args.body,
              ...(args.format ? { format: args.format } : {}),
            },
          });
          return {
            content: [
              {
                type: "text",
                text: `Published contract '${args.name}' rev${args.revision} (seq ${event.seq})`,
              },
            ],
          };
        }

        case "publish_update": {
          const payload: Record<string, unknown> = {};
          if (args.files) payload.files = args.files;
          if (args.commands) payload.commands = args.commands;
          if (args.note) payload.note = args.note;
          if (args.blockers) payload.blockers = args.blockers;
          if (args.next) payload.next = args.next;

          const parts: string[] = [];
          if (args.note) parts.push(args.note as string);
          if (args.files)
            parts.push(`${(args.files as string[]).length} files`);
          if (args.blockers)
            parts.push(`${(args.blockers as string[]).length} blocker(s)`);

          const event = await emit(projectRoot, {
            from: args.agent as string,
            to: "*",
            type: "update",
            description: parts.join("; ") || "Progress update",
            payload,
          });
          return {
            content: [
              {
                type: "text",
                text: `Update published (seq ${event.seq})`,
              },
            ],
          };
        }

        case "subscribe": {
          const { events, highSeq } = await readAfterCursor(
            projectRoot,
            args.cursor as number,
          );
          // Filter to events relevant to this agent
          const agent = args.agent as string;
          const relevant = events.filter(
            (e) => e.to === agent || e.to === "*" || e.from === agent,
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { events: relevant, highSeq, count: relevant.length },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "ack": {
          const event = await emit(projectRoot, {
            from: args.agent as string,
            to: "*",
            type: "ack",
            description: `Acknowledged through seq ${args.eventSeq}`,
            payload: {
              eventSeq: args.eventSeq,
              ...(args.note ? { note: args.note } : {}),
            },
          });
          return {
            content: [
              {
                type: "text",
                text: `Acknowledged through seq ${args.eventSeq} (ack seq ${event.seq})`,
              },
            ],
          };
        }

        case "snapshot": {
          const snap = await snapshot(projectRoot, args.agent as string);
          return {
            content: [
              { type: "text", text: formatSnapshot(snap) },
              {
                type: "text",
                text: `\n---\nJSON:\n${JSON.stringify(snap, null, 2)}`,
              },
            ],
          };
        }

        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
