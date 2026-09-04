/**
 * Claude Code adapter.
 *
 * Uses Claude's documented print-mode CLI form. A submitted prompt is a new
 * turn; the CLI does not provide mid-turn injection or global session listing.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AgentAdapter,
  AgentSession,
  AdapterCapabilities,
  SubmitTurnOptions,
  StartOptions,
} from "./types.js";
const exec = promisify(execFile);

const PROVIDER = "claude-code";
const CLI = "claude";

export interface ClaudeCommandOptions {
  cwd?: string;
  timeout: number;
}

export type ClaudeCommandDriver = (
  command: string,
  args: readonly string[],
  options: ClaudeCommandOptions,
) => Promise<{ stdout: string }>;

const defaultCommandDriver: ClaudeCommandDriver = async (
  command,
  args,
  options,
) => {
  const { stdout } = await exec(command, [...args], options);
  return { stdout: String(stdout) };
};

function parseSessionId(stdout: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("Claude did not return JSON with a valid session_id");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("session_id" in parsed) ||
    typeof parsed.session_id !== "string" ||
    parsed.session_id.trim().length === 0
  ) {
    throw new Error("Claude did not return JSON with a valid session_id");
  }

  return parsed.session_id;
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly provider = PROVIDER;
  private readonly sessions = new Map<string, AgentSession>();

  constructor(
    private readonly runCommand: ClaudeCommandDriver = defaultCommandDriver,
  ) {}

  readonly capabilities: AdapterCapabilities = {
    canSubmitTurn: true,
    canInjectDuringTurn: false,
    canResume: true,
    canStream: false, // CLI doesn't expose a streaming API we can consume
    canStart: true,
  };

  async detect(): Promise<string | null> {
    try {
      const { stdout } = await this.runCommand(CLI, ["--version"], {
        timeout: 5000,
      });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  async start(options: StartOptions): Promise<AgentSession> {
    if (options.flags?.length) {
      throw new Error("Claude adapter does not support additional CLI flags");
    }
    const args = ["-p", "--output-format", "json"];
    if (options.resumeSessionId) {
      args.push("--resume", options.resumeSessionId);
    }
    args.push(options.prompt ?? "");

    const { stdout } = await this.runCommand(CLI, args, {
      cwd: options.cwd,
      timeout: 30000,
    });
    const sessionId = parseSessionId(stdout);
    const session: AgentSession = {
      sessionId,
      agent: PROVIDER,
      provider: PROVIDER,
      active: true,
      busy: false,
      cursor: -1,
      startedAt: new Date().toISOString(),
      cwd: options.cwd,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  async resume(sessionId: string, cwd: string): Promise<AgentSession> {
    const existing = this.sessions.get(sessionId);
    const session: AgentSession = {
      sessionId,
      agent: PROVIDER,
      provider: PROVIDER,
      active: true,
      busy: false,
      cursor: existing?.cursor ?? -1,
      startedAt: existing?.startedAt ?? new Date().toISOString(),
      cwd,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  async submitTurn(
    session: AgentSession,
    options: SubmitTurnOptions,
  ): Promise<boolean> {
    if (!session.active || session.busy) return false;
    session.busy = true;
    try {
      const args = [
        "-p",
        "--output-format",
        "json",
        "--resume",
        session.sessionId,
        options.message,
      ];

      const { stdout } = await this.runCommand(CLI, args, {
        cwd: session.cwd,
        timeout: options.timeout ?? 30000,
      });
      return parseSessionId(stdout) === session.sessionId;
    } catch {
      return false;
    } finally {
      session.busy = false;
    }
  }

  async stop(session: AgentSession): Promise<void> {
    // Claude Code sessions end when the CLI process exits.
    // We can't force-stop a running session from outside,
    // but we can mark it inactive in our tracking.
    session.active = false;
    session.busy = false;
  }

  async listSessions(cwd: string): Promise<AgentSession[]> {
    return [...this.sessions.values()]
      .filter((session) => session.cwd === cwd)
      .map((session) => ({ ...session }));
  }
}
