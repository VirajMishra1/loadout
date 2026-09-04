/**
 * Session manager for coordinated agent sessions.
 *
 * Tracks active sessions across providers, handles reconnection with
 * snapshot replay, and routes coordination events to the right adapter.
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
  /** Auto-inject events into sessions that support it. Default true. */
  autoInject?: boolean;
  /** Callback when events can't be injected (adapter doesn't support it). */
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

    if (this.options.autoInject !== false) {
      this.watcher = await watchCoordination(this.options.projectRoot, {
        onEvents: (events) => this.routeEvents(events),
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

    // If the session supports injection, send it the current snapshot
    if (adapter.capabilities.canInject) {
      const snap = await snapshot(this.options.projectRoot, provider);
      const summary = formatEventsForInjection(snap.unackedForAgent);
      if (summary) {
        await adapter.inject(session, { message: summary });
      }
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

    const session = await adapter.resume(sessionId, cwd);
    this.sessions.set(session.sessionId, session);

    // Replay missed events
    if (adapter.capabilities.canInject && session.cursor >= 0) {
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
        await adapter.injectEvents(session, relevant);
        session.cursor = events[events.length - 1]!.seq;
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

  /** Route coordination events to active sessions. */
  private async routeEvents(events: CoordinationEvent[]): Promise<void> {
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

      if (adapter.capabilities.canInject) {
        const success = await adapter.injectEvents(session, relevant);
        if (success) {
          session.cursor = Math.max(
            session.cursor,
            relevant[relevant.length - 1]!.seq,
          );
        }
      } else {
        // Can't inject — notify via callback
        this.options.onPendingEvents?.(session, relevant);
      }
    }
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
