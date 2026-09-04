/**
 * Claude Code adapter.
 *
 * Uses the `claude` CLI directly — no SDK dependency. Supports:
 * - Session detection via `claude sessions list`
 * - Session resumption via `claude --resume <id>`
 * - Message injection via `claude --resume <id> --message "..."`
 * - Starting new sessions via `claude --print`
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AgentAdapter,
  AgentSession,
  AdapterCapabilities,
  InjectOptions,
  StartOptions,
} from "./types.js";
import { formatEventsForInjection } from "./types.js";
import type { CoordinationEvent } from "../events.js";

const exec = promisify(execFile);

const PROVIDER = "claude-code";
const CLI = "claude";

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly provider = PROVIDER;

  readonly capabilities: AdapterCapabilities = {
    canInject: true,
    canResume: true,
    canStream: false, // CLI doesn't expose a streaming API we can consume
    canStart: true,
  };

  async detect(): Promise<string | null> {
    try {
      const { stdout } = await exec(CLI, ["--version"], { timeout: 5000 });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  async start(options: StartOptions): Promise<AgentSession> {
    const args = ["--print", "--output-format", "json"];

    if (options.prompt) {
      args.push("--message", options.prompt);
    }

    if (options.flags) {
      args.push(...options.flags);
    }

    const { stdout } = await exec(CLI, args, {
      cwd: options.cwd,
      timeout: 30000,
    });

    // Try to parse session ID from output
    let sessionId = `claude-${Date.now()}`;
    try {
      const parsed = JSON.parse(stdout) as { session_id?: string };
      if (parsed.session_id) sessionId = parsed.session_id;
    } catch {
      // Use generated ID
    }

    return {
      sessionId,
      agent: PROVIDER,
      provider: PROVIDER,
      active: true,
      cursor: -1,
      startedAt: new Date().toISOString(),
      cwd: options.cwd,
    };
  }

  async resume(sessionId: string, cwd: string): Promise<AgentSession> {
    // Verify session exists
    const sessions = await this.listSessions(cwd);
    const existing = sessions.find((s) => s.sessionId === sessionId);

    if (!existing) {
      throw new Error(`Claude Code session ${sessionId} not found`);
    }

    return {
      ...existing,
      active: true,
    };
  }

  async inject(
    session: AgentSession,
    options: InjectOptions,
  ): Promise<boolean> {
    try {
      const args = [
        "--resume",
        session.sessionId,
        "--print",
        "--message",
        options.message,
      ];

      await exec(CLI, args, {
        cwd: session.cwd,
        timeout: options.timeout ?? 30000,
      });

      return true;
    } catch {
      return false;
    }
  }

  async injectEvents(
    session: AgentSession,
    events: CoordinationEvent[],
  ): Promise<boolean> {
    const message = formatEventsForInjection(events);
    if (!message) return true;
    return this.inject(session, { message });
  }

  async stop(session: AgentSession): Promise<void> {
    // Claude Code sessions end when the CLI process exits.
    // We can't force-stop a running session from outside,
    // but we can mark it inactive in our tracking.
    session.active = false;
  }

  async listSessions(cwd: string): Promise<AgentSession[]> {
    try {
      const { stdout } = await exec(
        CLI,
        ["sessions", "list", "--output-format", "json"],
        { cwd, timeout: 10000 },
      );

      const sessions = JSON.parse(stdout) as Array<{
        id: string;
        created_at?: string;
        cwd?: string;
      }>;

      return sessions.map((s) => ({
        sessionId: s.id,
        agent: PROVIDER,
        provider: PROVIDER,
        active: false, // We can't know if they're actively running
        cursor: -1,
        startedAt: s.created_at ?? new Date().toISOString(),
        cwd: s.cwd ?? cwd,
      }));
    } catch {
      return [];
    }
  }
}
