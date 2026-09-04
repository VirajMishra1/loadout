import { describe, it, expect } from "vitest";
import { buildReplay, formatReplay } from "../src/core/coordination/replay.js";
import { emit } from "../src/core/coordination/coordinator.js";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function makeTmpProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "loadout-replay-"));
  await mkdir(join(dir, ".handoff"), { recursive: true });
  return dir;
}

describe("replay", () => {
  it("returns empty timeline for empty log", async () => {
    const root = await makeTmpProject();
    try {
      const timeline = await buildReplay(root);
      expect(timeline.entries).toHaveLength(0);
      expect(timeline.agents).toHaveLength(0);
      expect(timeline.totalEvents).toBe(0);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("builds timeline from events", async () => {
    const root = await makeTmpProject();
    try {
      await emit(root, {
        from: "claude-code",
        to: "*",
        type: "task",
        description: "Build auth module",
      });
      await emit(root, {
        from: "codex",
        to: "*",
        type: "ownership",
        description: "codex claims auth/",
        payload: { paths: ["src/auth/"], mode: "exclusive" },
      });
      await emit(root, {
        from: "codex",
        to: "claude-code",
        type: "done",
        description: "Auth module complete",
      });

      const timeline = await buildReplay(root);
      expect(timeline.entries).toHaveLength(3);
      expect(timeline.agents).toContain("claude-code");
      expect(timeline.agents).toContain("codex");
      expect(timeline.totalEvents).toBe(3);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("assigns correct emojis", async () => {
    const root = await makeTmpProject();
    try {
      await emit(root, {
        from: "claude-code",
        to: "*",
        type: "contract",
        description: "api contract",
        payload: { name: "api", revision: 1, body: "v1" },
      });

      const timeline = await buildReplay(root);
      expect(timeline.entries[0].emoji).toBe("📜");
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("renders discussion thread, round, and reply details", async () => {
    const root = await makeTmpProject();
    try {
      await emit(root, {
        from: "claude-code",
        to: "codex",
        type: "discussion",
        description: "Prefer REST",
        payload: {
          threadId: "checkout-design",
          kind: "proposal",
          round: 1,
          role: "proposer",
          content: "Prefer REST because retries are explicit.",
          replyTo: "start-1",
        },
      });

      const timeline = await buildReplay(root);
      expect(timeline.entries[0]).toMatchObject({
        emoji: "💬",
        headline: "Discussion checkout-design · round 1 · proposal",
        detail: "Prefer REST because retries are explicit. (reply to start-1)",
      });
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("formats empty replay", () => {
    const output = formatReplay({
      entries: [],
      agents: [],
      startTime: "",
      endTime: "",
      duration: "0s",
      contractCount: 0,
      ownershipCount: 0,
      totalEvents: 0,
    });
    expect(output).toContain("No coordination events");
  });

  it("formats timeline with entries", async () => {
    const root = await makeTmpProject();
    try {
      await emit(root, {
        from: "claude-code",
        to: "*",
        type: "task",
        description: "Build feature X",
      });
      await emit(root, {
        from: "codex",
        to: "*",
        type: "ack",
        description: "ack",
        payload: { eventSeq: 0 },
      });

      const timeline = await buildReplay(root);
      const output = formatReplay(timeline);
      expect(output).toContain("COORDINATION REPLAY");
      expect(output).toContain("claude-code");
      expect(output).toContain("codex");
      expect(output).toContain("Replay complete");
    } finally {
      await rm(root, { recursive: true });
    }
  });
});
