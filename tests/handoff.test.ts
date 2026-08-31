import { describe, expect, it, beforeEach } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  agentContextFile,
  applyPickup,
  formatHandoffStatus,
  formatInbox,
  getHandoffState,
  initHandoff,
  isHandoffInitialized,
  markDone,
  planPickup,
  readInbox,
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
    await expect(sendHandoff(projectRoot, "codex", "test")).rejects.toThrow(
      /not initialized/i,
    );
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

  describe("inbox", () => {
    it("returns only tasks addressed to the given agent", async () => {
      await initHandoff(projectRoot);
      await sendHandoff(projectRoot, "codex", "codex task");
      await sendHandoff(projectRoot, "claude-code", "claude task");

      const codexInbox = await readInbox(projectRoot, "codex");
      expect(codexInbox).toHaveLength(1);
      expect(codexInbox[0].description).toBe("codex task");
    });

    it("drops a task from the inbox once it is marked done", async () => {
      await initHandoff(projectRoot);
      const msg = await sendHandoff(projectRoot, "codex", "finish me");
      expect(await readInbox(projectRoot, "codex")).toHaveLength(1);
      await markDone(projectRoot, msg.id);
      expect(await readInbox(projectRoot, "codex")).toHaveLength(0);
    });

    it("renders the done command for each pending task", async () => {
      await initHandoff(projectRoot);
      const msg = await sendHandoff(projectRoot, "codex", "write tests", {
        context: "see auth.ts",
      });
      const output = formatInbox(
        "codex",
        await readInbox(projectRoot, "codex"),
      );
      expect(output).toContain("write tests");
      expect(output).toContain("context: see auth.ts");
      expect(output).toContain(`loadout handoff done ${msg.id}`);
    });

    it("reports an empty inbox plainly", () => {
      expect(formatInbox("codex", [])).toContain("No pending handoff tasks");
    });
  });

  describe("pickup", () => {
    it("maps agents to their context files", () => {
      expect(agentContextFile("claude-code")).toBe("CLAUDE.md");
      expect(agentContextFile("codex")).toBe("AGENTS.md");
      expect(() => agentContextFile("cursor")).toThrow(/No known context file/);
    });

    it("creates a context file that does not exist yet", async () => {
      const plan = await planPickup(projectRoot, "codex");
      expect(plan.exists).toBe(false);
      expect(plan.replacing).toBe(false);
      await applyPickup(plan);
      const written = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
      expect(written).toContain("loadout handoff inbox codex");
    });

    it("appends to an existing context file without losing content", async () => {
      await writeFile(
        join(projectRoot, "CLAUDE.md"),
        "# My Project\n\nExisting instructions.\n",
        "utf8",
      );
      const plan = await planPickup(projectRoot, "claude-code");
      expect(plan.exists).toBe(true);
      expect(plan.replacing).toBe(false);
      await applyPickup(plan);
      const written = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
      expect(written).toContain("Existing instructions.");
      expect(written).toContain("loadout handoff inbox claude-code");
    });

    it("replaces the managed block instead of duplicating it", async () => {
      await writeFile(join(projectRoot, "CLAUDE.md"), "# Keep me\n", "utf8");
      await applyPickup(await planPickup(projectRoot, "claude-code"));
      const second = await planPickup(projectRoot, "claude-code");
      expect(second.replacing).toBe(true);
      await applyPickup(second);

      const written = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
      expect(written.match(/loadout:handoff:start/g)).toHaveLength(1);
      expect(written).toContain("# Keep me");
    });

    it("preserves user content written after the managed block", async () => {
      await writeFile(join(projectRoot, "CLAUDE.md"), "# Top\n", "utf8");
      await applyPickup(await planPickup(projectRoot, "claude-code"));
      const withTrailer = `${await readFile(join(projectRoot, "CLAUDE.md"), "utf8")}\n## Notes after\n`;
      await writeFile(join(projectRoot, "CLAUDE.md"), withTrailer, "utf8");

      await applyPickup(await planPickup(projectRoot, "claude-code"));
      const written = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
      expect(written).toContain("# Top");
      expect(written).toContain("## Notes after");
      expect(written.match(/loadout:handoff:start/g)).toHaveLength(1);
    });
  });
});
