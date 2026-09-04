import { describe, it, expect } from "vitest";
import {
  getContractHistory,
  diffContracts,
  diffLatestContract,
  formatContractDelta,
} from "../src/core/coordination/contract-diff.js";
import { emit } from "../src/core/coordination/coordinator.js";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function makeTmpProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "loadout-cdiff-"));
  await mkdir(join(dir, ".handoff"), { recursive: true });
  return dir;
}

describe("contract-diff", () => {
  it("returns empty history for unknown contract", async () => {
    const root = await makeTmpProject();
    try {
      const history = await getContractHistory(root, "nonexistent");
      expect(history).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("tracks contract revision history", async () => {
    const root = await makeTmpProject();
    try {
      await emit(root, {
        from: "claude-code",
        to: "*",
        type: "contract",
        description: "auth-api rev1",
        payload: {
          name: "auth-api",
          revision: 1,
          body: "type User = { id: string }",
          format: "typescript",
        },
      });
      await emit(root, {
        from: "codex",
        to: "*",
        type: "contract",
        description: "auth-api rev2",
        payload: {
          name: "auth-api",
          revision: 2,
          body: "type User = { id: string; email: string }",
          format: "typescript",
        },
      });

      const history = await getContractHistory(root, "auth-api");
      expect(history).toHaveLength(2);
      expect(history[0].revision).toBe(1);
      expect(history[1].revision).toBe(2);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("diffs two contract revisions", () => {
    const from = {
      name: "api",
      revision: 1,
      body: "line1\nline2\nline3",
      publisher: "claude",
      eventId: "a",
      seq: 0,
      timestamp: new Date().toISOString(),
    };
    const to = {
      name: "api",
      revision: 2,
      body: "line1\nline2-changed\nline3\nline4",
      publisher: "codex",
      eventId: "b",
      seq: 1,
      timestamp: new Date().toISOString(),
    };

    const delta = diffContracts(from, to);
    expect(delta.fromRevision).toBe(1);
    expect(delta.toRevision).toBe(2);
    expect(delta.added.length).toBeGreaterThan(0);
    expect(delta.summary).toContain("line(s)");
  });

  it("diffLatestContract returns null for single revision", async () => {
    const root = await makeTmpProject();
    try {
      await emit(root, {
        from: "claude-code",
        to: "*",
        type: "contract",
        description: "api rev1",
        payload: { name: "api", revision: 1, body: "v1" },
      });

      const delta = await diffLatestContract(root, "api");
      expect(delta).toBeNull();
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("diffLatestContract diffs last two revisions", async () => {
    const root = await makeTmpProject();
    try {
      await emit(root, {
        from: "claude-code",
        to: "*",
        type: "contract",
        description: "api rev1",
        payload: { name: "api", revision: 1, body: "old body" },
      });
      await emit(root, {
        from: "codex",
        to: "*",
        type: "contract",
        description: "api rev2",
        payload: { name: "api", revision: 2, body: "new body" },
      });

      const delta = await diffLatestContract(root, "api");
      expect(delta).not.toBeNull();
      expect(delta!.fromRevision).toBe(1);
      expect(delta!.toRevision).toBe(2);
      expect(delta!.removed).toContain("old body");
      expect(delta!.added).toContain("new body");
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("formats delta for terminal", () => {
    const output = formatContractDelta({
      name: "auth-api",
      fromRevision: 1,
      toRevision: 2,
      fromPublisher: "claude",
      toPublisher: "codex",
      added: ["+ new endpoint"],
      removed: ["- old endpoint"],
      changed: [],
      summary: "1 added, 1 removed line(s)",
    });
    expect(output).toContain("auth-api");
    expect(output).toContain("rev1");
    expect(output).toContain("rev2");
  });
});
