/**
 * Coordination replay — play back the full coordination timeline as a story.
 *
 * `loadout coord replay` reads the JSONL log and presents it as a formatted
 * narrative timeline with timestamps, agent actions, and state transitions.
 */

import { readCoordLog, getContracts, getOwnership } from "./coordinator.js";
import type { CoordinationEvent } from "./events.js";

export interface ReplayEntry {
  seq: number;
  timestamp: string;
  agent: string;
  type: string;
  emoji: string;
  headline: string;
  detail?: string;
  relativeTime: string;
}

export interface ReplayTimeline {
  entries: ReplayEntry[];
  agents: string[];
  startTime: string;
  endTime: string;
  duration: string;
  contractCount: number;
  ownershipCount: number;
  totalEvents: number;
}

const TYPE_EMOJI: Record<string, string> = {
  task: "📋",
  handoff: "🤝",
  question: "❓",
  done: "✅",
  status: "📊",
  error: "❌",
  cancel: "🚫",
  contract: "📜",
  ownership: "🔒",
  decision: "⚖️",
  update: "📝",
  ack: "👍",
  discussion: "💬",
};

function eventHeadline(event: CoordinationEvent): string {
  const payload = event.payload as Record<string, unknown> | undefined;

  switch (event.type) {
    case "contract": {
      const name = payload?.name ?? "unknown";
      const rev = payload?.revision ?? "?";
      return `Published contract "${name}" rev${rev}`;
    }
    case "ownership": {
      const paths = (payload?.paths as string[]) ?? [];
      const mode = payload?.mode ?? "exclusive";
      return `Claimed ${mode} ownership of ${paths.length} path(s): ${paths.slice(0, 3).join(", ")}${paths.length > 3 ? "..." : ""}`;
    }
    case "decision": {
      const title = payload?.title ?? event.description;
      return `Decision: ${title}`;
    }
    case "update": {
      const note = payload?.note ?? event.description;
      const files = payload?.files as string[] | undefined;
      const filePart = files ? ` (${files.length} files)` : "";
      return `${note}${filePart}`;
    }
    case "ack": {
      const ackSeq = payload?.eventSeq ?? "?";
      return `Acknowledged through seq ${ackSeq}`;
    }
    case "discussion": {
      const threadId = payload?.threadId ?? "unknown";
      const round = payload?.round ?? "?";
      const kind = payload?.kind ?? "message";
      return `Discussion ${threadId} · round ${round} · ${kind}`;
    }
    case "task":
      return `Task: ${event.description}`;
    case "handoff":
      return `Handoff to ${event.to}: ${event.description}`;
    case "done":
      return `Completed: ${event.description}`;
    case "error":
      return `Error: ${event.description}`;
    default:
      return event.description;
  }
}

function eventDetail(event: CoordinationEvent): string | undefined {
  if (event.type !== "discussion" || !event.payload) return event.context;
  const payload = event.payload as {
    content?: string;
    replyTo?: string;
  };
  if (!payload.content) return event.context;
  return `${payload.content}${payload.replyTo ? ` (reply to ${payload.replyTo})` : ""}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function relativeTimestamp(eventTime: Date, startTime: Date): string {
  const ms = eventTime.getTime() - startTime.getTime();
  return `+${formatDuration(ms)}`;
}

/** Max events to include in a replay to prevent memory issues. */
const MAX_REPLAY_EVENTS = 2000;

/**
 * Build the replay timeline from the coordination log.
 * Bounded to the most recent MAX_REPLAY_EVENTS entries.
 */
export async function buildReplay(
  projectRoot: string,
): Promise<ReplayTimeline> {
  const log = await readCoordLog(projectRoot);
  const contracts = await getContracts(projectRoot);
  const ownership = await getOwnership(projectRoot);

  if (log.events.length === 0) {
    return {
      entries: [],
      agents: [],
      startTime: "",
      endTime: "",
      duration: "0s",
      contractCount: 0,
      ownershipCount: 0,
      totalEvents: 0,
    };
  }

  // Bound to recent events
  const bounded =
    log.events.length > MAX_REPLAY_EVENTS
      ? log.events.slice(-MAX_REPLAY_EVENTS)
      : log.events;

  const startTime = new Date(bounded[0].timestamp);
  const endTime = new Date(bounded[bounded.length - 1].timestamp);
  const agents = [...new Set(bounded.map((e) => e.from))];

  const entries: ReplayEntry[] = bounded.map((event) => ({
    seq: event.seq,
    timestamp: event.timestamp,
    agent: event.from,
    type: event.type,
    emoji: TYPE_EMOJI[event.type] ?? "•",
    headline: eventHeadline(event),
    detail: eventDetail(event),
    relativeTime: relativeTimestamp(new Date(event.timestamp), startTime),
  }));

  return {
    entries,
    agents,
    startTime: bounded[0].timestamp,
    endTime: bounded[bounded.length - 1].timestamp,
    duration: formatDuration(endTime.getTime() - startTime.getTime()),
    contractCount: contracts.size,
    ownershipCount: ownership.size,
    totalEvents: log.events.length,
  };
}

/**
 * Format replay timeline for terminal display.
 */
export function formatReplay(timeline: ReplayTimeline): string {
  if (timeline.entries.length === 0) {
    return "No coordination events to replay.";
  }

  const lines: string[] = [];

  // Header
  lines.push("\x1b[1m╔══════════════════════════════════════════╗\x1b[0m");
  lines.push("\x1b[1m║       COORDINATION REPLAY                ║\x1b[0m");
  lines.push("\x1b[1m╚══════════════════════════════════════════╝\x1b[0m");
  lines.push("");
  lines.push(
    `  Agents: ${timeline.agents.map((a) => `\x1b[36m${a}\x1b[0m`).join(", ")}`,
  );
  lines.push(`  Duration: ${timeline.duration}`);
  lines.push(
    `  Events: ${timeline.totalEvents} · Contracts: ${timeline.contractCount} · Ownership claims: ${timeline.ownershipCount}`,
  );
  lines.push("");
  lines.push("\x1b[90m─────────────────────────────────────────────\x1b[0m");
  lines.push("");

  // Assign colors to agents
  const agentColors = ["\x1b[36m", "\x1b[33m", "\x1b[35m", "\x1b[34m"];
  const colorMap = new Map<string, string>();
  timeline.agents.forEach((a, i) => {
    colorMap.set(a, agentColors[i % agentColors.length]);
  });

  // Timeline entries
  let lastAgent = "";
  for (const entry of timeline.entries) {
    const color = colorMap.get(entry.agent) ?? "\x1b[37m";

    // Agent separator
    if (entry.agent !== lastAgent) {
      if (lastAgent) lines.push("");
      lastAgent = entry.agent;
    }

    const timeStr = `\x1b[90m${entry.relativeTime.padStart(8)}\x1b[0m`;
    const agentStr = `${color}${entry.agent.padEnd(12)}\x1b[0m`;

    lines.push(`  ${timeStr} ${entry.emoji} ${agentStr} ${entry.headline}`);

    if (entry.detail) {
      lines.push(`           \x1b[90m└─ ${entry.detail}\x1b[0m`);
    }
  }

  lines.push("");
  lines.push("\x1b[90m─────────────────────────────────────────────\x1b[0m");
  lines.push(
    `  \x1b[32m✓\x1b[0m Replay complete · ${timeline.totalEvents} events`,
  );

  return lines.join("\n");
}
