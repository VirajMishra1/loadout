import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  emit,
  readCoordLog,
  readAfterCursor,
  readForAgent,
  snapshot,
  checkOwnershipConflicts,
  getContracts,
  getAckState,
  formatSnapshot,
  formatConflicts,
} from "../src/core/coordination/coordinator.js";

import { validatePayload } from "../src/core/coordination/events.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loadout-coord-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("coordination events", () => {
  it("emits and reads events with monotonic seq", async () => {
    const e1 = await emit(root, {
      from: "claude-code",
      to: "*",
      type: "task",
      description: "Build auth module",
    });
    expect(e1.seq).toBe(0);

    const e2 = await emit(root, {
      from: "codex",
      to: "*",
      type: "task",
      description: "Write tests",
    });
    expect(e2.seq).toBe(1);

    const log = await readCoordLog(root);
    expect(log.events).toHaveLength(2);
    expect(log.highSeq).toBe(1);
    expect(log.corrupt).toHaveLength(0);
  });

  it("reads events after cursor", async () => {
    await emit(root, {
      from: "claude-code",
      to: "*",
      type: "task",
      description: "First",
    });
    await emit(root, {
      from: "codex",
      to: "*",
      type: "task",
      description: "Second",
    });
    await emit(root, {
      from: "claude-code",
      to: "*",
      type: "update",
      description: "Progress",
      payload: { note: "halfway done" },
    });

    const { events } = await readAfterCursor(root, 0);
    expect(events).toHaveLength(2);
    expect(events[0].seq).toBe(1);
  });

  it("filters events for a specific agent", async () => {
    await emit(root, {
      from: "claude-code",
      to: "codex",
      type: "task",
      description: "For codex",
    });
    await emit(root, {
      from: "claude-code",
      to: "*",
      type: "contract",
      description: "Broadcast",
      payload: { name: "api", revision: 1, body: "types here" },
    });
    await emit(root, {
      from: "codex",
      to: "claude-code",
      type: "update",
      description: "Codex update",
      payload: { note: "done" },
    });

    const { events } = await readForAgent(root, "codex");
    expect(events).toHaveLength(3); // all three are relevant to codex
  });
});

describe("contracts", () => {
  it("tracks latest revision per contract name", async () => {
    await emit(root, {
      from: "claude-code",
      to: "*",
      type: "contract",
      description: "API v1",
      payload: {
        name: "auth-api",
        revision: 1,
        body: "interface Auth { login(): void }",
        format: "typescript",
      },
    });
    await emit(root, {
      from: "claude-code",
      to: "*",
      type: "contract",
      description: "API v2",
      payload: {
        name: "auth-api",
        revision: 2,
        body: "interface Auth { login(token: string): void }",
        format: "typescript",
      },
    });

    const contracts = await getContracts(root);
    expect(contracts.size).toBe(1);
    const auth = contracts.get("auth-api")!;
    expect(auth.revision).toBe(2);
    expect(auth.body).toContain("token: string");
  });
});

describe("ownership", () => {
  it("detects exclusive conflicts", async () => {
    await emit(root, {
      from: "claude-code",
      to: "*",
      type: "ownership",
      description: "Claude owns backend",
      payload: { paths: ["src/api/"], mode: "exclusive" },
    });

    const conflicts = await checkOwnershipConflicts(
      root,
      "codex",
      ["src/api/"],
      "exclusive",
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].currentOwner).toBe("claude-code");
  });

  it("allows shared+shared", async () => {
    await emit(root, {
      from: "claude-code",
      to: "*",
      type: "ownership",
      description: "Shared types",
      payload: { paths: ["src/types/"], mode: "shared" },
    });

    const conflicts = await checkOwnershipConflicts(
      root,
      "codex",
      ["src/types/"],
      "shared",
    );
    expect(conflicts).toHaveLength(0);
  });

  it("blocks shared on exclusive", async () => {
    await emit(root, {
      from: "claude-code",
      to: "*",
      type: "ownership",
      description: "Exclusive backend",
      payload: { paths: ["src/api/"], mode: "exclusive" },
    });

    const conflicts = await checkOwnershipConflicts(
      root,
      "codex",
      ["src/api/"],
      "shared",
    );
    expect(conflicts).toHaveLength(1);
  });

  it("allows same agent to re-claim", async () => {
    await emit(root, {
      from: "claude-code",
      to: "*",
      type: "ownership",
      description: "Own it",
      payload: { paths: ["src/api/"], mode: "exclusive" },
    });

    const conflicts = await checkOwnershipConflicts(
      root,
      "claude-code",
      ["src/api/"],
      "exclusive",
    );
    expect(conflicts).toHaveLength(0);
  });
});

describe("acknowledgements", () => {
  it("tracks ack cursors per agent", async () => {
    await emit(root, {
      from: "claude-code",
      to: "*",
      type: "task",
      description: "Do stuff",
    });
    await emit(root, {
      from: "codex",
      to: "*",
      type: "ack",
      description: "Acked",
      payload: { eventSeq: 0 },
    });

    const state = await getAckState(root);
    expect(state.cursors.get("codex")).toBe(0);
  });

  it("identifies unacked events", async () => {
    const e = await emit(root, {
      from: "claude-code",
      to: "*",
      type: "contract",
      description: "New API",
      payload: { name: "api", revision: 1, body: "types" },
    });

    const state = await getAckState(root);
    expect(state.unacked).toHaveLength(1);
    expect(state.unacked[0].id).toBe(e.id);
  });
});

describe("snapshot", () => {
  it("produces a bounded summary", async () => {
    await emit(root, {
      from: "claude-code",
      to: "codex",
      type: "task",
      description: "Build frontend",
    });
    await emit(root, {
      from: "claude-code",
      to: "*",
      type: "contract",
      description: "API contract",
      payload: {
        name: "user-api",
        revision: 1,
        body: "GET /users",
        format: "openapi-yaml",
      },
    });
    await emit(root, {
      from: "claude-code",
      to: "*",
      type: "ownership",
      description: "Backend owned",
      payload: { paths: ["src/api/"], mode: "exclusive" },
    });
    await emit(root, {
      from: "claude-code",
      to: "*",
      type: "decision",
      description: "Use REST",
      payload: { title: "Use REST over GraphQL", rationale: "Simpler for MVP" },
    });

    const snap = await snapshot(root, "codex");
    expect(snap.pendingTasks).toHaveLength(1);
    expect(snap.activeContracts).toHaveLength(1);
    expect(snap.ownership).toHaveLength(1);
    expect(snap.recentDecisions).toHaveLength(1);
    expect(snap.unackedForAgent.length).toBeGreaterThan(0);

    const text = formatSnapshot(snap);
    expect(text).toContain("Pending tasks");
    expect(text).toContain("Active contracts");
    expect(text).toContain("user-api");
  });
});

describe("payload validation", () => {
  it("rejects contract without body", () => {
    const result = validatePayload("contract", { name: "x", revision: 1 });
    expect(result.success).toBe(false);
  });

  it("accepts valid contract", () => {
    const result = validatePayload("contract", {
      name: "x",
      revision: 1,
      body: "types",
    });
    expect(result.success).toBe(true);
  });

  it("accepts task without payload", () => {
    const result = validatePayload("task", undefined);
    expect(result.success).toBe(true);
  });

  it("rejects ownership without paths", () => {
    const result = validatePayload("ownership", { mode: "exclusive" });
    expect(result.success).toBe(false);
  });
});

describe("formatConflicts", () => {
  it("returns no-conflict message when empty", () => {
    expect(formatConflicts([])).toBe("No ownership conflicts.");
  });

  it("lists conflicts with details", () => {
    const text = formatConflicts([
      {
        path: "src/api/",
        currentOwner: "claude-code",
        currentMode: "exclusive",
        requestedBy: "codex",
        requestedMode: "exclusive",
      },
    ]);
    expect(text).toContain("claude-code");
    expect(text).toContain("codex");
  });
});
