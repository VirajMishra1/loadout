import { beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import {
  completionCommands,
  completionCommandPaths,
  parseCompletionShell,
  registerCompletionCommands,
  renderShellCompletion,
} from "../src/core/reporting/completion.js";

const exec = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "..");
const SHELLS = ["bash", "zsh", "fish", "powershell"] as const;

/** The command list a generated completion script advertises. */
async function advertisedCommands(): Promise<string[]> {
  const { stdout } = await exec(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", "completion", "bash"],
    { cwd: repositoryRoot, env: { ...process.env, NO_COLOR: "1" } },
  );
  return (
    /commands="([^"]*)"/.exec(stdout)?.[1].split(/\s+/).filter(Boolean) ?? []
  );
}

/** Commands visible on the CLI's first help screen. */
async function actualCommands(): Promise<string[]> {
  const { stdout } = await exec(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", "--help"],
    { cwd: repositoryRoot, env: { ...process.env, NO_COLOR: "1" } },
  );
  return [
    ...new Set(
      stdout
        .split("\n")
        .flatMap((line) => /^ {2}([a-z][a-z-]*)/.exec(line)?.[1] ?? []),
    ),
  ];
}

describe("CLI completion", () => {
  beforeEach(() => {
    // The registry is populated by cli.ts at startup; unit tests drive it
    // directly so rendering can be checked without spawning a process.
    registerCompletionCommands([
      { name: "setup", subcommands: [] },
      {
        name: "candidate",
        subcommands: ["list", "inspect", "propose"],
      },
      {
        name: "models",
        subcommands: ["status", "set", "verify"],
      },
      {
        name: "skills",
        subcommands: ["list", "install", "remove"],
      },
    ]);
  });

  it("renders an installable script for every supported shell", () => {
    for (const shell of SHELLS) {
      const script = renderShellCompletion(shell);
      expect(script).toContain("loadout");
      expect(script).toContain("setup");
      expect(script).toContain("candidate");
    }
  });

  it("includes the subcommands of a parent command", () => {
    for (const shell of SHELLS) {
      const script = renderShellCompletion(shell);
      expect(script).toContain("propose");
      expect(script).toContain("verify");
      expect(script).toContain("install");
      expect(script).toContain("remove");
    }
  });

  it("exposes every registered parent and child as a complete command path", () => {
    expect(completionCommandPaths()).toEqual(
      expect.arrayContaining([
        "candidate",
        "candidate inspect",
        "models verify",
        "skills install",
        "skills remove",
      ]),
    );
  });

  it("renders only what the registry holds", () => {
    registerCompletionCommands([{ name: "setup", subcommands: [] }]);
    for (const shell of SHELLS) {
      const script = renderShellCompletion(shell);
      // Shell templates name `candidate` structurally, so check the generated
      // command list rather than the whole script.
      const listed = /commands=\(([^)]*)\)|commands="([^"]*)"/.exec(script);
      expect(`${listed?.[1] ?? ""}${listed?.[2] ?? ""}`).not.toContain(
        "candidate",
      );
    }
  });

  it("drops the built-in help command", () => {
    registerCompletionCommands([
      { name: "setup", subcommands: [] },
      { name: "help", subcommands: [] },
    ]);
    expect(completionCommands()).toEqual(["setup"]);
  });

  it("parses supported shell names and rejects others", () => {
    for (const shell of SHELLS) expect(parseCompletionShell(shell)).toBe(shell);
    expect(() => parseCompletionShell("tcsh")).toThrow();
  });

  // The contract that matters: completions describe the real CLI. This
  // previously drifted, advertising pack, publish, and sandbox-run for a
  // release after those commands were removed.
  it("advertises every command the CLI registers, including hidden ones", async () => {
    const advertised = await advertisedCommands();
    // `--help` lists only the first-screen commands; hidden ones are still
    // real and should complete, so the advertised set is a superset.
    for (const visible of await actualCommands())
      expect(
        advertised,
        `${visible} is registered but not advertised`,
      ).toContain(visible);
    // Hidden but registered commands must be there too.
    for (const hidden of ["candidate", "models", "mcp-recipe", "autopilot"])
      expect(advertised).toContain(hidden);
  }, 30_000);

  it("never advertises a retired command", async () => {
    const advertised = await advertisedCommands();
    for (const retired of [
      "pack",
      "publish",
      "compare",
      "sandbox-run",
      "serve",
      "capabilities",
      "outcomes",
      "badge",
      "canary",
    ])
      expect(advertised, `${retired} was removed`).not.toContain(retired);
  }, 30_000);

  it("prints machine-readable full command paths for documentation tooling", async () => {
    const { stdout } = await exec(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "completion", "--commands-json"],
      { cwd: repositoryRoot, env: { ...process.env, NO_COLOR: "1" } },
    );
    const paths = JSON.parse(stdout) as string[];
    expect(paths).toContain("skills install");
    expect(paths).toContain("candidate inspect");
    expect(paths).not.toContain("loadout-router");
  });
});
