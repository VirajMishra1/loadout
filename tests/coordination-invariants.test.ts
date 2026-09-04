import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimOwnership,
  checkOwnershipConflicts,
  emit,
  publishContract,
  readCoordLog,
} from "../src/core/coordination/coordinator.js";
import { withCoordinationLock } from "../src/core/coordination/lock.js";

const execFileAsync = promisify(execFile);
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loadout-coord-invariants-"));
});

afterEach(async () => {
  await chmod(join(root, ".handoff", "coordination.jsonl"), 0o600).catch(
    () => undefined,
  );
  await rm(root, { recursive: true, force: true });
});

describe("cross-process coordination", () => {
  it("assigns one ordered sequence across independent writers", async () => {
    const fixture = join(
      process.cwd(),
      "tests",
      "fixtures",
      "coordination-writer.ts",
    );
    await Promise.all(
      Array.from({ length: 5 }, (_, writer) =>
        execFileAsync(
          process.execPath,
          ["--import", "tsx", fixture, root, `writer-${writer}`, "10"],
          { cwd: process.cwd() },
        ),
      ),
    );

    const log = await readCoordLog(root);
    expect(log.corrupt).toEqual([]);
    expect(log.events).toHaveLength(50);
    expect(log.events.map((event) => event.seq)).toEqual(
      Array.from({ length: 50 }, (_, index) => index),
    );
  });
});

describe("coordination invariants", () => {
  it("recovers a malformed lock after its stale threshold", async () => {
    const dir = join(root, ".handoff");
    const lock = join(dir, "coordination.lock");
    await mkdir(dir, { recursive: true });
    await writeFile(lock, "not-json", { mode: 0o600 });
    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);

    await expect(
      withCoordinationLock(dir, async () => "recovered", 100),
    ).resolves.toBe("recovered");
  });

  it("allows only one of two overlapping atomic ownership claims", async () => {
    const attempts = await Promise.allSettled([
      claimOwnership(root, {
        agent: "claude-code",
        paths: ["src/api"],
        mode: "exclusive",
      }),
      claimOwnership(root, {
        agent: "codex",
        paths: ["src/api/users.ts"],
        mode: "exclusive",
      }),
    ]);

    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === "rejected"),
    ).toHaveLength(1);
  });

  it("rejects an acknowledgement beyond the current watermark", async () => {
    await expect(
      emit(root, {
        from: "codex",
        to: "*",
        type: "ack",
        description: "Impossible acknowledgement",
        payload: { eventSeq: 99 },
      }),
    ).rejects.toThrow(/watermark/i);
  });

  it("detects ownership overlap between a directory and its child", async () => {
    await emit(root, {
      from: "claude-code",
      to: "*",
      type: "ownership",
      description: "Claude owns API",
      payload: { paths: ["src/api"], mode: "exclusive" },
    });

    const conflicts = await checkOwnershipConflicts(
      root,
      "codex",
      ["./src/api/users.ts"],
      "exclusive",
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.path).toBe("src/api/users.ts");
  });

  it("allocates unique contract revisions concurrently", async () => {
    const events = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        publishContract(root, {
          from: index % 2 === 0 ? "claude-code" : "codex",
          name: "checkout-api",
          body: `contract-${index}`,
        }),
      ),
    );
    const revisions = events.map(
      (event) => (event.payload as { revision: number }).revision,
    );
    expect([...revisions].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
  });

  it("rejects descriptions larger than the event limit", async () => {
    await expect(
      emit(root, {
        from: "codex",
        to: "*",
        type: "task",
        description: "x".repeat(8_193),
      }),
    ).rejects.toThrow(/description/i);
  });

  it("propagates non-missing log read failures", async () => {
    const dir = join(root, ".handoff");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "coordination.jsonl"), "", "utf8");
    await chmod(join(dir, "coordination.jsonl"), 0o000);

    await expect(readCoordLog(root)).rejects.toBeDefined();
  });
});
