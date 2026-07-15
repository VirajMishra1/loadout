import { describe, expect, it } from "vitest";
import { compileConversion } from "../src/core/conversion.js";

describe("loss-reported static conversion", () => {
  it("converts a subagent prompt into a reviewable Codex skill", () => {
    const result = compileConversion(
      {
        kind: "subagent",
        name: "Review Agent",
        body: "Inspect the diff and list regressions.",
        metadata: { model: "premium", tools: "shell" },
      },
      "codex-skill",
    );
    expect(result.relativePath).toBe("skills/review-agent/SKILL.md");
    expect(result.content).toContain("Inspect the diff");
    expect(result.dropped.length).toBeGreaterThan(1);
    expect(result.requiresApproval).toBe(true);
  });

  it("turns a hook into a non-executable review artifact", () => {
    const result = compileConversion(
      { kind: "hook", name: "pre-commit", body: "run the checks" },
      "static-review",
    );
    expect(result.relativePath).toContain("conversion-reports");
    expect(result.content).not.toContain("#!/bin/");
    expect(result.dropped[0]?.field).toContain("execution");
  });
});
