import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "../src/core/coordination/session-manager.js";
import type {
  AgentAdapter,
  AgentSession,
  SubmitTurnOptions,
} from "../src/core/coordination/adapters/types.js";
import type { CoordinationEvent } from "../src/core/coordination/events.js";

class FakeAdapter implements AgentAdapter {
  readonly provider = "fake";
  readonly capabilities = {
    canSubmitTurn: true,
    canInjectDuringTurn: false,
    canResume: true,
    canStream: false,
    canStart: true,
  };
  readonly prompts: string[] = [];
  readonly resumed: string[] = [];
  private readonly sessions = new Map<string, AgentSession>();
  private releaseTurn: (() => void) | undefined;
  private hold = false;
  private nextId = 1;

  async detect(): Promise<string> {
    return "fake 1.0";
  }

  async start(options: { cwd: string }): Promise<AgentSession> {
    const session: AgentSession = {
      sessionId: `fake-${this.nextId++}`,
      agent: this.provider,
      provider: this.provider,
      active: true,
      busy: false,
      cursor: -1,
      startedAt: "2026-09-03T12:00:00.000Z",
      cwd: options.cwd,
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  async resume(sessionId: string, cwd: string): Promise<AgentSession> {
    this.resumed.push(sessionId);
    const session: AgentSession = {
      sessionId,
      agent: this.provider,
      provider: this.provider,
      active: true,
      busy: false,
      cursor: -1,
      startedAt: "2026-09-03T12:00:00.000Z",
      cwd,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  async submitTurn(
    session: AgentSession,
    options: SubmitTurnOptions,
  ): Promise<boolean> {
    if (session.busy) return false;
    session.busy = true;
    this.prompts.push(options.message);
    try {
      if (this.hold) {
        await new Promise<void>((resolve) => {
          this.releaseTurn = resolve;
        });
      }
      return true;
    } finally {
      session.busy = false;
      this.hold = false;
    }
  }

  holdNextTurn(): void {
    this.hold = true;
  }

  releaseHeldTurn(): void {
    this.releaseTurn?.();
  }

  async stop(session: AgentSession): Promise<void> {
    session.active = false;
    session.busy = false;
  }

  async listSessions(cwd: string): Promise<AgentSession[]> {
    return [...this.sessions.values()].filter((session) => session.cwd === cwd);
  }
}

const event: CoordinationEvent = {
  id: "event-1",
  seq: 4,
  type: "update",
  from: "other-agent",
  to: "fake",
  description: "Contract implementation is ready",
  timestamp: "2026-09-03T12:01:00.000Z",
};

describe("SessionManager turn scheduling", () => {
  let projectRoot = "";

  afterEach(async () => {
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
    projectRoot = "";
  });

  it("denies a direct turn while the session is busy", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "loadout-sessions-"));
    const adapter = new FakeAdapter();
    const manager = new SessionManager({
      projectRoot,
      adapters: [adapter],
      autoSubmit: false,
    });
    await manager.start();
    const session = await manager.startSession("fake", projectRoot);
    adapter.holdNextTurn();

    const activeTurn = manager.submitTurn(session.sessionId, "First turn");
    await expect(
      manager.submitTurn(session.sessionId, "Second turn"),
    ).resolves.toBe(false);

    adapter.releaseHeldTurn();
    await expect(activeTurn).resolves.toBe(true);
    expect(adapter.prompts).toEqual(["First turn"]);
    await manager.stop();
  });

  it("queues coordination events while busy and flushes them when idle", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "loadout-sessions-"));
    const adapter = new FakeAdapter();
    const manager = new SessionManager({
      projectRoot,
      adapters: [adapter],
      autoSubmit: false,
    });
    await manager.start();
    const session = await manager.startSession("fake", projectRoot);
    adapter.holdNextTurn();

    const activeTurn = manager.submitTurn(session.sessionId, "Manual turn");
    await manager.handleEvents([event]);
    expect(adapter.prompts).toEqual(["Manual turn"]);

    adapter.releaseHeldTurn();
    await activeTurn;
    expect(adapter.prompts).toHaveLength(2);
    expect(adapter.prompts[1]).toContain("Contract implementation is ready");
    expect(session.cursor).toBe(4);
    await manager.stop();
  });

  it("resumes only sessions already tracked by Loadout", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "loadout-sessions-"));
    const firstAdapter = new FakeAdapter();
    const firstManager = new SessionManager({
      projectRoot,
      adapters: [firstAdapter],
      autoSubmit: false,
    });
    await firstManager.start();
    const created = await firstManager.startSession("fake", projectRoot);
    await firstManager.stop();

    const secondAdapter = new FakeAdapter();
    const secondManager = new SessionManager({
      projectRoot,
      adapters: [secondAdapter],
      autoSubmit: false,
    });
    await secondManager.start();

    await expect(
      secondManager.resumeSession("fake", "host-owned", projectRoot),
    ).rejects.toThrow(/not tracked by Loadout/i);
    await expect(
      secondManager.resumeSession("fake", created.sessionId, projectRoot),
    ).resolves.toMatchObject({
      sessionId: created.sessionId,
      active: true,
      busy: false,
    });
    expect(secondAdapter.resumed).toEqual([created.sessionId]);
    await secondManager.stop();
  });
});
