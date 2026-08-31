import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BUCKETS,
  defaultPolicy,
  findModel,
  formatAnswer,
  formatPolicy,
  guessBucket,
  policyPath,
  readPolicy,
  resolveRoute,
  setRule,
  validatePolicy,
  writePolicy,
} from "../src/core/routing/policy.js";

describe("routing policy", () => {
  let home: string;
  const original = process.env.LOADOUT_HOME;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "loadout-policy-"));
    process.env.LOADOUT_HOME = home;
  });
  afterEach(async () => {
    if (original === undefined) delete process.env.LOADOUT_HOME;
    else process.env.LOADOUT_HOME = original;
    await rm(home, { recursive: true, force: true });
  });

  it("defaults to Opus for hard work and Sonnet for ordinary work", () => {
    const policy = defaultPolicy(["claude-code", "codex"]);
    expect(policy.rules.hard).toBe("claude-opus-5");
    expect(policy.rules.normal).toBe("claude-sonnet-5");
    expect(policy.rules.cheap).toBe("gpt-5.6-luna");
  });

  it("does not default to a Codex model when Codex is absent", () => {
    const policy = defaultPolicy(["claude-code"]);
    expect(findModel(policy.rules.cheap)!.nativeAgents).toContain(
      "claude-code",
    );
  });

  it("rejects a policy naming a model that does not exist", () => {
    expect(() =>
      validatePolicy({
        version: 1,
        rules: {
          hard: "gpt-9",
          normal: "claude-sonnet-5",
          cheap: "claude-sonnet-5",
        },
      }),
    ).toThrow(/unknown model/i);
  });

  it("rejects a policy missing a bucket", () => {
    expect(() =>
      validatePolicy({ version: 1, rules: { hard: "claude-opus-5" } }),
    ).toThrow(/missing a model/i);
  });

  it("falls back to defaults when no policy file exists", async () => {
    const { source } = await readPolicy(["claude-code"]);
    expect(source).toBe("default");
  });

  it("round-trips a saved policy", async () => {
    await writePolicy(defaultPolicy(["claude-code", "codex"]));
    const { policy, source } = await readPolicy();
    expect(source).toBe("file");
    expect(policy.rules.hard).toBe("claude-opus-5");
    expect(await readFile(policyPath(), "utf8")).toContain("claude-opus-5");
  });

  it("persists a single changed rule", async () => {
    const updated = await setRule("cheap", "claude-sonnet-5", ["claude-code"]);
    expect(updated.rules.cheap).toBe("claude-sonnet-5");
    const { policy } = await readPolicy();
    expect(policy.rules.cheap).toBe("claude-sonnet-5");
    // Unchanged buckets survive.
    expect(policy.rules.hard).toBe("claude-opus-5");
  });

  it("refuses to set an unknown model", async () => {
    await expect(setRule("hard", "not-a-model")).rejects.toThrow(
      /unknown model/i,
    );
  });

  it.each([
    ["add stripe webhook signature verification", "hard"],
    ["migrate the users table", "hard"],
    ["fix the session auth bug", "hard"],
    ["write unit tests for the parser", "cheap"],
    ["update the readme", "cheap"],
    ["rename a variable", "cheap"],
    ["add a loading spinner", "normal"],
    ["build the settings page", "normal"],
  ])("guesses %s as %s", (task, expected) => {
    expect(guessBucket(task)).toBe(expected);
  });

  it("names a reachable alternative when the policy model cannot run", () => {
    const policy = defaultPolicy(["claude-code", "codex"]);
    const answer = resolveRoute(policy, "cheap", ["claude-code"], false);
    expect(answer.unavailable).toBeDefined();
    expect(answer.unavailable!.fallback!.nativeAgents).toContain("claude-code");
    expect(formatAnswer(answer)).toMatch(/not installed/i);
  });

  it("says nothing about availability when the model is reachable", () => {
    const policy = defaultPolicy(["claude-code", "codex"]);
    const answer = resolveRoute(policy, "hard", ["claude-code"], false);
    expect(answer.unavailable).toBeUndefined();
  });

  it("admits when the bucket was guessed", () => {
    const policy = defaultPolicy([]);
    expect(formatAnswer(resolveRoute(policy, "normal", [], true))).toMatch(
      /guessed/i,
    );
    expect(formatAnswer(resolveRoute(policy, "normal", [], false))).not.toMatch(
      /guessed/i,
    );
  });

  it("covers every bucket in the formatted policy", () => {
    const output = formatPolicy(defaultPolicy([]), "default");
    for (const bucket of BUCKETS) expect(output).toContain(bucket);
  });
});
