/**
 * Retention and compaction for the coordination log.
 *
 * The JSONL audit log is never deleted. Compaction rewrites the working log
 * with a summary event followed by recent events, keeping the active set
 * bounded.
 */

import { readFile, writeFile, rename, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertCoordinationEnabled, readCoordLog } from "./coordinator.js";
import { withCoordinationLock } from "./lock.js";

const COORD_DIR = ".handoff";
const COORD_LOG = "coordination.jsonl";

export interface RetentionConfig {
  /** Maximum events to keep in working log. Default 10000. */
  maxEvents: number;
  /** Maximum age in days. Events older than this are compacted. Default 30. */
  maxAgeDays: number;
}

export const DEFAULT_RETENTION: RetentionConfig = {
  maxEvents: 10000,
  maxAgeDays: 30,
};

export interface CompactionResult {
  /** Events before compaction. */
  before: number;
  /** Events after compaction. */
  after: number;
  /** Events removed. */
  removed: number;
  /** Whether compaction actually ran (skipped if under threshold). */
  compacted: boolean;
}

export async function compact(
  projectRoot: string,
  config: RetentionConfig = DEFAULT_RETENTION,
): Promise<CompactionResult> {
  const dir = join(projectRoot, COORD_DIR);
  await mkdir(dir, { recursive: true });

  return withCoordinationLock(dir, async () => {
    await assertCoordinationEnabled(projectRoot);
    const log = await readCoordLog(projectRoot);
    if (!Number.isSafeInteger(config.maxEvents) || config.maxEvents < 1) {
      throw new Error("maxEvents must be a positive integer");
    }
    if (!Number.isFinite(config.maxAgeDays) || config.maxAgeDays < 0) {
      throw new Error("maxAgeDays must be a non-negative number");
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.maxAgeDays);
    const cutoffIso = cutoffDate.toISOString();
    const firstFresh = log.events.findIndex(
      (event) => event.timestamp >= cutoffIso,
    );
    const ageStart = firstFresh === -1 ? log.events.length : firstFresh;
    const countStart = Math.max(0, log.events.length - config.maxEvents);
    const keepStart = Math.max(ageStart, countStart);
    const remove = log.events.slice(0, keepStart);
    const finalRetained = log.events.slice(keepStart);

    if (remove.length === 0) {
      return {
        before: log.events.length,
        after: log.events.length,
        removed: 0,
        compacted: false,
      };
    }

    // Build summary of what was compacted
    const agents = new Set<string>();
    const types = new Map<string, number>();
    for (const e of remove) {
      agents.add(e.from);
      types.set(e.type, (types.get(e.type) ?? 0) + 1);
    }

    const summaryPayload = {
      compactedCount: remove.length,
      compactedRange: {
        from: remove[0]!.seq,
        to: remove[remove.length - 1]!.seq,
      },
      agents: [...agents],
      typeCounts: Object.fromEntries(types),
      compactedAt: new Date().toISOString(),
    };

    const logPath = join(projectRoot, COORD_DIR, COORD_LOG);

    // Archival is the durability boundary: never rewrite if it fails.
    const archivePath = `${logPath}.${Date.now()}.archive`;
    const raw = await readFile(logPath, "utf-8");
    await writeFile(archivePath, raw, {
      encoding: "utf-8",
      flag: "wx",
      mode: 0o600,
    });

    // Write compacted log: summary event + retained events
    const summaryLine = JSON.stringify({
      id: `compaction-${Date.now()}`,
      seq: remove[remove.length - 1]!.seq,
      type: "status",
      from: "loadout",
      to: "*",
      description: `Compacted ${remove.length} events (seq ${summaryPayload.compactedRange.from}–${summaryPayload.compactedRange.to})`,
      timestamp: new Date().toISOString(),
      payload: summaryPayload,
    });

    const lines = [
      summaryLine,
      ...finalRetained.map((e) => JSON.stringify(e)),
    ].join("\n");

    // Atomic write: write to temp, rename over
    const tmpPath = `${logPath}.tmp`;
    await writeFile(tmpPath, lines + "\n", {
      encoding: "utf-8",
      mode: 0o600,
    });
    await rename(tmpPath, logPath);

    // Log corrupt lines if any were found
    if (log.corrupt.length > 0) {
      const corruptPath = `${logPath}.${Date.now()}.corrupt`;
      const corruptData = log.corrupt.map((c) => JSON.stringify(c)).join("\n");
      await writeFile(corruptPath, corruptData + "\n", {
        encoding: "utf-8",
        mode: 0o600,
      }).catch(() => {});
    }

    return {
      before: log.events.length,
      after: finalRetained.length + 1, // +1 for summary
      removed: remove.length,
      compacted: true,
    };
  });
}

export async function logSize(
  projectRoot: string,
): Promise<{ events: number; bytes: number }> {
  const logPath = join(projectRoot, COORD_DIR, COORD_LOG);
  try {
    const s = await stat(logPath);
    const log = await readCoordLog(projectRoot);
    return { events: log.events.length, bytes: s.size };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return { events: 0, bytes: 0 };
    }
    throw error;
  }
}
