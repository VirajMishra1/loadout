import { describe, expect, it } from "vitest";
import { proposeImprovements } from "../src/core/improve.js";
import type { HealthReport } from "../src/shared/types.js";

describe("self-improving loop", () => {
  it("prioritizes drift from health evidence and requires review", () => {
    const report: HealthReport = { status: "attention", generatedAt: "now", agents: [], installedPackages: 1, updatesAvailable: 2, driftedFiles: 3, findings: [] };
    const proposals = proposeImprovements(report);
    expect(proposals[0]).toMatchObject({ priority: 100, requiresHumanReview: true });
    expect(proposals[0].evidence[0]).toContain("3 drifted");
  });
});
