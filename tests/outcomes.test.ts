import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  outcomeAdjustment,
  readLocalOutcomes,
  recordLocalOutcome,
} from "../src/core/outcomes.js";

describe("privacy-safe local outcomes", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("stores only scoped selectors and adjusts only the same agent/task", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-outcomes-"));
    process.env.LOADOUT_HOME = root;
    await recordLocalOutcome(
      {
        selector: "collection/test-skill",
        agent: "codex",
        taskFamily: "testing",
        result: "success",
      },
      new Date("2026-07-15T00:00:00Z"),
    );
    await recordLocalOutcome(
      {
        selector: "collection/test-skill",
        agent: "codex",
        taskFamily: "testing",
        result: "reject",
      },
      new Date("2026-07-15T01:00:00Z"),
    );
    const store = await readLocalOutcomes();
    expect(store.events[0]).toEqual({
      id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      recordedAt: "2026-07-15T00:00:00.000Z",
      selector: "collection/test-skill",
      agent: "codex",
      taskFamily: "testing",
      result: "success",
    });
    expect(
      outcomeAdjustment(store, "collection/test-skill", "codex", ["testing"])
        .score,
    ).toBe(-15);
    expect(
      outcomeAdjustment(store, "collection/test-skill", "claude-code", [
        "testing",
      ]).score,
    ).toBe(0);
    expect(
      outcomeAdjustment(store, "collection/test-skill", "codex", ["python"])
        .score,
    ).toBe(0);
  });

  it("serializes concurrent outcome writes without losing events", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-outcomes-concurrent-"));
    process.env.LOADOUT_HOME = root;
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        recordLocalOutcome({
          selector: `collection/skill-${index}`,
          agent: "codex",
          taskFamily: "general",
          result: "success",
        }),
      ),
    );
    const store = await readLocalOutcomes();
    expect(store.events).toHaveLength(12);
    expect(new Set(store.events.map((event) => event.id)).size).toBe(12);
  });

  it("rejects paths instead of storing them as selectors", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-outcomes-path-"));
    process.env.LOADOUT_HOME = root;
    await expect(
      recordLocalOutcome({
        selector: "/Users/person/project/SKILL.md",
        agent: "codex",
        taskFamily: "general",
        result: "accept",
      }),
    ).rejects.toThrow(/package\/skill/);
  });
});
