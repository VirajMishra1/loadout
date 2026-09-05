import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  formatInboxWithBundles,
  getHandoffState,
  HANDOFF_VERIFICATION_MAX_OUTPUT_BYTES,
  initHandoff,
  markDone,
  readInbox,
  sendHandoff,
} from "../src/core/delegation/handoff.js";
import {
  completeHandoff,
  defaultHandoffVerificationRunner,
} from "../src/core/delegation/handoff-verification.js";

describe("handoff verification", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(
      join(tmpdir(), "loadout-handoff-verification-test-"),
    );
    await initHandoff(projectRoot);
  });

  it("runs literal argv without a shell from the project root", async () => {
    await writeFile(join(projectRoot, "cwd-marker.txt"), "project-root\n");
    const result = await defaultHandoffVerificationRunner(projectRoot, {
      executable: process.execPath,
      args: [
        "-e",
        'console.log(require("node:fs").readFileSync("cwd-marker.txt", "utf8").trim())',
      ],
      timeoutMs: 30_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout.trim()).toBe("project-root");
  });

  it("bounds a real verification process by its configured timeout", async () => {
    const result = await defaultHandoffVerificationRunner(projectRoot, {
      executable: process.execPath,
      args: ["-e", "setTimeout(() => undefined, 10_000)"],
      timeoutMs: 1_000,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.timedOut).toBe(true);
    expect(result.durationMs).toBeLessThan(3_000);
  });

  it("settles a task only after its explicit argv check passes", async () => {
    const task = await sendHandoff(projectRoot, "codex", "write tests", {
      verification: {
        criteria: "the focused test passes",
        command: {
          executable: "npm",
          args: ["test", "--", "tests/auth.test.ts"],
          timeoutMs: 30_000,
        },
      },
    });
    const runner = vi.fn().mockResolvedValue({
      stdout: "1 test passed\n",
      stderr: "",
      exitCode: 0,
      durationMs: 42,
      timedOut: false,
    });

    await expect(
      completeHandoff(projectRoot, task.id, { runner }),
    ).rejects.toThrow(/requires explicit approval/i);
    const outcome = await completeHandoff(projectRoot, task.id, {
      runner,
      approveCommand: true,
    });

    expect(runner).toHaveBeenCalledWith(projectRoot, {
      executable: "npm",
      args: ["test", "--", "tests/auth.test.ts"],
      timeoutMs: 30_000,
    });
    expect(outcome.completed).toBe(true);
    expect(outcome.message.type).toBe("done");
    expect(outcome.message.evidence).toMatchObject({
      mode: "command",
      status: "passed",
      exitCode: 0,
      stdout: "1 test passed\n",
      timedOut: false,
      isTruncated: false,
    });
    expect((await getHandoffState(projectRoot)).pending).toHaveLength(0);
  });

  it("records a failed check as nonterminal and leaves the task pending", async () => {
    const task = await sendHandoff(projectRoot, "codex", "write tests", {
      verification: {
        criteria: "the focused test passes",
        command: {
          executable: "npm",
          args: ["test"],
          timeoutMs: 30_000,
        },
      },
    });

    const outcome = await completeHandoff(projectRoot, task.id, {
      approveCommand: true,
      runner: async () => ({
        stdout: "",
        stderr: "1 test failed\n",
        exitCode: 1,
        durationMs: 50,
        timedOut: false,
      }),
    });

    expect(outcome.completed).toBe(false);
    expect(outcome.message.type).toBe("status");
    expect(outcome.message.resolves).toBe(task.id);
    expect(outcome.message.evidence).toMatchObject({
      mode: "command",
      status: "failed",
      exitCode: 1,
      stderr: "1 test failed\n",
    });
    expect((await getHandoffState(projectRoot)).pending).toEqual([
      expect.objectContaining({ id: task.id }),
    ]);
    const inbox = await formatInboxWithBundles(
      projectRoot,
      "codex",
      await readInbox(projectRoot, "codex"),
    );
    expect(inbox).toContain("last verification: failed");
    expect(inbox).toContain("1 test failed");
  });

  it("requires explicit evidence for human-only acceptance criteria", async () => {
    const task = await sendHandoff(projectRoot, "codex", "review the UI", {
      verification: { criteria: "empty and error states are readable" },
    });

    await expect(completeHandoff(projectRoot, task.id)).rejects.toThrow(
      /requires manual evidence/i,
    );
    const outcome = await completeHandoff(projectRoot, task.id, {
      manualEvidence: "Reviewed empty and error states at mobile and desktop",
    });

    expect(outcome.completed).toBe(true);
    expect(outcome.message.type).toBe("done");
    expect(outcome.message.evidence).toMatchObject({
      mode: "manual",
      status: "passed",
      summary: "Reviewed empty and error states at mobile and desktop",
      isTruncated: false,
    });
    expect((await getHandoffState(projectRoot)).pending).toHaveLength(0);
  });

  it("does not let the legacy completion helper bypass verification", async () => {
    const task = await sendHandoff(projectRoot, "codex", "write tests", {
      verification: { criteria: "the focused test passes" },
    });

    await expect(markDone(projectRoot, task.id)).rejects.toThrow(
      /requires verification/i,
    );
    expect((await getHandoffState(projectRoot)).pending).toHaveLength(1);
  });

  it("redacts and byte-bounds persisted command output", async () => {
    const task = await sendHandoff(projectRoot, "codex", "write tests", {
      verification: {
        criteria: "tests pass",
        command: { executable: "npm", args: ["test"], timeoutMs: 30_000 },
      },
    });
    const secret = "sk-ant-supersecretvalue123456789";

    const outcome = await completeHandoff(projectRoot, task.id, {
      approveCommand: true,
      runner: async () => ({
        stdout: `${secret}\n${"💚".repeat(HANDOFF_VERIFICATION_MAX_OUTPUT_BYTES)}`,
        stderr: "",
        exitCode: 0,
        durationMs: 20,
        timedOut: false,
      }),
    });

    expect(outcome.message.evidence?.stdout).toContain("[REDACTED]");
    expect(outcome.message.evidence?.stdout).not.toContain("supersecretvalue");
    expect(
      Buffer.byteLength(outcome.message.evidence?.stdout ?? ""),
    ).toBeLessThanOrEqual(HANDOFF_VERIFICATION_MAX_OUTPUT_BYTES);
    expect(outcome.message.evidence?.stdout).not.toContain("�");
    expect(outcome.message.evidence?.isTruncated).toBe(true);
  });

  it("allows only one verified completion when two receivers race", async () => {
    const task = await sendHandoff(projectRoot, "codex", "write tests", {
      verification: {
        criteria: "tests pass",
        command: { executable: "npm", args: ["test"], timeoutMs: 30_000 },
      },
    });
    const runner = async () => ({
      stdout: "passed\n",
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });

    // The file lock serializes concurrent calls — the second sees
    // the task already settled and rejects.
    const attempts = await Promise.allSettled([
      completeHandoff(projectRoot, task.id, {
        approveCommand: true,
        runner,
      }),
      completeHandoff(projectRoot, task.id, {
        approveCommand: true,
        runner,
      }),
    ]);

    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      (await getHandoffState(projectRoot)).messages.filter(
        (message) => message.type === "done" && message.resolves === task.id,
      ),
    ).toHaveLength(1);
  });

  it("does not block new handoffs while a verification process runs", async () => {
    const task = await sendHandoff(projectRoot, "codex", "slow verification", {
      verification: {
        criteria: "tests pass",
        command: { executable: "npm", args: ["test"], timeoutMs: 30_000 },
      },
    });
    let releaseRunner!: () => void;
    let announceStarted!: () => void;
    const runnerGate = new Promise<void>((resolve) => {
      releaseRunner = resolve;
    });
    const runnerStarted = new Promise<void>((resolve) => {
      announceStarted = resolve;
    });
    const completion = completeHandoff(projectRoot, task.id, {
      approveCommand: true,
      runner: async () => {
        announceStarted();
        await runnerGate;
        return {
          stdout: "passed\n",
          stderr: "",
          exitCode: 0,
          durationMs: 250,
          timedOut: false,
        };
      },
    });
    await runnerStarted;

    const send = sendHandoff(projectRoot, "claude-code", "parallel task");
    const first = await Promise.race([
      send.then(() => "sent" as const),
      new Promise<"blocked">((resolve) =>
        setTimeout(() => resolve("blocked"), 250),
      ),
    ]);
    releaseRunner();
    await completion;
    await send;

    expect(first).toBe("sent");
  });
});
