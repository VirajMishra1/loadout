import { describe, expect, it, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  formatHandoffStatus,
  getHandoffState,
  initHandoff,
  isHandoffInitialized,
  markDone,
  readMessages,
  sendHandoff,
} from "../src/core/handoff.js";

describe("handoff", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "loadout-handoff-test-"));
  });

  it("reports uninitialized before init", async () => {
    expect(await isHandoffInitialized(projectRoot)).toBe(false);
  });

  it("initializes the handoff directory", async () => {
    await initHandoff(projectRoot);
    expect(await isHandoffInitialized(projectRoot)).toBe(true);
  });

  it("sends and reads messages", async () => {
    await initHandoff(projectRoot);
    const msg = await sendHandoff(projectRoot, "codex", "write tests", {
      from: "claude-code",
      context: "see auth.ts",
    });
    expect(msg.id).toHaveLength(8);
    expect(msg.to).toBe("codex");
    expect(msg.from).toBe("claude-code");
    expect(msg.type).toBe("task");

    const messages = await readMessages(projectRoot);
    expect(messages).toHaveLength(1);
    expect(messages[0].description).toBe("write tests");
  });

  it("marks a task as done", async () => {
    await initHandoff(projectRoot);
    const msg = await sendHandoff(projectRoot, "codex", "review PR");
    await markDone(projectRoot, msg.id);

    const state = await getHandoffState(projectRoot);
    expect(state.pending).toHaveLength(0);
    expect(state.done).toHaveLength(1);
    expect(state.done[0].id).toBe(msg.id);
  });

  it("throws when sending without init", async () => {
    await expect(
      sendHandoff(projectRoot, "codex", "test"),
    ).rejects.toThrow(/not initialized/i);
  });

  it("formats empty status", async () => {
    const state = await getHandoffState(projectRoot);
    expect(formatHandoffStatus(state)).toContain("not initialized");
  });

  it("formats status with pending tasks", async () => {
    await initHandoff(projectRoot);
    await sendHandoff(projectRoot, "codex", "task one");
    await sendHandoff(projectRoot, "claude-code", "task two");
    const state = await getHandoffState(projectRoot);
    const status = formatHandoffStatus(state);
    expect(status).toContain("Pending (2)");
    expect(status).toContain("codex");
    expect(status).toContain("claude-code");
  });
});
