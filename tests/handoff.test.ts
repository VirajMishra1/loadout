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
  readMessagesDetailed,
  sendHandoff,
} from "../src/core/delegation/handoff.js";

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

  it("refuses to settle the same task twice", async () => {
    await initHandoff(projectRoot);
    const msg = await sendHandoff(projectRoot, "codex", "review PR");
    await markDone(projectRoot, msg.id);

    await expect(markDone(projectRoot, msg.id)).rejects.toThrow(
      /already (done|settled)/i,
    );
  });

  it("rejects invalid outbound messages before appending them", async () => {
    await initHandoff(projectRoot);

    await expect(sendHandoff(projectRoot, "", "")).rejects.toThrow(
      /invalid handoff message/i,
    );
    expect(await readMessages(projectRoot)).toEqual([]);
  });

  it("throws when sending without init", async () => {
    await expect(sendHandoff(projectRoot, "codex", "test")).rejects.toThrow(
      /not set up here/i,
    );
  });

  it("formats empty status", async () => {
    const state = await getHandoffState(projectRoot);
    expect(formatHandoffStatus(state)).toMatch(/no handoff log here yet/i);
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
      expect(output).toContain(`loadout handoff --done ${msg.id}`);
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
      expect(written).toContain("loadout handoff codex");
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
      expect(written).toContain("loadout handoff claude-code");
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

describe("handoff resilience", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "loadout-handoff-resilience-"));
    await initHandoff(projectRoot);
  });

  it("keeps good messages when one line is corrupt", async () => {
    await sendHandoff(projectRoot, "codex", "first task");
    await sendHandoff(projectRoot, "codex", "second task");
    const log = join(projectRoot, ".handoff", "messages.jsonl");
    const lines = (await readFile(log, "utf8")).split("\n").filter(Boolean);
    // Truncate the middle line the way a partial write would.
    await writeFile(
      log,
      [lines[0], '{"id":"broken","type":', lines[1]].join("\n") + "\n",
      "utf8",
    );

    const state = await getHandoffState(projectRoot);
    expect(state.pending).toHaveLength(2);
    expect(state.corrupt).toHaveLength(1);
    expect(state.corrupt[0].line).toBe(2);
    expect(formatHandoffStatus(state)).toMatch(/unreadable line/i);
  });

  it.each([
    [
      "missing timestamp",
      {
        id: "bad00001",
        type: "task",
        from: "user",
        to: "codex",
        description: "task",
      },
    ],
    [
      "missing sender",
      {
        id: "bad00002",
        type: "task",
        to: "codex",
        description: "task",
        timestamp: "2026-09-03T12:00:00.000Z",
      },
    ],
    [
      "missing recipient",
      {
        id: "bad00003",
        type: "task",
        from: "user",
        description: "task",
        timestamp: "2026-09-03T12:00:00.000Z",
      },
    ],
    [
      "missing description",
      {
        id: "bad00004",
        type: "task",
        from: "user",
        to: "codex",
        timestamp: "2026-09-03T12:00:00.000Z",
      },
    ],
    [
      "unsupported type",
      {
        id: "bad00005",
        type: "pending",
        from: "user",
        to: "codex",
        description: "task",
        timestamp: "2026-09-03T12:00:00.000Z",
      },
    ],
    [
      "invalid timestamp",
      {
        id: "bad00006",
        type: "task",
        from: "user",
        to: "codex",
        description: "task",
        timestamp: "yesterday",
      },
    ],
    [
      "invalid resolution id",
      {
        id: "bad00007",
        type: "done",
        from: "codex",
        to: "user",
        description: "done",
        resolves: "",
        timestamp: "2026-09-03T12:00:00.000Z",
      },
    ],
  ])("reports a schema-invalid line: %s", async (_label, invalid) => {
    const valid = await sendHandoff(projectRoot, "codex", "valid task");
    const log = join(projectRoot, ".handoff", "messages.jsonl");
    await writeFile(
      log,
      `${JSON.stringify(invalid)}\n${JSON.stringify(valid)}\n`,
      "utf8",
    );

    const result = await readMessagesDetailed(projectRoot);
    expect(result.messages).toEqual([valid]);
    expect(result.corrupt).toHaveLength(1);
    expect(result.corrupt[0].line).toBe(1);
  });

  it("treats an error reply as terminal", async () => {
    const msg = await sendHandoff(projectRoot, "codex", "impossible task");
    await sendHandoff(projectRoot, "user", "cannot do it", {
      from: "codex",
      type: "error",
      resolves: msg.id,
    });
    const state = await getHandoffState(projectRoot);
    expect(state.pending).toHaveLength(0);
  });

  it("treats a cancellation as terminal", async () => {
    const msg = await sendHandoff(projectRoot, "codex", "never mind");
    await sendHandoff(projectRoot, "codex", "withdrawn", {
      type: "cancel",
      resolves: msg.id,
    });
    expect(await readInbox(projectRoot, "codex")).toHaveLength(0);
  });

  it("still honours logs that encode the resolution in context", async () => {
    const msg = await sendHandoff(projectRoot, "codex", "legacy task");
    await sendHandoff(projectRoot, "user", "done", {
      from: "codex",
      type: "done",
      context: `Resolves ${msg.id}`,
    });
    const state = await getHandoffState(projectRoot);
    expect(state.pending).toHaveLength(0);
    expect(state.done).toHaveLength(1);
  });
});
