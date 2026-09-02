import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { writeFileAtomically } from "../install/atomic-file.js";

export type HandoffMessageType =
  "task" | "handoff" | "question" | "done" | "status" | "error" | "cancel";

export interface HandoffMessage {
  id: string;
  type: HandoffMessageType;
  from: string;
  to: string;
  description: string;
  context?: string;
  timestamp: string;
  /** The task this message closes. Older logs encode it in `context`. */
  resolves?: string;
}

/** A line the log holds that could not be parsed. */
export interface CorruptLine {
  line: number;
  reason: string;
}

export interface HandoffState {
  initialized: boolean;
  directory: string;
  messages: HandoffMessage[];
  pending: HandoffMessage[];
  done: HandoffMessage[];
  corrupt: CorruptLine[];
}

/** Message types that settle a task, so it stops appearing in an inbox. */
const TERMINAL_TYPES = new Set<HandoffMessageType>(["done", "error", "cancel"]);

const HANDOFF_DIR = ".handoff";
const MESSAGES_FILE = "messages.jsonl";
const PROTOCOL_FILE = "PROTOCOL.md";

function handoffDir(projectRoot: string): string {
  return join(projectRoot, HANDOFF_DIR);
}

function messagesPath(projectRoot: string): string {
  return join(handoffDir(projectRoot), MESSAGES_FILE);
}

export async function isHandoffInitialized(
  projectRoot: string,
): Promise<boolean> {
  try {
    await readFile(join(handoffDir(projectRoot), PROTOCOL_FILE), "utf8");
    return true;
  } catch {
    return false;
  }
}

export async function initHandoff(projectRoot: string): Promise<string> {
  const dir = handoffDir(projectRoot);
  await mkdir(dir, { recursive: true });

  const protocol = [
    "# Handoff",
    "",
    "A shared task log so two AI coding agents can pass work between them.",
    "Created by `loadout handoff`. Append-only JSONL; no server, no daemon.",
    "",
    "## Using it",
    "",
    "```",
    "loadout handoff codex 'write unit tests for auth' --context 'see src/auth.ts'",
    "loadout handoff codex          # what is waiting for codex",
    "loadout handoff                # everything pending, both directions",
    "loadout handoff --done <id>    # finished",
    "```",
    "",
    "Sending sets this directory up on first use and adds a short block to",
    "CLAUDE.md and AGENTS.md telling each agent to check its inbox at session",
    "start. Only the text between the loadout:handoff markers is managed.",
    "",
    "## Files",
    "",
    "- `messages.jsonl` — the log, one JSON object per line",
    "- `PROTOCOL.md` — this file",
    "",
    "Commit both if you want the log shared across machines.",
    "",
  ].join("\n");

  await writeFileAtomically(join(dir, PROTOCOL_FILE), protocol);

  // Create empty messages file if it doesn't exist
  try {
    await readFile(messagesPath(projectRoot));
  } catch {
    await writeFile(messagesPath(projectRoot), "", "utf8");
  }

  return dir;
}

export async function sendHandoff(
  projectRoot: string,
  to: string,
  description: string,
  options: {
    from?: string;
    type?: HandoffMessageType;
    context?: string;
    resolves?: string;
  } = {},
): Promise<HandoffMessage> {
  if (!(await isHandoffInitialized(projectRoot))) {
    throw new Error(
      "Handoff is not set up here. Send a task and it will create itself: loadout handoff <agent> '<task>'",
    );
  }

  const message: HandoffMessage = {
    id: randomUUID().slice(0, 8),
    type: options.type ?? "task",
    from: options.from ?? "user",
    to,
    description,
    ...(options.context ? { context: options.context } : {}),
    ...(options.resolves ? { resolves: options.resolves } : {}),
    timestamp: new Date().toISOString(),
  };

  const path = messagesPath(projectRoot);
  const line = JSON.stringify(message) + "\n";
  await writeFile(path, line, { flag: "a" });

  return message;
}

export async function markDone(
  projectRoot: string,
  messageId: string,
): Promise<HandoffMessage> {
  const messages = await readMessages(projectRoot);
  const original = messages.find((m) => m.id === messageId);
  if (!original) throw new Error(`Message '${messageId}' not found`);
  if (original.type === "done")
    throw new Error(`Message '${messageId}' is already done`);

  return sendHandoff(
    projectRoot,
    original.from,
    `Completed: ${original.description}`,
    {
      from: original.to,
      type: "done",
      resolves: messageId,
    },
  );
}

/**
 * Parse the log one line at a time. A single truncated write previously made
 * the whole inbox look empty, which is the worst possible failure for a queue:
 * silent and total. Bad lines are collected and reported instead.
 */
export async function readMessagesDetailed(
  projectRoot: string,
): Promise<{ messages: HandoffMessage[]; corrupt: CorruptLine[] }> {
  if (!(await isHandoffInitialized(projectRoot)))
    return { messages: [], corrupt: [] };

  let content: string;
  try {
    content = await readFile(messagesPath(projectRoot), "utf8");
  } catch {
    return { messages: [], corrupt: [] };
  }

  const messages: HandoffMessage[] = [];
  const corrupt: CorruptLine[] = [];
  content.split("\n").forEach((raw, index) => {
    if (!raw.trim()) return;
    try {
      const parsed = JSON.parse(raw) as HandoffMessage;
      if (!parsed || typeof parsed.id !== "string" || !parsed.type)
        throw new Error("missing id or type");
      messages.push(parsed);
    } catch (error) {
      corrupt.push({
        line: index + 1,
        reason: error instanceof Error ? error.message : "unparseable",
      });
    }
  });
  return { messages, corrupt };
}

export async function readMessages(
  projectRoot: string,
): Promise<HandoffMessage[]> {
  return (await readMessagesDetailed(projectRoot)).messages;
}

export async function getHandoffState(
  projectRoot: string,
): Promise<HandoffState> {
  const initialized = await isHandoffInitialized(projectRoot);
  const { messages, corrupt } = initialized
    ? await readMessagesDetailed(projectRoot)
    : { messages: [], corrupt: [] };

  // A task is settled by completion, failure, or withdrawal. Treating only
  // `done` as terminal left failed tasks pending forever.
  const resolvedIds = new Set(
    messages
      .filter((m) => TERMINAL_TYPES.has(m.type))
      .flatMap((m) => {
        if (m.resolves) return [m.resolves];
        // Logs written before `resolves` existed encode it in the context.
        const match = m.context?.match(/Resolves (\w+)/);
        return match ? [match[1]] : [];
      }),
  );

  const pending = messages.filter(
    (m) => m.type === "task" && !resolvedIds.has(m.id),
  );
  const done = messages.filter(
    (m) => m.type === "task" && resolvedIds.has(m.id),
  );

  return {
    initialized,
    directory: handoffDir(projectRoot),
    messages,
    pending,
    done,
    corrupt,
  };
}

// ---------------------------------------------------------------------------
// Consumption — the half that makes a handoff more than an outbox
// ---------------------------------------------------------------------------

/** Pending tasks addressed to one agent, oldest first. */
export async function readInbox(
  projectRoot: string,
  agent: string,
): Promise<HandoffMessage[]> {
  const state = await getHandoffState(projectRoot);
  return state.pending.filter((m) => m.to === agent);
}

/**
 * Render an agent's inbox as instructions the agent itself can act on. This is
 * what `loadout handoff <agent>` prints, and what the generated pickup block
 * tells each agent to run, so the message log is consumed rather than merely
 * written.
 */
export function formatInbox(agent: string, messages: HandoffMessage[]): string {
  if (!messages.length) return `No pending handoff tasks for ${agent}.`;
  const lines = [
    `${messages.length} pending handoff task(s) for ${agent}:`,
    "",
  ];
  for (const m of messages) {
    lines.push(
      `[${m.id}] from ${m.from} (${m.timestamp.slice(0, 16).replace("T", " ")})`,
    );
    lines.push(`  ${m.description}`);
    if (m.context) lines.push(`  context: ${m.context}`);
    lines.push(`  when finished: loadout handoff --done ${m.id}`);
    lines.push("");
  }
  lines.push(
    "Work these in order. Mark each done as you complete it so the sender sees progress.",
  );
  return lines.join("\n");
}

const PICKUP_START = "<!-- loadout:handoff:start -->";
const PICKUP_END = "<!-- loadout:handoff:end -->";

/** The managed instruction block written into an agent's context file. */
export function pickupBlock(agent: string): string {
  return [
    PICKUP_START,
    "",
    "## Handoff inbox",
    "",
    `At the start of a session, and whenever you finish a task, run:`,
    "",
    "```bash",
    `loadout handoff ${agent}`,
    "```",
    "",
    "If it lists pending tasks, work them in order and run the `loadout handoff --done`",
    "command it prints for each one. If it reports none, continue as normal.",
    "",
    PICKUP_END,
  ].join("\n");
}

export interface PickupPlan {
  path: string;
  agent: string;
  exists: boolean;
  /** True when a managed block is already present and would be replaced. */
  replacing: boolean;
  /** True when the present block still names retired commands. */
  stale: boolean;
  content: string;
}

/** Agent context files, relative to the project root. */
const AGENT_CONTEXT_FILES: Record<string, string> = {
  "claude-code": "CLAUDE.md",
  codex: "AGENTS.md",
};

/** True when this agent has a context file Loadout knows how to write. */
export function isPickupTarget(agent: string): boolean {
  return agent in AGENT_CONTEXT_FILES;
}

export function agentContextFile(agent: string): string {
  const file = AGENT_CONTEXT_FILES[agent];
  if (!file)
    throw new Error(
      `No known context file for agent '${agent}'. Supported: ${Object.keys(AGENT_CONTEXT_FILES).join(", ")}`,
    );
  return file;
}

/**
 * Compute the new content for an agent's context file with the pickup block
 * added or refreshed. Existing content is preserved; only the managed block
 * between the markers is replaced.
 */
export async function planPickup(
  projectRoot: string,
  agent: string,
): Promise<PickupPlan> {
  const file = agentContextFile(agent);
  const path = join(projectRoot, file);
  const block = pickupBlock(agent);

  let existing = "";
  let exists = false;
  try {
    existing = await readFile(path, "utf8");
    exists = true;
  } catch {
    // A missing context file is created with just the managed block.
  }

  const start = existing.indexOf(PICKUP_START);
  const end = existing.indexOf(PICKUP_END);
  const replacing = start !== -1 && end !== -1 && end > start;

  // A block written by an older release still tells the agent to run commands
  // that no longer exist, so a rewrite is a migration, not a no-op.
  const stale =
    replacing &&
    /loadout handoff (?:inbox|send|init|status|done)\b/.test(
      existing.slice(start, end),
    );

  const content = replacing
    ? existing.slice(0, start) + block + existing.slice(end + PICKUP_END.length)
    : exists
      ? `${existing.replace(/\s*$/, "")}\n\n${block}\n`
      : `${block}\n`;

  return { path, agent, exists, replacing, stale, content };
}

export async function applyPickup(plan: PickupPlan): Promise<void> {
  await writeFileAtomically(plan.path, plan.content);
}

export function formatPickupPlan(plans: PickupPlan[]): string {
  const lines = ["Handoff pickup instructions:", ""];
  for (const plan of plans) {
    const action = plan.stale
      ? "migrate outdated block in"
      : plan.replacing
        ? "refresh managed block in"
        : plan.exists
          ? "append managed block to"
          : "create";
    lines.push(`  ${action} ${plan.path}`);
  }
  lines.push(
    "",
    "This teaches each agent to check its handoff inbox at session start.",
    "Only the block between the loadout:handoff markers is managed; the rest of",
    "each file is preserved.",
  );
  return lines.join("\n");
}

export function formatHandoffStatus(state: HandoffState): string {
  if (!state.initialized)
    return "No handoff log here yet. Send a task and it creates itself: loadout handoff <agent> '<task>'";
  if (state.messages.length === 0)
    return "No handoff messages yet. Send one with `loadout handoff <agent> '<task>'`.";

  const lines: string[] = [];

  if (state.pending.length) {
    lines.push(`Pending (${state.pending.length}):`);
    for (const m of state.pending) {
      lines.push(`  ${m.id}  ${m.from} → ${m.to}  ${m.description}`);
    }
  }

  if (state.done.length) {
    if (lines.length) lines.push("");
    lines.push(`Done (${state.done.length}):`);
    for (const m of state.done) {
      lines.push(`  ${m.id}  ${m.from} → ${m.to}  ${m.description}`);
    }
  }

  if (state.corrupt.length) {
    if (lines.length) lines.push("");
    lines.push(
      `Warning: ${state.corrupt.length} unreadable line(s) in the log — ${state.corrupt
        .map((entry) => `line ${entry.line}`)
        .join(", ")}.`,
      "The other messages are shown; repair or delete those lines to clear this.",
    );
  }

  const other = state.messages.filter(
    (m) => m.type !== "task" && m.type !== "done",
  );
  if (other.length) {
    if (lines.length) lines.push("");
    lines.push(`Other messages: ${other.length}`);
  }

  return lines.join("\n");
}
