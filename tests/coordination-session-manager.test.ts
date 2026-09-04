import { afterEach, describe, expect, it } from "vitest";
import { access, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "../src/core/coordination/session-manager.js";
import type {
  AgentAdapter,
  AgentSession,
  SubmitTurnOptions,
} from "../src/core/coordination/adapters/types.js";
import type { CoordinationEvent } from "../src/core/coordination/events.js";
import { activateKillSwitch } from "../src/core/coordination/crash-recovery.js";
import { emit } from "../src/core/coordination/coordinator.js";

class FakeAdapter implements AgentAdapter {
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

  constructor(readonly provider = "fake") {}

  async detect(): Promise<string> {
    return "fake 1.0";
  }

  async start(options: { cwd: string }): Promise<AgentSession> {
    const session: AgentSession = {
      sessionId: `${this.provider}-${this.nextId++}`,
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

  lastResponse(sessionId: string): string | undefined {
    return this.sessions.has(sessionId) ? "Provider turn completed" : undefined;
  }
}

const event: CoordinationEvent = {
  id: "event-1",
  seq: 4,
  type: "task",
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

  it("does not create session state when started and stopped without changes", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "loadout-sessions-"));
    const manager = new SessionManager({
      projectRoot,
      adapters: [new FakeAdapter()],
      autoSubmit: false,
    });

    await manager.start();
    await manager.stop();

    await expect(
      access(join(projectRoot, ".handoff", "sessions.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed on malformed persisted session state", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "loadout-sessions-"));
    await mkdir(join(projectRoot, ".handoff"), { recursive: true });
    await writeFile(
      join(projectRoot, ".handoff", "sessions.json"),
      JSON.stringify({ sessions: [{ sessionId: 42 }] }),
      "utf8",
    );
    const manager = new SessionManager({
      projectRoot,
      adapters: [new FakeAdapter()],
      autoSubmit: false,
    });

    await expect(manager.start()).rejects.toThrow(/session state/i);
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
    expect(manager.getLastResponse(session.sessionId)).toBe(
      "Provider turn completed",
    );
    await manager.stop();
  });

  it("refuses provider turns while the kill switch is active", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "loadout-sessions-"));
    const adapter = new FakeAdapter();
    const manager = new SessionManager({
      projectRoot,
      adapters: [adapter],
      autoSubmit: false,
    });
    await manager.start();
    const session = await manager.startSession("fake", projectRoot);
    await activateKillSwitch(projectRoot, "pause all agents");

    await expect(
      manager.submitTurn(session.sessionId, "Must not run"),
    ).resolves.toBe(false);
    expect(adapter.prompts).toEqual([]);
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

  it("routes a broadcast to provider sessions concurrently", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "loadout-sessions-"));
    const slow = new FakeAdapter("slow");
    const fast = new FakeAdapter("fast");
    const manager = new SessionManager({
      projectRoot,
      adapters: [slow, fast],
      autoSubmit: false,
    });
    await manager.start();
    await manager.startSession("slow", projectRoot);
    await manager.startSession("fast", projectRoot);
    slow.holdNextTurn();

    const routing = manager.handleEvents([{ ...event, to: "*" }]);
    const deadline = Date.now() + 500;
    while (fast.prompts.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(slow.prompts).toHaveLength(1);
    expect(fast.prompts).toHaveLength(1);
    slow.releaseHeldTurn();
    await routing;
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

  it("attaches a provider-owned session and persists it for future bridges", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "loadout-sessions-"));
    const firstAdapter = new FakeAdapter();
    const firstManager = new SessionManager({
      projectRoot,
      adapters: [firstAdapter],
      autoSubmit: false,
    });
    await firstManager.start();

    await expect(
      firstManager.attachSession("fake", "host-owned", projectRoot),
    ).resolves.toMatchObject({
      sessionId: "host-owned",
      provider: "fake",
      active: true,
    });
    expect(firstAdapter.resumed).toEqual(["host-owned"]);
    await firstManager.stop();
    if (process.platform !== "win32") {
      expect(
        (await stat(join(projectRoot, ".handoff", "sessions.json"))).mode &
          0o777,
      ).toBe(0o600);
    }

    const secondAdapter = new FakeAdapter();
    const secondManager = new SessionManager({
      projectRoot,
      adapters: [secondAdapter],
      autoSubmit: false,
    });
    await secondManager.start();
    expect(secondManager.getSessions()).toEqual([
      expect.objectContaining({
        sessionId: "host-owned",
        provider: "fake",
        active: false,
      }),
    ]);
    await secondManager.stop();
  });

  it("does not spend a provider turn while attaching with automatic submission disabled", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "loadout-sessions-"));
    await emit(projectRoot, {
      from: "backend",
      to: "fake",
      type: "contract",
      description: "Published checkout endpoint",
      payload: {
        name: "checkout-api",
        revision: 1,
        body: "POST /api/checkout -> 201",
      },
    });
    const adapter = new FakeAdapter();
    const manager = new SessionManager({
      projectRoot,
      adapters: [adapter],
      autoSubmit: false,
    });
    await manager.start();

    await manager.attachSession("fake", "tracking-only", projectRoot);

    expect(adapter.resumed).toEqual(["tracking-only"]);
    expect(adapter.prompts).toEqual([]);
    expect(manager.getSessions()[0]?.cursor).toBe(-1);
    await manager.stop();
  });

  it("delivers a new coordination event to an attached session automatically", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "loadout-sessions-"));
    const adapter = new FakeAdapter();
    const manager = new SessionManager({
      projectRoot,
      adapters: [adapter],
      autoSubmit: true,
    });
    await manager.start();
    await manager.attachSession("fake", "live-session", projectRoot);

    await emit(projectRoot, {
      from: "backend",
      to: "fake",
      type: "contract",
      description: "Published checkout endpoint",
      payload: {
        name: "checkout-api",
        revision: 1,
        body: "POST /api/checkout -> 201",
      },
    });

    const deadline = Date.now() + 2_000;
    while (adapter.prompts.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(adapter.prompts).toHaveLength(1);
    expect(adapter.prompts[0]).toContain("checkout-api rev1");
    expect(manager.getSessions()[0]?.cursor).toBe(0);
    await manager.stop();
  });

  it("records passive updates without spending an automatic provider turn", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "loadout-sessions-"));
    const adapter = new FakeAdapter();
    const pending: CoordinationEvent[][] = [];
    const manager = new SessionManager({
      projectRoot,
      adapters: [adapter],
      autoSubmit: false,
      onPendingEvents: (_session, events) => pending.push(events),
    });
    await manager.start();
    await manager.attachSession("fake", "passive-session", projectRoot);

    await manager.handleEvents([{ ...event, type: "update" }]);

    expect(adapter.prompts).toEqual([]);
    expect(pending).toEqual([[expect.objectContaining({ type: "update" })]]);
    await manager.stop();
  });

  it("caps automatic turns per session to prevent runaway agent loops", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "loadout-sessions-"));
    const adapter = new FakeAdapter();
    const pending: CoordinationEvent[][] = [];
    const manager = new SessionManager({
      projectRoot,
      adapters: [adapter],
      autoSubmit: false,
      maxAutoTurnsPerSession: 1,
      onPendingEvents: (_session, events) => pending.push(events),
    });
    await manager.start();
    await manager.attachSession("fake", "bounded-session", projectRoot);

    await manager.handleEvents([{ ...event, type: "contract", seq: 1 }]);
    await manager.handleEvents([{ ...event, type: "task", seq: 2 }]);

    expect(adapter.prompts).toHaveLength(1);
    expect(pending.at(-1)).toEqual([
      expect.objectContaining({ type: "task", seq: 2 }),
    ]);
    await manager.stop();
  });
});
