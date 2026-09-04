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
import { z } from "zod";

import {
  claimOwnership,
  emit,
  publishContract,
  readAfterCursor,
  snapshot,
  formatSnapshot,
} from "./coordinator.js";

const agentSchema = z.string().trim().min(1).max(128);
const pathSchema = z.string().trim().min(1).max(1_024);
const claimTaskArgumentsSchema = z
  .object({
    agent: agentSchema,
    taskId: z.string().trim().min(1).max(128).optional(),
    description: z.string().trim().min(1).max(8_192).optional(),
    ownPaths: z.array(pathSchema).min(1).max(256).optional(),
  })
  .strict()
  .refine((args) => args.taskId || args.description, {
    message: "description is required when taskId is omitted",
    path: ["description"],
  });
const publishContractArgumentsSchema = z
  .object({
    agent: agentSchema,
    name: z.string().trim().min(1).max(200),
    revision: z.number().int().positive(),
    body: z.string().max(100_000),
    format: z.string().trim().min(1).max(50).optional(),
  })
  .strict();
const publishUpdateArgumentsSchema = z
  .object({
    agent: agentSchema,
    files: z.array(pathSchema).max(256).optional(),
    commands: z
      .array(
        z
          .object({
            command: z.string().max(500),
            exitCode: z.number().int().optional(),
            summary: z.string().max(1_000).optional(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    note: z.string().max(5_000).optional(),
    blockers: z.array(z.string().max(500)).max(10).optional(),
    next: z.string().max(1_000).optional(),
  })
  .strict();
const subscribeArgumentsSchema = z
  .object({
    agent: agentSchema,
    cursor: z.number().int().min(-1),
  })
  .strict();
const ackArgumentsSchema = z
  .object({
    agent: agentSchema,
    eventSeq: z.number().int().nonnegative(),
    note: z.string().max(1_000).optional(),
  })
  .strict();
const snapshotArgumentsSchema = z.object({ agent: agentSchema }).strict();

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
    const rawArguments = request.params.arguments ?? {};

    try {
      switch (name) {
        case "claim_task": {
          const args = claimTaskArgumentsSchema.parse(rawArguments);
          const results: string[] = [];

          if (args.ownPaths) {
            await claimOwnership(projectRoot, {
              agent: args.agent,
              paths: args.ownPaths,
              mode: "exclusive",
            });
            results.push(`Claimed ownership: ${args.ownPaths.join(", ")}`);
          }

          const description = args.description ?? "Claimed existing task";
          const event = await emit(projectRoot, {
            from: args.agent,
            to: "*",
            type: "task",
            description,
            ...(args.taskId ? { resolves: args.taskId } : {}),
          });
          results.push(`Task ${event.id} (seq ${event.seq}): ${description}`);

          return {
            content: [{ type: "text", text: results.join("\n") }],
          };
        }

        case "publish_contract": {
          const args = publishContractArgumentsSchema.parse(rawArguments);
          const event = await publishContract(projectRoot, {
            from: args.agent,
            name: args.name,
            revision: args.revision,
            body: args.body,
            ...(args.format ? { format: args.format } : {}),
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
          const args = publishUpdateArgumentsSchema.parse(rawArguments);
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
            from: args.agent,
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
          const args = subscribeArgumentsSchema.parse(rawArguments);
          const { events, highSeq } = await readAfterCursor(
            projectRoot,
            args.cursor,
          );
          // Filter to events relevant to this agent
          const agent = args.agent;
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
          const args = ackArgumentsSchema.parse(rawArguments);
          const event = await emit(projectRoot, {
            from: args.agent,
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
          const args = snapshotArgumentsSchema.parse(rawArguments);
          const snap = await snapshot(projectRoot, args.agent);
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
