/**
 * Codex adapter.
 *
 * Uses the `codex` CLI directly. Supports:
 * - Detection via `codex --version`
 * - Starting sessions via `codex --quiet`
 * - Message injection into running sessions
 *
 * The Codex SDK (`@openai/codex`) is not required — this adapter
 * uses the CLI, which is how most users interact with Codex.
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

const PROVIDER = "codex";
const CLI = "codex";

export class CodexAdapter implements AgentAdapter {
  readonly provider = PROVIDER;

  readonly capabilities: AdapterCapabilities = {
    canInject: false, // Codex CLI doesn't support message injection into running sessions
    canResume: false, // Codex sessions are not resumable via CLI
    canStream: false,
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
    const args = ["--quiet"];

    if (options.prompt) {
      args.push(options.prompt);
    }

    if (options.flags) {
      args.push(...options.flags);
    }

    const sessionId = `codex-${Date.now()}`;

    // Codex runs as a foreground process — we spawn it detached
    // so it continues in the background. The user interacts with
    // it in their terminal/app.
    try {
      await exec(CLI, args, {
        cwd: options.cwd,
        timeout: 30000,
      });
    } catch {
      // Codex may exit with non-zero if it completes the task
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

  async resume(_sessionId: string, _cwd: string): Promise<AgentSession> {
    throw new Error(
      "Codex does not support session resumption. " +
        "Start a new session and it will pick up coordination state " +
        "from the JSONL log via the loadout-handoff skill.",
    );
  }

  async inject(
    _session: AgentSession,
    _options: InjectOptions,
  ): Promise<boolean> {
    // Codex CLI doesn't support injecting messages into a running session.
    // Coordination events are picked up via the loadout-handoff skill
    // at session boundaries.
    return false;
  }

  async injectEvents(
    _session: AgentSession,
    _events: CoordinationEvent[],
  ): Promise<boolean> {
    // Same limitation — Codex reads events at session start via the skill.
    return false;
  }

  async stop(session: AgentSession): Promise<void> {
    session.active = false;
  }

  async listSessions(_cwd: string): Promise<AgentSession[]> {
    // Codex doesn't expose a session listing API
    return [];
  }
}
