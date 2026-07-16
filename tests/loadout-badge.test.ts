import { describe, expect, it } from "vitest";
import {
  buildLoadoutBadge,
  parseLoadoutBadgeMetric,
} from "../src/core/loadout-badge.js";
import type { LoadoutCard } from "../src/core/loadout-card.js";

const card: LoadoutCard = {
  schemaVersion: 1,
  generatedAt: "2026-07-16T00:00:00.000Z",
  agents: [
    {
      id: "codex",
      health: 70,
      rating: "good",
      evidenceCoverage: 80,
      knownDimensions: 8,
    },
    {
      id: "claude-code",
      health: 50,
      rating: "attention",
      evidenceCoverage: 40,
      knownDimensions: 4,
    },
  ],
  totals: {
    managedPackages: 4,
    activeSkills: 30,
    disabledSkills: 8,
    mcpEntries: 2,
  },
  claimBoundary: "not universal quality",
  privacy: "aggregate only",
};

describe("static Loadout badge endpoint", () => {
  it("renders aggregate evidence with coverage-aware color", () => {
    expect(buildLoadoutBadge(card)).toEqual({
      schemaVersion: 1,
      label: "Loadout evidence",
      message: "60/100 · 60% covered",
      color: "d69e2e",
      cacheSeconds: 3600,
    });
  });

  it("renders inventory metrics without names or telemetry", () => {
    const badge = buildLoadoutBadge(card, "active-skills");
    expect(badge.message).toBe("30");
    expect(JSON.stringify(badge)).not.toMatch(/codex|claude|project|prompt/i);
  });

  it("rejects unsupported metrics", () => {
    expect(() => parseLoadoutBadgeMetric("quality")).toThrow(/--metric/);
  });
});
