import { beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
// Convert to file:// URL so --import works on Windows (D: paths fail as ESM URLs)
const tsxLoader = pathToFileURL(
  resolve("node_modules/tsx/dist/loader.mjs"),
).href;
const entry = resolve("src/cli.ts");

async function runCli(projectRoot: string, ...args: string[]) {
  return execFileAsync(
    process.execPath,
    ["--import", tsxLoader, entry, ...args],
    {
      cwd: projectRoot,
      env: { ...process.env, NO_COLOR: "1" },
    },
  );
}

describe("handoff CLI", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "loadout-cli-handoff-test-"));
  });

  it("creates a context bundle and exposes it in JSON and receiver output", async () => {
    await writeFile(
      join(projectRoot, "auth.ts"),
      "export const auth = true;\n",
    );
    await writeFile(
      join(projectRoot, "types.ts"),
      "export type Id = string;\n",
    );

    const sent = await runCli(
      projectRoot,
      "handoff",
      "codex",
      "write auth tests",
      "--bundle",
      "auth.ts",
      "types.ts",
      "--json",
    );
    const result = JSON.parse(sent.stdout);
    expect(result.message.bundle).toMatchObject({
      schemaVersion: 1,
      fileCount: 2,
      isTruncated: false,
    });
    expect(
      JSON.parse(
        await readFile(join(projectRoot, result.message.bundle.path), "utf8"),
      ).files.map((file: { path: string }) => file.path),
    ).toEqual(["auth.ts", "types.ts"]);

    const inbox = await runCli(projectRoot, "handoff", "codex");
    expect(inbox.stdout).toContain(result.message.bundle.path);
    expect(inbox.stdout).toContain("auth.ts, types.ts");
    expect(inbox.stdout).toMatch(/untrusted project data/i);
  });

  it("does not leave a task or orphan bundle when message validation fails", async () => {
    await writeFile(
      join(projectRoot, "auth.ts"),
      "export const auth = true;\n",
    );

    await expect(
      runCli(
        projectRoot,
        "handoff",
        "codex",
        "write auth tests",
        "--bundle",
        "auth.ts",
        "--from",
        "",
      ),
    ).rejects.toThrow(/invalid handoff message/i);
    expect(
      await readFile(join(projectRoot, ".handoff", "messages.jsonl"), "utf8"),
    ).toBe("");
    expect(await readdir(join(projectRoot, ".handoff", "bundles"))).toEqual([]);
  });

  it("runs an explicit verification argv and records completion evidence", async () => {
    const sent = await runCli(
      projectRoot,
      "handoff",
      "codex",
      "prove completion",
      "--verify",
      "the command prints verified",
      "--verify-command",
      process.execPath,
      "--verify-args",
      JSON.stringify(["-e", 'console.log("verified")']),
      "--verify-timeout",
      "30",
      "--json",
    );
    const task = JSON.parse(sent.stdout).message;
    expect(task.verification).toEqual({
      criteria: "the command prints verified",
      command: {
        executable: process.execPath,
        args: ["-e", 'console.log("verified")'],
        timeoutMs: 30_000,
      },
    });

    const completed = await runCli(
      projectRoot,
      "handoff",
      "--done",
      task.id,
      "--run-verification",
      "--json",
    );
    const outcome = JSON.parse(completed.stdout);
    expect(outcome.completed).toBe(true);
    expect(outcome.message.evidence).toMatchObject({
      mode: "command",
      status: "passed",
      exitCode: 0,
      stdout: "verified\n",
    });
  });

  it("returns failed evidence and keeps the task pending when the check fails", async () => {
    const sent = await runCli(
      projectRoot,
      "handoff",
      "codex",
      "prove failure",
      "--verify",
      "the command exits successfully",
      "--verify-command",
      process.execPath,
      "--verify-args",
      JSON.stringify(["-e", "process.exit(3)"]),
      "--json",
    );
    const task = JSON.parse(sent.stdout).message;

    let failure:
      (Error & { stdout?: string; stderr?: string; code?: number }) | undefined;
    try {
      await runCli(
        projectRoot,
        "handoff",
        "--done",
        task.id,
        "--run-verification",
        "--json",
      );
    } catch (error) {
      failure = error as typeof failure;
    }
    expect(failure?.code).toBe(1);
    const outcome = JSON.parse(failure?.stdout ?? "{}");
    expect(outcome.completed).toBe(false);
    expect(outcome.message.evidence).toMatchObject({
      status: "failed",
      exitCode: 3,
    });

    const inbox = await runCli(projectRoot, "handoff", "codex");
    expect(inbox.stdout).toContain(task.id);
    expect(inbox.stdout).toContain("last verification: failed");
  });

  it("requires and records manual evidence for human-only criteria", async () => {
    const sent = await runCli(
      projectRoot,
      "handoff",
      "codex",
      "review UI",
      "--verify",
      "empty state is readable",
      "--json",
    );
    const task = JSON.parse(sent.stdout).message;

    await expect(
      runCli(projectRoot, "handoff", "--done", task.id),
    ).rejects.toThrow(/requires manual evidence/i);
    const completed = await runCli(
      projectRoot,
      "handoff",
      "--done",
      task.id,
      "--evidence",
      "reviewed mobile and desktop",
      "--json",
    );
    expect(JSON.parse(completed.stdout).message.evidence).toMatchObject({
      mode: "manual",
      status: "passed",
      summary: "reviewed mobile and desktop",
    });
  });

  it("rejects a verification executable without acceptance criteria before setup", async () => {
    await expect(
      runCli(
        projectRoot,
        "handoff",
        "codex",
        "bad task",
        "--verify-command",
        "true",
      ),
    ).rejects.toThrow(/requires --verify/i);
    await expect(
      readFile(join(projectRoot, ".handoff", "messages.jsonl"), "utf8"),
    ).rejects.toThrow();
  });

  it("preserves the existing completion output for tasks without verification", async () => {
    const sent = await runCli(
      projectRoot,
      "handoff",
      "codex",
      "legacy task",
      "--json",
    );
    const task = JSON.parse(sent.stdout).message;

    const completed = await runCli(projectRoot, "handoff", "--done", task.id);
    expect(completed.stdout.trim()).toBe(`Marked ${task.id} done.`);
  });

  it("expands positional template input instead of replacing the template task", async () => {
    const sent = await runCli(
      projectRoot,
      "handoff",
      "codex",
      "src/auth.ts",
      "--template",
      "write-tests",
      "--json",
    );
    expect(JSON.parse(sent.stdout).message.description).toBe(
      "Write tests for src/auth.ts",
    );
  });

  it("applies custom template bundle paths to the handoff", async () => {
    await writeFile(
      join(projectRoot, "auth.ts"),
      "export const auth = true;\n",
    );
    await mkdir(join(projectRoot, ".handoff", "templates"), {
      recursive: true,
    });
    await writeFile(
      join(projectRoot, ".handoff", "templates", "auth-review.json"),
      JSON.stringify({
        name: "auth-review",
        description: "Review auth",
        taskTemplate: "Review {{files}}",
        bundleGlobs: ["auth.ts"],
      }),
    );

    const sent = await runCli(
      projectRoot,
      "handoff",
      "codex",
      "auth.ts",
      "--template",
      "auth-review",
      "--json",
    );
    expect(JSON.parse(sent.stdout).message).toMatchObject({
      description: "Review auth.ts",
      bundle: { fileCount: 1 },
    });
  });
});
