/**
 * Live file watcher for coordination events.
 *
 * Watches `.handoff/coordination.jsonl` and calls back when new events appear.
 * This is the "live" part of Phase 2 — no daemon, no SQLite, just fs.watch on
 * the append-only log.
 */

import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { readCoordLog } from "./coordinator.js";
import type { CoordinationEvent } from "./events.js";

const COORD_DIR = ".handoff";
const COORD_LOG = "coordination.jsonl";

export interface WatcherOptions {
  /** Agent to filter events for. Events addressed to this agent, broadcast, or from this agent are included. */
  agent?: string;
  /** Only emit events with seq > this value. Defaults to current highSeq (only new events). */
  cursor?: number;
  /** Called when new events are detected. */
  onEvents: (events: CoordinationEvent[], highSeq: number) => void;
  /** Called on watcher errors. */
  onError?: (error: Error) => void;
}

export interface CoordinationWatcher {
  /** Stop watching. */
  stop: () => void;
  /** Current high watermark. */
  readonly cursor: number;
}

export async function watchCoordination(
  projectRoot: string,
  options: WatcherOptions,
): Promise<CoordinationWatcher> {
  // Get initial state
  const initial = await readCoordLog(projectRoot);
  let cursor = options.cursor ?? initial.highSeq;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  async function checkForUpdates(): Promise<void> {
    if (stopped) return;
    try {
      const log = await readCoordLog(projectRoot);
      if (log.highSeq <= cursor) return;

      let events = log.events.filter((e) => e.seq > cursor);

      // Filter for agent if specified
      if (options.agent) {
        const agent = options.agent;
        events = events.filter(
          (e) => e.to === agent || e.to === "*" || e.from === agent,
        );
      }

      cursor = log.highSeq;

      if (events.length > 0) {
        options.onEvents(events, log.highSeq);
      }
    } catch (error) {
      options.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  // Debounced check — multiple rapid writes only trigger one read
  function scheduleCheck(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      checkForUpdates();
    }, 100);
  }

  // Watch the directory (more reliable than watching a single file across platforms)
  let fsWatcher: FSWatcher;
  try {
    fsWatcher = watch(
      join(projectRoot, COORD_DIR),
      { persistent: true },
      (eventType, filename) => {
        if (filename === COORD_LOG || filename === null) {
          scheduleCheck();
        }
      },
    );
  } catch {
    // Directory might not exist yet — watch the project root for its creation
    fsWatcher = watch(
      projectRoot,
      { persistent: true },
      (eventType, filename) => {
        if (filename === COORD_DIR) {
          scheduleCheck();
        }
      },
    );
  }

  fsWatcher.on("error", (error) => {
    options.onError?.(error);
  });

  return {
    stop() {
      stopped = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      fsWatcher.close();
    },
    get cursor() {
      return cursor;
    },
  };
}

/**
 * Format a live event for terminal display.
 */
export function formatLiveEvent(event: CoordinationEvent): string {
  const time = event.timestamp.slice(11, 19);
  const typeColors: Record<string, string> = {
    contract: "\x1b[36m", // cyan
    ownership: "\x1b[33m", // yellow
    decision: "\x1b[35m", // magenta
    update: "\x1b[32m", // green
    ack: "\x1b[90m", // gray
    task: "\x1b[34m", // blue
    done: "\x1b[32m", // green
    error: "\x1b[31m", // red
  };
  const color = typeColors[event.type] ?? "\x1b[0m";
  const reset = "\x1b[0m";
  const bold = "\x1b[1m";

  const parts = [
    `${bold}${time}${reset}`,
    `${color}[${event.type}]${reset}`,
    `${bold}${event.from}${reset}`,
    event.to !== "*" ? `→ ${event.to}` : "",
    event.description,
  ].filter(Boolean);

  const lines = [parts.join(" ")];

  // Show payload highlights for interesting event types
  if (event.type === "contract" && event.payload) {
    const p = event.payload as {
      name: string;
      revision: number;
      format?: string;
    };
    lines.push(
      `  📋 ${p.name} rev${p.revision}${p.format ? ` (${p.format})` : ""}`,
    );
  }
  if (event.type === "ownership" && event.payload) {
    const p = event.payload as { paths: string[]; mode: string };
    lines.push(`  🔒 ${p.mode}: ${p.paths.join(", ")}`);
  }
  if (event.type === "update" && event.payload) {
    const p = event.payload as {
      note?: string;
      blockers?: string[];
      next?: string;
    };
    if (p.blockers?.length)
      lines.push(`  🚫 Blockers: ${p.blockers.join(", ")}`);
    if (p.next) lines.push(`  ⏭️  Next: ${p.next}`);
  }
  if (event.type === "decision" && event.payload) {
    const p = event.payload as { title: string; rationale: string };
    lines.push(`  📌 ${p.rationale.slice(0, 120)}`);
  }

  return lines.join("\n");
}
