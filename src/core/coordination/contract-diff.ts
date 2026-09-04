/**
 * Contract diffing — when a contract revision bumps, auto-generate
 * a structured delta showing exactly what changed between revisions.
 */

import { readCoordLog } from "./coordinator.js";

export interface ContractRevision {
  name: string;
  revision: number;
  body: string;
  format?: string;
  publisher: string;
  eventId: string;
  seq: number;
  timestamp: string;
}

export interface ContractDelta {
  name: string;
  fromRevision: number;
  toRevision: number;
  fromPublisher: string;
  toPublisher: string;
  added: string[];
  removed: string[];
  changed: LineDiff[];
  summary: string;
}

export interface LineDiff {
  line: number;
  from: string;
  to: string;
}

/**
 * Get all revisions of a named contract from the log.
 */
export async function getContractHistory(
  projectRoot: string,
  name: string,
): Promise<ContractRevision[]> {
  const log = await readCoordLog(projectRoot);
  const revisions: ContractRevision[] = [];

  for (const event of log.events) {
    if (event.type !== "contract" || !event.payload) continue;
    const payload = event.payload as {
      name: string;
      revision: number;
      body: string;
      format?: string;
    };
    if (payload.name !== name) continue;

    revisions.push({
      name: payload.name,
      revision: payload.revision,
      body: payload.body,
      format: payload.format,
      publisher: event.from,
      eventId: event.id,
      seq: event.seq,
      timestamp: event.timestamp,
    });
  }

  return revisions.sort((a, b) => a.revision - b.revision);
}

/**
 * Diff two contract revisions and produce a structured delta.
 */
export function diffContracts(
  from: ContractRevision,
  to: ContractRevision,
): ContractDelta {
  const fromLines = from.body.split("\n");
  const toLines = to.body.split("\n");

  const fromSet = new Set(fromLines);
  const toSet = new Set(toLines);

  const added = toLines.filter((l) => !fromSet.has(l) && l.trim());
  const removed = fromLines.filter((l) => !toSet.has(l) && l.trim());

  // Line-by-line comparison for changed lines at same positions
  const changed: LineDiff[] = [];
  const maxLines = Math.min(fromLines.length, toLines.length);
  for (let i = 0; i < maxLines; i++) {
    if (fromLines[i] !== toLines[i]) {
      changed.push({ line: i + 1, from: fromLines[i], to: toLines[i] });
    }
  }

  // Summary
  const parts: string[] = [];
  if (added.length) parts.push(`${added.length} added`);
  if (removed.length) parts.push(`${removed.length} removed`);
  if (changed.length) parts.push(`${changed.length} changed`);
  const summary = parts.length
    ? `${parts.join(", ")} line(s)`
    : "No differences";

  return {
    name: from.name,
    fromRevision: from.revision,
    toRevision: to.revision,
    fromPublisher: from.publisher,
    toPublisher: to.publisher,
    added,
    removed,
    changed,
    summary,
  };
}

/**
 * Diff the latest two revisions of a named contract.
 */
export async function diffLatestContract(
  projectRoot: string,
  name: string,
): Promise<ContractDelta | null> {
  const history = await getContractHistory(projectRoot, name);
  if (history.length < 2) return null;
  return diffContracts(
    history[history.length - 2],
    history[history.length - 1],
  );
}

/**
 * Format a contract delta for terminal display.
 */
export function formatContractDelta(delta: ContractDelta): string {
  const lines: string[] = [];

  lines.push(
    `\x1b[1m${delta.name}\x1b[0m rev${delta.fromRevision} → rev${delta.toRevision}`,
  );
  lines.push(
    `  by ${delta.fromPublisher} → ${delta.toPublisher} · ${delta.summary}`,
  );
  lines.push("");

  if (delta.removed.length) {
    for (const r of delta.removed.slice(0, 30)) {
      lines.push(`\x1b[31m- ${r}\x1b[0m`);
    }
    if (delta.removed.length > 30) {
      lines.push(`  ... ${delta.removed.length - 30} more removed`);
    }
  }

  if (delta.added.length) {
    for (const a of delta.added.slice(0, 30)) {
      lines.push(`\x1b[32m+ ${a}\x1b[0m`);
    }
    if (delta.added.length > 30) {
      lines.push(`  ... ${delta.added.length - 30} more added`);
    }
  }

  return lines.join("\n");
}
