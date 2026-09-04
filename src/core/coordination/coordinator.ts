/**
 * Live collaboration coordinator — Phase 1 (structured async).
 *
 * Extends the JSONL handoff log with typed events, monotonic sequence numbers,
 * cursor-based reads, acknowledgement tracking, file ownership, and conflict
 * detection. No daemon — reads and writes go through the same append-only log.
 */

import { chmod, readFile, writeFile, mkdir } from "node:fs/promises";
import { isAbsolute, join, posix } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type CoordinationEvent,
  type CoordinationEventType,
  coordinationEventSchema,
  validatePayload,
} from "./events.js";
import { withCoordinationLock } from "./lock.js";
import { redactCoordinationInput } from "./redaction.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const COORD_DIR = ".handoff";
const COORD_LOG = "coordination.jsonl";
const KILL_SWITCH_FILE = "KILL_SWITCH";

function coordDir(projectRoot: string): string {
  return join(projectRoot, COORD_DIR);
}

function coordLogPath(projectRoot: string): string {
  return join(coordDir(projectRoot), COORD_LOG);
}

export class CoordinationHaltedError extends Error {
  constructor(reason?: string) {
    super(`Coordination kill switch is active${reason ? `: ${reason}` : ""}`);
    this.name = "CoordinationHaltedError";
  }
}

export class CoordinationConflictError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CoordinationConflictError";
  }
}

export async function assertCoordinationEnabled(
  projectRoot: string,
): Promise<void> {
  try {
    const raw = await readFile(
      join(coordDir(projectRoot), KILL_SWITCH_FILE),
      "utf8",
    );
    let reason: string | undefined;
    try {
      const parsed = JSON.parse(raw) as { reason?: unknown };
      if (typeof parsed.reason === "string") reason = parsed.reason;
    } catch {
      // The file itself is authoritative even if its explanatory JSON is damaged.
    }
    throw new CoordinationHaltedError(reason);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface CorruptCoordLine {
  line: number;
  reason: string;
}

export interface CoordLog {
  events: CoordinationEvent[];
  corrupt: CorruptCoordLine[];
  /** Highest sequence number seen, or -1 if empty. */
  highSeq: number;
}

export async function readCoordLog(projectRoot: string): Promise<CoordLog> {
  let content: string;
  try {
    content = await readFile(coordLogPath(projectRoot), "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return { events: [], corrupt: [], highSeq: -1 };
    }
    throw error;
  }

  const events: CoordinationEvent[] = [];
  const corrupt: CorruptCoordLine[] = [];
  let highSeq = -1;

  content.split("\n").forEach((raw, index) => {
    if (!raw.trim()) return;
    try {
      const parsed = coordinationEventSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        const reason = parsed.error.issues
          .map((i) => `${i.path.join(".") || "event"}: ${i.message}`)
          .join("; ");
        throw new Error(reason);
      }
      events.push(parsed.data);
      if (parsed.data.seq > highSeq) highSeq = parsed.data.seq;
    } catch (error) {
      corrupt.push({
        line: index + 1,
        reason: error instanceof Error ? error.message : "unparseable",
      });
    }
  });

  return { events, corrupt, highSeq };
}

/** Read events after a cursor (sequence number). */
export async function readAfterCursor(
  projectRoot: string,
  cursor: number,
): Promise<{ events: CoordinationEvent[]; highSeq: number }> {
  const log = await readCoordLog(projectRoot);
  return {
    events: log.events.filter((e) => e.seq > cursor),
    highSeq: log.highSeq,
  };
}

/** Read events for a specific agent (addressed to them, or broadcast). */
export async function readForAgent(
  projectRoot: string,
  agent: string,
  cursor = -1,
): Promise<{ events: CoordinationEvent[]; highSeq: number }> {
  const { events, highSeq } = await readAfterCursor(projectRoot, cursor);
  return {
    events: events.filter(
      (e) => e.to === agent || e.to === "*" || e.from === agent,
    ),
    highSeq,
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export interface EmitOptions {
  from: string;
  to: string;
  type: CoordinationEventType;
  description: string;
  context?: string;
  resolves?: string;
  payload?: Record<string, unknown>;
}

const MAX_PAYLOAD_BYTES = 128 * 1_024;

function normalizeClaimPath(value: string): string {
  const portable = value.trim().replaceAll("\\", "/");
  if (isAbsolute(portable) || /^[A-Za-z]:\//.test(portable)) {
    throw new Error(`Ownership paths must be project-relative: ${value}`);
  }
  const normalized = posix.normalize(portable).replace(/^\.\//, "");
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Ownership paths cannot escape the project: ${value}`);
  }
  return normalized.replace(/\/$/, "") || ".";
}

function normalizedOptions(options: EmitOptions): EmitOptions {
  const redacted = redactCoordinationInput(options);
  const payloadResult = validatePayload(redacted.type, redacted.payload);
  if (!payloadResult.success) {
    throw new Error(
      `Invalid payload for '${redacted.type}': ${payloadResult.error}`,
    );
  }

  let payload = payloadResult.data as Record<string, unknown> | undefined;
  if (redacted.type === "ownership" && payload) {
    payload = {
      ...payload,
      paths: (payload.paths as string[]).map(normalizeClaimPath),
    };
  }

  if (payload !== undefined) {
    let serialized: string;
    try {
      serialized = JSON.stringify(payload);
    } catch {
      throw new Error("Invalid coordination payload: payload must be JSON");
    }
    if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) {
      throw new Error(
        `Invalid coordination payload: exceeds ${MAX_PAYLOAD_BYTES} bytes`,
      );
    }
  }

  return { ...redacted, ...(payload === undefined ? {} : { payload }) };
}

async function appendLocked(
  projectRoot: string,
  options: EmitOptions,
  existingLog?: CoordLog,
): Promise<CoordinationEvent> {
  await assertCoordinationEnabled(projectRoot);
  const checked = normalizedOptions(options);
  const log = existingLog ?? (await readCoordLog(projectRoot));

  if (checked.type === "ack") {
    const eventSeq = (checked.payload as { eventSeq: number }).eventSeq;
    if (eventSeq > log.highSeq) {
      throw new CoordinationConflictError(
        "acknowledgement_conflict",
        `Cannot acknowledge seq ${eventSeq}; current watermark is ${log.highSeq}`,
      );
    }
  }

  if (checked.type === "contract") {
    const candidate = checked.payload as { name: string; revision: number };
    const currentRevision = log.events.reduce((highest, event) => {
      if (event.type !== "contract" || !event.payload) return highest;
      const contract = event.payload as { name: string; revision: number };
      return contract.name === candidate.name
        ? Math.max(highest, contract.revision)
        : highest;
    }, 0);
    if (candidate.revision <= currentRevision) {
      throw new CoordinationConflictError(
        "contract_revision_conflict",
        `Contract '${candidate.name}' revision ${candidate.revision} is stale; current revision is ${currentRevision}`,
      );
    }
  }

  const event: CoordinationEvent = {
    id: randomUUID().slice(0, 8),
    seq: log.highSeq + 1,
    type: checked.type,
    from: checked.from,
    to: checked.to,
    description: checked.description,
    ...(checked.context ? { context: checked.context } : {}),
    ...(checked.resolves ? { resolves: checked.resolves } : {}),
    ...(checked.payload ? { payload: checked.payload } : {}),
    timestamp: new Date().toISOString(),
  };

  const parsed = coordinationEventSchema.safeParse(event);
  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "event"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid coordination event: ${reason}`);
  }

  await writeFile(
    coordLogPath(projectRoot),
    `${JSON.stringify(parsed.data)}\n`,
    {
      flag: "a",
      mode: 0o600,
    },
  );
  await chmod(coordLogPath(projectRoot), 0o600);
  return parsed.data;
}

export async function emit(
  projectRoot: string,
  options: EmitOptions,
): Promise<CoordinationEvent> {
  const dir = coordDir(projectRoot);
  await mkdir(dir, { recursive: true });
  return withCoordinationLock(dir, () => appendLocked(projectRoot, options));
}

// ---------------------------------------------------------------------------
// Ownership tracking
// ---------------------------------------------------------------------------

export interface OwnershipClaim {
  agent: string;
  paths: string[];
  mode: "exclusive" | "shared";
  eventId: string;
  seq: number;
}

/** Get the current ownership map from the log. Later claims override earlier. */
export async function getOwnership(
  projectRoot: string,
): Promise<Map<string, OwnershipClaim>> {
  const log = await readCoordLog(projectRoot);
  return ownershipFromEvents(log.events);
}

export interface OwnershipConflict {
  path: string;
  currentOwner: string;
  currentMode: "exclusive" | "shared";
  requestedBy: string;
  requestedMode: "exclusive" | "shared";
}

function pathsOverlap(left: string, right: string): boolean {
  return (
    left === right ||
    left === "." ||
    right === "." ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

function ownershipFromEvents(
  events: CoordinationEvent[],
): Map<string, OwnershipClaim> {
  const ownership = new Map<string, OwnershipClaim>();
  for (const event of events) {
    if (event.type !== "ownership" || !event.payload) continue;
    const payload = event.payload as { paths: string[]; mode: string };
    const paths = payload.paths.map(normalizeClaimPath);
    for (const path of paths) {
      if (payload.mode === "release") {
        const existing = ownership.get(path);
        if (existing?.agent === event.from) ownership.delete(path);
        continue;
      }
      ownership.set(path, {
        agent: event.from,
        paths,
        mode: payload.mode as "exclusive" | "shared",
        eventId: event.id,
        seq: event.seq,
      });
    }
  }
  return ownership;
}

/** Check if claiming paths would conflict with existing ownership. */
export async function checkOwnershipConflicts(
  projectRoot: string,
  agent: string,
  paths: string[],
  mode: "exclusive" | "shared",
): Promise<OwnershipConflict[]> {
  const ownership = await getOwnership(projectRoot);
  const conflicts: OwnershipConflict[] = [];

  for (const requestedPath of paths.map(normalizeClaimPath)) {
    for (const [ownedPath, existing] of ownership) {
      if (!pathsOverlap(requestedPath, ownedPath)) continue;
      if (existing.agent === agent) continue;
      if (existing.mode === "shared" && mode === "shared") continue;
      conflicts.push({
        path: requestedPath,
        currentOwner: existing.agent,
        currentMode: existing.mode,
        requestedBy: agent,
        requestedMode: mode,
      });
    }
  }

  return conflicts;
}

export class OwnershipConflictError extends CoordinationConflictError {
  constructor(readonly conflicts: OwnershipConflict[]) {
    super("ownership_conflict", formatConflicts(conflicts));
    this.name = "OwnershipConflictError";
  }
}

export interface ClaimOwnershipOptions {
  agent: string;
  paths: string[];
  mode: "exclusive" | "shared";
  reason?: string;
}

export interface ReleaseOwnershipOptions {
  agent: string;
  paths: string[];
}

/** Check and persist ownership as one atomic mutation. */
export async function claimOwnership(
  projectRoot: string,
  options: ClaimOwnershipOptions,
): Promise<CoordinationEvent> {
  const dir = coordDir(projectRoot);
  await mkdir(dir, { recursive: true });
  return withCoordinationLock(dir, async () => {
    const log = await readCoordLog(projectRoot);
    const ownership = ownershipFromEvents(log.events);
    const conflicts: OwnershipConflict[] = [];
    for (const requestedPath of options.paths.map(normalizeClaimPath)) {
      for (const [ownedPath, existing] of ownership) {
        if (!pathsOverlap(requestedPath, ownedPath)) continue;
        if (existing.agent === options.agent) continue;
        if (existing.mode === "shared" && options.mode === "shared") continue;
        conflicts.push({
          path: requestedPath,
          currentOwner: existing.agent,
          currentMode: existing.mode,
          requestedBy: options.agent,
          requestedMode: options.mode,
        });
      }
    }
    if (conflicts.length > 0) throw new OwnershipConflictError(conflicts);

    return appendLocked(
      projectRoot,
      {
        from: options.agent,
        to: "*",
        type: "ownership",
        description: `${options.agent} claims: ${options.paths.join(", ")}`,
        payload: {
          paths: options.paths,
          mode: options.mode,
          ...(options.reason ? { reason: options.reason } : {}),
        },
      },
      log,
    );
  });
}

/** Release exact paths currently owned by the requesting agent. */
export async function releaseOwnership(
  projectRoot: string,
  options: ReleaseOwnershipOptions,
): Promise<CoordinationEvent> {
  const dir = coordDir(projectRoot);
  await mkdir(dir, { recursive: true });
  return withCoordinationLock(dir, async () => {
    const log = await readCoordLog(projectRoot);
    const ownership = ownershipFromEvents(log.events);
    const paths = options.paths.map(normalizeClaimPath);
    for (const path of paths) {
      const existing = ownership.get(path);
      if (existing && existing.agent !== options.agent) {
        throw new CoordinationConflictError(
          "ownership_release_conflict",
          `Cannot release '${path}'; it is owned by ${existing.agent}`,
        );
      }
    }

    return appendLocked(
      projectRoot,
      {
        from: options.agent,
        to: "*",
        type: "ownership",
        description: `${options.agent} releases: ${paths.join(", ")}`,
        payload: { paths, mode: "release" },
      },
      log,
    );
  });
}

// ---------------------------------------------------------------------------
// Contract tracking
// ---------------------------------------------------------------------------

export interface ActiveContract {
  name: string;
  revision: number;
  body: string;
  format?: string;
  publisher: string;
  eventId: string;
  seq: number;
}

function contractsFromEvents(
  events: CoordinationEvent[],
): Map<string, ActiveContract> {
  const contracts = new Map<string, ActiveContract>();
  for (const event of events) {
    if (event.type !== "contract" || !event.payload) continue;
    const payload = event.payload as {
      name: string;
      revision: number;
      body: string;
      format?: string;
    };
    const existing = contracts.get(payload.name);
    if (!existing || payload.revision > existing.revision) {
      contracts.set(payload.name, {
        name: payload.name,
        revision: payload.revision,
        body: payload.body,
        format: payload.format,
        publisher: event.from,
        eventId: event.id,
        seq: event.seq,
      });
    }
  }
  return contracts;
}

export interface PublishContractOptions {
  from: string;
  name: string;
  body: string;
  format?: string;
  revision?: number;
}

/** Allocate and append a contract revision as one atomic mutation. */
export async function publishContract(
  projectRoot: string,
  options: PublishContractOptions,
): Promise<CoordinationEvent> {
  const dir = coordDir(projectRoot);
  await mkdir(dir, { recursive: true });
  return withCoordinationLock(dir, async () => {
    const log = await readCoordLog(projectRoot);
    const currentRevision = log.events.reduce((highest, event) => {
      if (event.type !== "contract" || !event.payload) return highest;
      const contract = event.payload as { name: string; revision: number };
      return contract.name === options.name
        ? Math.max(highest, contract.revision)
        : highest;
    }, 0);
    const revision = options.revision ?? currentRevision + 1;
    return appendLocked(
      projectRoot,
      {
        from: options.from,
        to: "*",
        type: "contract",
        description: `Contract '${options.name}' rev${revision}`,
        payload: {
          name: options.name,
          revision,
          body: options.body,
          ...(options.format ? { format: options.format } : {}),
        },
      },
      log,
    );
  });
}

/** Get the latest revision of each named contract. */
export async function getContracts(
  projectRoot: string,
): Promise<Map<string, ActiveContract>> {
  const log = await readCoordLog(projectRoot);
  return contractsFromEvents(log.events);
}

// ---------------------------------------------------------------------------
// Acknowledgement tracking
// ---------------------------------------------------------------------------

export interface AckState {
  /** Map of agent → highest acknowledged sequence number. */
  cursors: Map<string, number>;
  /** Events not yet acknowledged by any agent other than the sender. */
  unacked: CoordinationEvent[];
}

function ackStateFromEvents(events: CoordinationEvent[]): AckState {
  const cursors = new Map<string, number>();

  for (const event of events) {
    if (event.type !== "ack" || !event.payload) continue;
    const payload = event.payload as { eventSeq: number };
    const current = cursors.get(event.from) ?? -1;
    if (payload.eventSeq > current) cursors.set(event.from, payload.eventSeq);
  }

  const agents = new Set(events.map((event) => event.from));
  const unacked = events.filter((event) => {
    if (event.type === "ack") return false;
    for (const agent of agents) {
      if (agent === event.from) continue;
      const cursor = cursors.get(agent) ?? -1;
      if (cursor >= event.seq) return false;
    }
    return true;
  });
  return { cursors, unacked };
}

export async function getAckState(projectRoot: string): Promise<AckState> {
  const log = await readCoordLog(projectRoot);
  return ackStateFromEvents(log.events);
}

// ---------------------------------------------------------------------------
// Snapshot — bounded current state for reconnecting agents
// ---------------------------------------------------------------------------

export interface CoordinationSnapshot {
  highSeq: number;
  pendingTasks: CoordinationEvent[];
  activeContracts: ActiveContract[];
  ownership: OwnershipClaim[];
  recentDecisions: CoordinationEvent[];
  unackedForAgent: CoordinationEvent[];
  /** Counts omitted from each bounded collection. */
  truncated: {
    pendingTasks: number;
    activeContracts: number;
    ownership: number;
    recentDecisions: number;
    unackedForAgent: number;
  };
}

const SNAPSHOT_LIMITS = {
  pendingTasks: 50,
  activeContracts: 50,
  ownership: 500,
  recentDecisions: 10,
  unackedForAgent: 100,
} as const;

function boundedTail<T>(values: T[], limit: number): T[] {
  return values.slice(Math.max(0, values.length - limit));
}

export async function snapshot(
  projectRoot: string,
  agent: string,
): Promise<CoordinationSnapshot> {
  const log = await readCoordLog(projectRoot);
  const contracts = [...contractsFromEvents(log.events).values()].sort(
    (left, right) => left.seq - right.seq,
  );
  const ownership = [...ownershipFromEvents(log.events).values()].sort(
    (left, right) => left.seq - right.seq,
  );
  const ackState = ackStateFromEvents(log.events);

  // Pending tasks (not yet resolved)
  const terminalTypes = new Set(["done", "error", "cancel"]);
  const resolvedIds = new Set(
    log.events
      .filter((e) => terminalTypes.has(e.type))
      .flatMap((e) => {
        if (e.resolves) return [e.resolves];
        const match = e.context?.match(/Resolves (\w+)/);
        return match ? [match[1]] : [];
      }),
  );
  const allPendingTasks = log.events.filter(
    (e) => e.type === "task" && !resolvedIds.has(e.id),
  );

  // Recent decisions (last 10)
  const decisions = log.events.filter((e) => e.type === "decision");
  const recentDecisions = boundedTail(
    decisions,
    SNAPSHOT_LIMITS.recentDecisions,
  );

  // Events this agent hasn't acked
  const agentCursor = ackState.cursors.get(agent) ?? -1;
  const allUnackedForAgent = log.events.filter(
    (e) => e.seq > agentCursor && e.from !== agent && e.type !== "ack",
  );

  const pendingTasks = boundedTail(
    allPendingTasks,
    SNAPSHOT_LIMITS.pendingTasks,
  );
  const activeContracts = boundedTail(
    contracts,
    SNAPSHOT_LIMITS.activeContracts,
  );
  const boundedOwnership = boundedTail(ownership, SNAPSHOT_LIMITS.ownership);
  const unackedForAgent = boundedTail(
    allUnackedForAgent,
    SNAPSHOT_LIMITS.unackedForAgent,
  );

  return {
    highSeq: log.highSeq,
    pendingTasks,
    activeContracts,
    ownership: boundedOwnership,
    recentDecisions,
    unackedForAgent,
    truncated: {
      pendingTasks: allPendingTasks.length - pendingTasks.length,
      activeContracts: contracts.length - activeContracts.length,
      ownership: ownership.length - boundedOwnership.length,
      recentDecisions: decisions.length - recentDecisions.length,
      unackedForAgent: allUnackedForAgent.length - unackedForAgent.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatSnapshot(snap: CoordinationSnapshot): string {
  const lines: string[] = [`Coordination snapshot (seq ${snap.highSeq})`, ""];

  if (snap.pendingTasks.length) {
    lines.push(`Pending tasks (${snap.pendingTasks.length}):`);
    for (const t of snap.pendingTasks) {
      lines.push(`  [${t.id}] ${t.from} → ${t.to}: ${t.description}`);
    }
    lines.push("");
  }

  if (snap.activeContracts.length) {
    lines.push(`Active contracts (${snap.activeContracts.length}):`);
    for (const c of snap.activeContracts) {
      lines.push(
        `  ${c.name} rev${c.revision} by ${c.publisher}${c.format ? ` (${c.format})` : ""}`,
      );
    }
    lines.push("");
  }

  if (snap.ownership.length) {
    lines.push(`File ownership (${snap.ownership.length} paths):`);
    const byAgent = new Map<string, string[]>();
    for (const claim of snap.ownership) {
      const existing = byAgent.get(claim.agent) ?? [];
      existing.push(...claim.paths);
      byAgent.set(claim.agent, existing);
    }
    for (const [agent, paths] of byAgent) {
      lines.push(`  ${agent}: ${paths.join(", ")}`);
    }
    lines.push("");
  }

  if (snap.unackedForAgent.length) {
    lines.push(`Unacknowledged events (${snap.unackedForAgent.length}):`);
    for (const e of snap.unackedForAgent.slice(-20)) {
      lines.push(`  seq=${e.seq} [${e.type}] ${e.from}: ${e.description}`);
    }
    if (snap.unackedForAgent.length > 20) {
      lines.push(`  ... and ${snap.unackedForAgent.length - 20} more`);
    }
    lines.push("");
  }

  if (snap.recentDecisions.length) {
    lines.push(`Recent decisions (${snap.recentDecisions.length}):`);
    for (const d of snap.recentDecisions) {
      const title = (d.payload as { title?: string })?.title ?? d.description;
      lines.push(`  [${d.id}] ${d.from}: ${title}`);
    }
    lines.push("");
  }

  if (
    !snap.pendingTasks.length &&
    !snap.activeContracts.length &&
    !snap.ownership.length &&
    !snap.unackedForAgent.length
  ) {
    lines.push("No active coordination state.");
  }

  const omitted = Object.values(snap.truncated).reduce(
    (total, count) => total + count,
    0,
  );
  if (omitted > 0) {
    lines.push(
      "",
      `Snapshot is bounded; ${omitted} older item(s) omitted. Use subscribe/replay for history.`,
    );
  }

  return lines.join("\n");
}

export function formatConflicts(conflicts: OwnershipConflict[]): string {
  if (!conflicts.length) return "No ownership conflicts.";
  const lines = [`Ownership conflicts (${conflicts.length}):`];
  for (const c of conflicts) {
    lines.push(
      `  ${c.path}: owned by ${c.currentOwner} (${c.currentMode}), requested by ${c.requestedBy} (${c.requestedMode})`,
    );
  }
  return lines.join("\n");
}
