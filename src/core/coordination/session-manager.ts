/**
 * Session manager for coordinated agent sessions.
 *
 * Tracks active sessions across providers, handles reconnection with
 * snapshot replay, and routes coordination events as follow-up turns.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentAdapter, AgentSession } from "./adapters/types.js";
import { formatEventsForInjection } from "./adapters/types.js";
import { snapshot, readAfterCursor } from "./coordinator.js";
import { watchCoordination, type CoordinationWatcher } from "./watcher.js";
import type { CoordinationEvent } from "./events.js";

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
}

interface SessionStore {
  sessions: AgentSession[];
  updatedAt: string;
}

export class SessionManager {
  private sessions = new Map<string, AgentSession>();
  private adapters = new Map<string, AgentAdapter>();
  private pendingEvents = new Map<string, CoordinationEvent[]>();
  private watcher: CoordinationWatcher | null = null;
  private options: SessionManagerOptions;

  constructor(options: SessionManagerOptions) {
    this.options = options;
    for (const adapter of options.adapters) {
      this.adapters.set(adapter.provider, adapter);
    }
  }

  /** Start the session manager — load persisted sessions and watch for events. */
  async start(): Promise<void> {
    await this.loadSessions();

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
    await this.saveSessions();
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
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new Error(`No adapter for provider: ${provider}`);

    const session = await adapter.start({ cwd, prompt });
    this.sessions.set(session.sessionId, session);
    await this.saveSessions();

    // Submit the current snapshot as a follow-up turn once start() is idle.
    if (adapter.capabilities.canSubmitTurn) {
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

  /** Submit a direct follow-up turn, denying it while the session is busy. */
  async submitTurn(sessionId: string, message: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} is not tracked by Loadout`);
    }
    if (!session.active) return false;

    const adapter = this.adapters.get(session.provider);
    if (!adapter?.capabilities.canSubmitTurn) return false;
    if (session.busy) return false;

    const success = await adapter.submitTurn(session, { message });
    if (success) await this.flushPendingEvents(session);
    await this.saveSessions();
    return success;
  }

  /** Route coordination events to active sessions. */
  async handleEvents(events: CoordinationEvent[]): Promise<void> {
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

      await this.submitEvents(session, relevant);
    }
  }

  private async submitEvents(
    session: AgentSession,
    events: CoordinationEvent[],
  ): Promise<void> {
    if (events.length === 0) return;
    const adapter = this.adapters.get(session.provider);
    if (!adapter?.capabilities.canSubmitTurn) {
      this.options.onPendingEvents?.(session, events);
      return;
    }

    if (session.busy) {
      this.queueEvents(session, events);
      return;
    }

    const message = formatEventsForInjection(events);
    const success = await adapter.submitTurn(session, { message });
    if (!success) {
      if (session.busy) {
        this.queueEvents(session, events);
      } else {
        this.options.onPendingEvents?.(session, events);
      }
      return;
    }

    session.cursor = Math.max(session.cursor, events[events.length - 1]!.seq);
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
    try {
      const raw = await readFile(
        join(this.options.projectRoot, COORD_DIR, SESSIONS_FILE),
        "utf-8",
      );
      const store = JSON.parse(raw) as SessionStore;
      for (const s of store.sessions) {
        // Mark all persisted sessions as inactive until resumed
        s.active = false;
        s.busy = false;
        this.sessions.set(s.sessionId, s);
      }
    } catch {
      // No saved sessions
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
    await writeFile(
      join(dir, SESSIONS_FILE),
      JSON.stringify(store, null, 2) + "\n",
      "utf-8",
    );
  }
}
