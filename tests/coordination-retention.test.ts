import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { emit, readCoordLog } from "../src/core/coordination/coordinator.js";
import { compact, logSize } from "../src/core/coordination/retention.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loadout-retain-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("retention", () => {
  it("skips compaction when under threshold", async () => {
    await emit(root, {
      from: "a",
      to: "*",
      type: "task",
      description: "task 1",
    });

    const result = await compact(root, { maxEvents: 100, maxAgeDays: 30 });
    expect(result.compacted).toBe(false);
    expect(result.removed).toBe(0);
  });

  it("compacts when over maxEvents", async () => {
    // Write 20 events
    for (let i = 0; i < 20; i++) {
      await emit(root, {
        from: "agent",
        to: "*",
        type: "task",
        description: `task ${i}`,
      });
    }

    const before = await readCoordLog(root);
    expect(before.events.length).toBe(20);

    // Compact to keep only 5
    const result = await compact(root, { maxEvents: 5, maxAgeDays: 30 });
    expect(result.compacted).toBe(true);
    expect(result.removed).toBeGreaterThan(0);
    expect(result.after).toBeLessThanOrEqual(6); // 5 retained + 1 summary

    // Verify remaining events are the most recent
    const after = await readCoordLog(root);
    const seqs = after.events.map((e) => e.seq).filter((s) => s >= 0);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]!);
    }
  });

  it("creates archive file on compaction", async () => {
    for (let i = 0; i < 15; i++) {
      await emit(root, {
        from: "agent",
        to: "*",
        type: "task",
        description: `task ${i}`,
      });
    }

    await compact(root, { maxEvents: 3, maxAgeDays: 30 });

    // Check that archive was created
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(join(root, ".handoff"));
    const archives = files.filter((f) => f.endsWith(".archive"));
    expect(archives.length).toBe(1);
  });
});

describe("logSize", () => {
  it("returns zero for empty project", async () => {
    const size = await logSize(root);
    expect(size.events).toBe(0);
    expect(size.bytes).toBe(0);
  });

  it("returns correct counts", async () => {
    await emit(root, {
      from: "a",
      to: "*",
      type: "task",
      description: "hello",
    });
    const size = await logSize(root);
    expect(size.events).toBe(1);
    expect(size.bytes).toBeGreaterThan(0);
  });
});
