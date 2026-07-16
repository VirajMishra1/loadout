import { describe, expect, it } from "vitest";
import type { AgentHealthScore } from "../src/core/agent-health-score.js";
import {
  buildLoadoutCard,
  compareLoadoutReports,
  formatLoadoutCard,
} from "../src/core/loadout-card.js";
import type { PrivacySafeLoadoutReport } from "../src/core/share-report.js";

const report = (activeSkills: number): PrivacySafeLoadoutReport => ({
  schemaVersion: 1,
  generatedAt: "2026-07-16T12:00:00.000Z",
  packages: [
    {
      id: "reviewed-package",
      agents: ["codex"],
      managedFiles: activeSkills,
      activeSkills,
      disabledSkills: 0,
      reviewedSkills: activeSkills,
      unreviewedSkills: 0,
    },
  ],
  mcp: [{ packageId: "reviewed-mcp" }],
  privacy: { excludes: ["paths", "prompts", "secrets"] },
});

const score = {
  schemaVersion: 1,
  policyVersion: "p16-07-v1",
  agent: "codex",
  score: 73,
  maximumScore: 100,
  rating: "good",
  evidenceCoverage: 70,
  knownDimensions: 7,
  dimensions: [],
  limitations: [],
} satisfies AgentHealthScore;

describe("privacy-safe Loadout card", () => {
  it("renders only aggregate evidence and explicit claim boundaries", async () => {
    const card = await buildLoadoutCard({
      report: report(12),
      scores: [score],
      now: new Date("2026-07-16T12:00:00.000Z"),
    });
    const markdown = formatLoadoutCard(card);
    expect(markdown).toContain("12 active skills");
    expect(markdown).toContain("codex | 73/100");
    expect(markdown).toContain("not a universal quality score");
    expect(markdown).not.toMatch(/\/Users\/|secret-project|private-company/i);
  });

  it("compares aggregate reports without inventing quality changes", () => {
    const comparison = compareLoadoutReports(report(4), report(10));
    expect(comparison.delta.activeSkills).toBe(6);
    expect(comparison.delta.managedPackages).toBe(0);
    expect(comparison.boundary).toMatch(/does not rank/);
  });
});
