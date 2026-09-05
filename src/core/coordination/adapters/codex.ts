/**
 * Codex adapter.
 *
 * Uses an injected Codex SDK-shaped driver. This keeps the adapter testable
 * without running paid turns and keeps the SDK dependency at the composition
 * boundary.
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

const PROVIDER = "codex";
const CLI = "codex";

export interface CodexThreadOptions {
  workingDirectory: string;
}

export interface CodexThreadDriver {
  readonly id: string | null;
  run(prompt: string): Promise<unknown>;
  /** Abort the current run if supported. */
  abort?(): void;
}

export interface CodexSdkDriver {
  /** Human-readable SDK/runtime version for capability detection. */
  readonly runtimeVersion?: string;
  startThread(options: CodexThreadOptions): CodexThreadDriver;
  resumeThread(
    sessionId: string,
    options: CodexThreadOptions,
  ): CodexThreadDriver;
}

function requireThreadId(thread: CodexThreadDriver): string {
  const id = thread.id;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error("Codex SDK did not return a valid thread id");
  }
  return id;
}

async function withAbort(
  promise: Promise<unknown>,
  thread: CodexThreadDriver,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      thread.abort?.();
      reject(
        signal.reason ??
          new DOMException("The operation was aborted", "AbortError"),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function responseFromRun(result: unknown): string | undefined {
  if (
    typeof result === "object" &&
    result !== null &&
    "finalResponse" in result &&
    typeof result.finalResponse === "string"
  ) {
    return result.finalResponse;
  }
  return undefined;
}

export class CodexAdapter implements AgentAdapter {
  readonly provider = PROVIDER;
  private readonly threads = new Map<string, CodexThreadDriver>();
  private readonly sessions = new Map<string, AgentSession>();
  private readonly responses = new Map<string, string>();

  constructor(private readonly driver: CodexSdkDriver) {}

  readonly capabilities: AdapterCapabilities = {
    canSubmitTurn: true,
    canInjectDuringTurn: false,
    canResume: true,
    canStream: false,
    canStart: true,
  };

  async detect(): Promise<string | null> {
    if (this.driver.runtimeVersion) return this.driver.runtimeVersion;
    try {
      const { stdout } = await exec(CLI, ["--version"], { timeout: 5000 });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  async start(options: StartOptions): Promise<AgentSession> {
    if (options.flags?.length) {
      throw new Error("Codex adapter does not support additional CLI flags");
    }
    if (options.resumeSessionId) {
      throw new Error("Use resume() to continue a Codex thread");
    }
    options.signal?.throwIfAborted();
    const thread = this.driver.startThread({
      workingDirectory: options.cwd,
    });
    const runPromise = thread.run(options.prompt ?? "");
    const result = await withAbort(runPromise, thread, options.signal);
    const sessionId = requireThreadId(thread);
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
    this.threads.set(sessionId, thread);
    this.sessions.set(sessionId, session);
    const response = responseFromRun(result);
    if (response) this.responses.set(sessionId, response);
    return session;
  }

  async resume(sessionId: string, cwd: string): Promise<AgentSession> {
    const thread = this.driver.resumeThread(sessionId, {
      workingDirectory: cwd,
    });
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
    this.threads.set(sessionId, thread);
    this.sessions.set(sessionId, session);
    return session;
  }

  async submitTurn(
    session: AgentSession,
    options: SubmitTurnOptions,
  ): Promise<boolean> {
    if (!session.active || session.busy) return false;
    const thread = this.threads.get(session.sessionId);
    if (!thread) return false;
    session.busy = true;
    try {
      const runPromise = thread.run(options.message);
      const result = await withAbort(runPromise, thread, options.signal);
      const response = responseFromRun(result);
      if (response) this.responses.set(session.sessionId, response);
      return true;
    } catch {
      return false;
    } finally {
      session.busy = false;
    }
  }

  async stop(session: AgentSession): Promise<void> {
    session.active = false;
    session.busy = false;
  }

  async listSessions(cwd: string): Promise<AgentSession[]> {
    return [...this.sessions.values()]
      .filter((session) => session.cwd === cwd)
      .map((session) => ({ ...session }));
  }

  lastResponse(sessionId: string): string | undefined {
    return this.responses.get(sessionId);
  }
}
