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
      "The trusted upgrade layer for AI coding agents",
    );
    expect(result.stdout).toContain("guide");
    expect(result.stdout).toContain("Start here");
    expect(result.stdout).toContain("status");
    expect(result.stdout).toContain("versions");
    expect(result.stdout).toContain("scan");
    expect(result.stdout).toContain("compare");
    expect(result.stdout).toContain("library");
    expect(result.stdout).toContain("enable");
    expect(result.stdout).toContain("disable");
    expect(result.stdout).toContain("setup");
    expect(result.stdout).toContain("upgrade");
    expect(result.stdout).toContain("doctor");
    expect(result.stdout).toContain("rollback");
    expect(result.stdout).toContain("uninstall");
    expect(result.stdout).toContain("optimize");
    expect(result.stdout).toContain("autopilot");
    expect(result.stdout).toContain("tool");
    expect(result.stdout).not.toContain("registry-serve");
    expect(result.stdout).not.toContain("sandbox-run");
  });

  it("gives beginners one read-only guide while retaining advanced commands", async () => {
    const guide = await runCli("guide");
    expect(guide.code).toBe(0);
    expect(guide.stdout).toContain("START HERE");
    expect(guide.stdout).toContain("loadout setup --mode stable");
    expect(guide.stdout).toContain("loadout mcp-recipe");
    expect(guide.stdout).toContain("Nothing above changes your agents");

    const advanced = await runCli("registry-serve", "--help");
    expect(advanced.code).toBe(0);
    expect(advanced.stdout).toContain("Loadout registry protocol server");
  });

  it("lists reviewed runtime tools without changing the profile", async () => {
    const result = await runCli("tool");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("graphify");
    expect(result.stdout).toContain("Graphify 0.9.17");
  });

  it("distinguishes AI model keys from other service credentials", async () => {
    const result = await runCli("mcp-recipe", "--no-key");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("playwright");
    expect(result.stdout).toContain("chrome-devtools");
    expect(result.stdout).toContain("github-readonly");
    expect(result.stdout).toContain("No AI API key required");
    expect(result.stdout).toContain("GitHub token required");

    const credentialFree = await runCli("mcp-recipe", "--credential-free");
    expect(credentialFree.code).toBe(0);
    expect(credentialFree.stdout).not.toContain("github-readonly");
  });

  it("makes the CLI setup flow the non-interactive default without mutating", async () => {
    const result = await runCli();
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("START HERE");
    expect(result.stdout).toContain("setup --mode stable");
    expect(result.stdout).toContain("Nothing above changes your agents");
  });

  it("rejects an unknown top-level command instead of running onboarding", async () => {
    const result = await runCli("definitely-not-a-command");
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("definitely-not-a-command");
    expect(result.stderr).toContain("--help");
    expect(result.stdout).not.toContain("START HERE");
  });

  it("emits valid JSON when catalog JSON output is requested", async () => {
    const result = await runCli("catalog", "--json");
    expect(result.code).toBe(0);
    const catalog = JSON.parse(result.stdout) as Array<{ id: string }>;
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.some((entry) => entry.id === "superpowers")).toBe(true);
  });

  it("bounds recommendation confidence in machine-readable output", async () => {
    const result = await runCli("recommend", "--project", ".", "--json");
    expect(result.code).toBe(0);
    const output = JSON.parse(result.stdout) as {
      recommendations: Array<{ packageId: string; confidence: string }>;
      recommendationBoundary: Record<string, string>;
    };
    expect(output.recommendations.length).toBeGreaterThan(0);
    expect(output.recommendations[0]).toHaveProperty("confidence");
    expect(output.recommendationBoundary).toEqual({
      selectionMethod: "deterministic-project-signal-rules",
      qualityEvidence: "not-established",
    });
  });

  it("validates setup mode before fetching repositories", async () => {
    const result = await runCli("setup", "--mode", "unknown");
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(
      "--mode must be stable, power, maximum, or custom",
    );
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

  it("previews complete uninstall without deleting anything", async () => {
    const result = await runCli("uninstall");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Complete Loadout uninstall preview");
    expect(result.stdout).toContain("Dry run only");
    expect(result.stdout).toContain("--yes");
  });

  it("can emit structured color-free errors for automation", async () => {
    const result = await runCli("--json-errors", "setup", "--mode", "unknown");
    expect(result.code).not.toBe(0);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "loadout.error",
        message: expect.stringContaining("--mode must be"),
      },
    });
    expect(result.stderr).not.toContain("\u001b[");
  });

  it("plans a keychain-backed model without resolving or printing a secret", async () => {
    const result = await runCli(
      "models",
      "set",
      "--id",
      "coding",
      "--model",
      "openai/gpt-5",
      "--credential-keychain",
      "loadout.openrouter",
      "--credential-account",
      "viraj",
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("os-keychain:loadout.openrouter");
    expect(result.stdout).toContain("Dry run only");
    expect(result.stdout).not.toMatch(/sk-or-|Bearer /);
  });

  it("rejects ambiguous model credential references", async () => {
    const result = await runCli(
      "models",
      "set",
      "--id",
      "coding",
      "--model",
      "openai/gpt-5",
      "--credential-env",
      "OPENROUTER_API_KEY",
      "--credential-keychain",
      "loadout.openrouter",
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Choose either");
  });
});
