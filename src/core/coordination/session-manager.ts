/**
 * Session manager for coordinated agent sessions.
 *
 * Tracks active sessions across providers, handles reconnection with
 * snapshot replay, and routes coordination events as follow-up turns.
 */

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AgentAdapter, AgentSession } from "./adapters/types.js";
import { formatEventsForInjection } from "./adapters/types.js";
import { snapshot, readAfterCursor } from "./coordinator.js";
import { watchCoordination, type CoordinationWatcher } from "./watcher.js";
import type { CoordinationEvent } from "./events.js";
import { isKillSwitchActive } from "./crash-recovery.js";
import {
  categorizeEvents,
  DEFAULT_POLICY,
  loadPolicy,
  type InterruptPolicy,
} from "./interrupt-policy.js";

const COORD_DIR = ".handoff";
const SESSIONS_FILE = "sessions.json";

export interface SessionManagerOptions {
  projectRoot: string;
  adapters: AgentAdapter[];
  /** Auto-submit events to sessions that support follow-up turns. Default true. */
  autoSubmit?: boolean;
  /** Callback when events are queued or can't be submitted. */
  onPendingEvents?: (
    session: AgentSession,
    events: CoordinationEvent[],
  ) => void;
  /** Observe non-persisted provider output after a routed turn completes. */
  onTurnCompleted?: (session: AgentSession, response?: string) => void;
  /** Safety cap for event-triggered turns in one bridge process. Default 20. */
  maxAutoTurnsPerSession?: number;
}

interface SessionStore {
  sessions: AgentSession[];
  updatedAt: string;
}

const agentSessionSchema = z
  .object({
    sessionId: z.string().trim().min(1).max(1_024),
    agent: z.string().trim().min(1).max(128),
    provider: z.string().trim().min(1).max(128),
    active: z.boolean(),
    busy: z.boolean(),
    cursor: z.number().int().min(-1),
    startedAt: z.iso.datetime({ offset: true }),
    cwd: z.string().min(1),
  })
  .strict();

const sessionStoreSchema = z
  .object({
    sessions: z.array(agentSessionSchema).max(100),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export class SessionManager {
  private sessions = new Map<string, AgentSession>();
  private adapters = new Map<string, AgentAdapter>();
  private pendingEvents = new Map<string, CoordinationEvent[]>();
  private watcher: CoordinationWatcher | null = null;
  private options: SessionManagerOptions;
  private policy: InterruptPolicy = DEFAULT_POLICY;
  private autoTurnCounts = new Map<string, number>();

  constructor(options: SessionManagerOptions) {
    if (
      options.maxAutoTurnsPerSession !== undefined &&
      (!Number.isSafeInteger(options.maxAutoTurnsPerSession) ||
        options.maxAutoTurnsPerSession < 1)
    ) {
      throw new Error("maxAutoTurnsPerSession must be a positive integer");
    }
    this.options = options;
    for (const adapter of options.adapters) {
      this.adapters.set(adapter.provider, adapter);
    }
  }

  /** Start the session manager — load persisted sessions and watch for events. */
  async start(): Promise<void> {
    await this.loadSessions();
    this.policy = await loadPolicy(this.options.projectRoot);

    if (this.options.autoSubmit !== false) {
      this.watcher = await watchCoordination(this.options.projectRoot, {
        onEvents: (events) => {
          void this.handleEvents(events).catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : String(error);
            console.error(`Session manager routing error: ${message}`);
          });
        },
        onError: (err) =>
          console.error(`Session manager watcher error: ${err.message}`),
      });
    }
  }

  /** Stop the session manager. */
  async stop(): Promise<void> {
    this.watcher?.stop();
    this.watcher = null;
  }

  /** Detect which agent CLIs are available. */
  async detectProviders(): Promise<
    Array<{ provider: string; version: string }>
  > {
    const results: Array<{ provider: string; version: string }> = [];
    for (const adapter of this.adapters.values()) {
      const version = await adapter.detect();
      if (version) {
        results.push({ provider: adapter.provider, version });
      }
    }
    return results;
  }

  /** Start a new agent session. */
  async startSession(
    provider: string,
    cwd: string,
    prompt?: string,
  ): Promise<AgentSession> {
    const killSwitch = await isKillSwitchActive(this.options.projectRoot);
    if (killSwitch.active) {
      throw new Error(
        `Coordination kill switch is active${killSwitch.reason ? `: ${killSwitch.reason}` : ""}`,
      );
    }
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new Error(`No adapter for provider: ${provider}`);

    const session = await adapter.start({ cwd, prompt });
    this.sessions.set(session.sessionId, session);
    await this.saveSessions();

    // A tracking-only manager must never create an implicit paid turn.
    // Bridge managers replay the current snapshot once start() is idle.
    if (
      this.options.autoSubmit !== false &&
      adapter.capabilities.canSubmitTurn
    ) {
      const snap = await snapshot(this.options.projectRoot, provider);
      await this.submitEvents(session, snap.unackedForAgent);
    }

    return session;
  }

  /** Resume an existing session with snapshot replay. */
  async resumeSession(
    provider: string,
    sessionId: string,
    cwd: string,
  ): Promise<AgentSession> {
    const killSwitch = await isKillSwitchActive(this.options.projectRoot);
    if (killSwitch.active) {
      throw new Error(
        `Coordination kill switch is active${killSwitch.reason ? `: ${killSwitch.reason}` : ""}`,
      );
    }
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new Error(`No adapter for provider: ${provider}`);

    if (!adapter.capabilities.canResume) {
      throw new Error(`${provider} does not support session resumption`);
    }

    const tracked = this.sessions.get(sessionId);
    if (!tracked || tracked.provider !== provider) {
      throw new Error(`Session ${sessionId} is not tracked by Loadout`);
    }

    const session = await adapter.resume(sessionId, cwd);
    session.cursor = tracked.cursor;
    session.startedAt = tracked.startedAt;
    this.sessions.set(session.sessionId, session);

    // Replay missed events
    if (adapter.capabilities.canSubmitTurn && session.cursor >= 0) {
      const { events } = await readAfterCursor(
        this.options.projectRoot,
        session.cursor,
      );
      const relevant = events.filter(
        (e) =>
          e.from !== provider &&
          (e.to === provider || e.to === "*") &&
          e.type !== "ack",
      );
      if (relevant.length > 0) {
        await this.submitEvents(session, relevant);
      }
    }

    await this.saveSessions();
    return session;
  }

  /**
   * Attach a session that was created by the provider rather than Loadout.
   * This is the explicit bridge boundary: the user supplies the host session
   * id, then Loadout can resume it and route future coordination turns.
   */
  async attachSession(
    provider: string,
    sessionId: string,
    cwd: string,
  ): Promise<AgentSession> {
    const killSwitch = await isKillSwitchActive(this.options.projectRoot);
    if (killSwitch.active) {
      throw new Error(
        `Coordination kill switch is active${killSwitch.reason ? `: ${killSwitch.reason}` : ""}`,
      );
    }
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new Error(`No adapter for provider: ${provider}`);
    if (!adapter.capabilities.canResume) {
      throw new Error(`${provider} does not support session resumption`);
    }

    const tracked = this.sessions.get(sessionId);
    if (tracked && tracked.provider !== provider) {
      throw new Error(
        `Session ${sessionId} is already tracked for ${tracked.provider}`,
      );
    }

    const session = await adapter.resume(sessionId, cwd);
    session.cursor = tracked?.cursor ?? -1;
    session.startedAt = tracked?.startedAt ?? session.startedAt;
    this.sessions.set(sessionId, session);

    if (this.options.autoSubmit !== false) {
      const snap = await snapshot(this.options.projectRoot, provider);
      await this.submitEvents(session, snap.unackedForAgent);
    }
    await this.saveSessions();
    return session;
  }

  /** Stop a session. */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const adapter = this.adapters.get(session.provider);
    if (adapter) {
      await adapter.stop(session);
    }

    session.active = false;
    await this.saveSessions();
  }

  /** Get all tracked sessions. */
  getSessions(): AgentSession[] {
    return [...this.sessions.values()];
  }

  /** Get active sessions only. */
  getActiveSessions(): AgentSession[] {
    return [...this.sessions.values()].filter((s) => s.active);
  }

  /** Read the most recent in-memory provider response without persisting it. */
  getLastResponse(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    return this.adapters.get(session.provider)?.lastResponse?.(sessionId);
  }

  /** Submit a direct follow-up turn, denying it while the session is busy. */
  async submitTurn(sessionId: string, message: string): Promise<boolean> {
    if ((await isKillSwitchActive(this.options.projectRoot)).active) {
      return false;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} is not tracked by Loadout`);
    }
    if (!session.active) return false;

    const adapter = this.adapters.get(session.provider);
    if (!adapter?.capabilities.canSubmitTurn) return false;
    if (session.busy) return false;

    const success = await adapter.submitTurn(session, { message });
    if (success) {
      this.options.onTurnCompleted?.(
        session,
        adapter.lastResponse?.(session.sessionId),
      );
      await this.flushPendingEvents(session);
    }
    await this.saveSessions();
    return success;
  }

  /** Route coordination events to active sessions. */
  async handleEvents(events: CoordinationEvent[]): Promise<void> {
    if ((await isKillSwitchActive(this.options.projectRoot)).active) return;
    const deliveries: Array<Promise<void>> = [];
    for (const session of this.sessions.values()) {
      if (!session.active) continue;

      const adapter = this.adapters.get(session.provider);
      if (!adapter) continue;

      // Filter events relevant to this session's agent
      const relevant = events.filter(
        (e) =>
          e.from !== session.agent &&
          (e.to === session.agent || e.to === "*") &&
          e.type !== "ack",
      );

      if (relevant.length === 0) continue;

      deliveries.push(this.submitEvents(session, relevant));
    }
    await Promise.all(deliveries);
  }

  private async submitEvents(
    session: AgentSession,
    events: CoordinationEvent[],
  ): Promise<void> {
    if (events.length === 0) return;
    if ((await isKillSwitchActive(this.options.projectRoot)).active) return;
    const categorized = categorizeEvents(events, this.policy);
    if (categorized.passive.length > 0) {
      this.options.onPendingEvents?.(session, categorized.passive);
    }
    const deliverable = [
      ...categorized.immediate,
      ...categorized.boundary,
    ].sort((left, right) => left.seq - right.seq);
    if (deliverable.length === 0) return;

    const adapter = this.adapters.get(session.provider);
    if (!adapter?.capabilities.canSubmitTurn) {
      this.options.onPendingEvents?.(session, deliverable);
      return;
    }

    const turns = this.autoTurnCounts.get(session.sessionId) ?? 0;
    const maxTurns = this.options.maxAutoTurnsPerSession ?? 20;
    if (turns >= maxTurns) {
      this.options.onPendingEvents?.(session, deliverable);
      return;
    }

    if (session.busy) {
      this.queueEvents(session, deliverable);
      return;
    }

    const message = formatEventsForInjection(deliverable);
    const success = await adapter.submitTurn(session, { message });
    if (!success) {
      if (session.busy) {
        this.queueEvents(session, deliverable);
      } else {
        this.options.onPendingEvents?.(session, deliverable);
      }
      return;
    }

    this.autoTurnCounts.set(session.sessionId, turns + 1);
    session.cursor = Math.max(
      session.cursor,
      deliverable[deliverable.length - 1]!.seq,
    );
    this.options.onTurnCompleted?.(
      session,
      adapter.lastResponse?.(session.sessionId),
    );
    await this.saveSessions();
    await this.flushPendingEvents(session);
  }

  private queueEvents(
    session: AgentSession,
    events: CoordinationEvent[],
  ): void {
    const pending = this.pendingEvents.get(session.sessionId) ?? [];
    pending.push(...events);
    this.pendingEvents.set(session.sessionId, pending);
    this.options.onPendingEvents?.(session, events);
  }

  private async flushPendingEvents(session: AgentSession): Promise<void> {
    if (session.busy) return;
    const pending = this.pendingEvents.get(session.sessionId);
    if (!pending?.length) return;
    this.pendingEvents.delete(session.sessionId);
    await this.submitEvents(session, pending);
  }

  /** Load persisted session state. */
  private async loadSessions(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(
        join(this.options.projectRoot, COORD_DIR, SESSIONS_FILE),
        "utf-8",
      );
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      throw error;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new Error("Invalid persisted session state: expected JSON");
    }
    const parsed = sessionStoreSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new Error(
        `Invalid persisted session state: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`,
      );
    }
    for (const stored of parsed.data.sessions) {
      const session: AgentSession = {
        ...stored,
        // A process restart detaches every host session until explicitly resumed.
        active: false,
        busy: false,
      };
      this.sessions.set(session.sessionId, session);
    }
  }

  /** Persist session state. */
  private async saveSessions(): Promise<void> {
    const dir = join(this.options.projectRoot, COORD_DIR);
    await mkdir(dir, { recursive: true });
    const store: SessionStore = {
      sessions: [...this.sessions.values()],
      updatedAt: new Date().toISOString(),
    };
    const path = join(dir, SESSIONS_FILE);
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(store, null, 2) + "\n", {
      encoding: "utf-8",
      mode: 0o600,
    });
    await rename(temporary, path);
  }
}
