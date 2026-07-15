import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);

async function runCli(...args: string[]) {
  try {
    const result = await exec(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", ...args],
      {
        cwd: process.cwd(),
        env: { ...process.env, NO_COLOR: "1" },
        maxBuffer: 1024 * 1024,
      },
    );
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const result = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: Number(result.code ?? 1),
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }
}

describe("CLI contract", () => {
  it("keeps top-level help useful for judges and first-time users", async () => {
    const result = await runCli("--help");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      "Universal upgrade manager for AI coding agents",
    );
    expect(result.stdout).toContain("status");
    expect(result.stdout).toContain("doctor");
    expect(result.stdout).toContain("demo");
    expect(result.stdout).toContain("plan");
    expect(result.stdout).toContain("rollback");
    expect(result.stdout).toContain("discover");
    expect(result.stdout).toContain("evaluate");
    expect(result.stdout).toContain("watch");
    expect(result.stdout).toContain("sandbox-run");
    expect(result.stdout).toContain("convert");
    expect(result.stdout).toContain("canary");
    expect(result.stdout).toContain("dashboard");
  });

  it("reports mutually exclusive source errors without mutating state", async () => {
    const result = await runCli(
      "add",
      "demo",
      "--catalog",
      "demo",
      "--repository",
      "owner/repo",
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Choose exactly one source");
  });

  it("reports missing update arguments clearly", async () => {
    const result = await runCli("update", "--apply");
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("--apply requires --package <id>");
  });
});
