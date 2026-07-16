import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/core/catalog.js";
import {
  buildCatalogCoverage,
  formatCatalogCoverage,
} from "../src/core/catalog-coverage.js";

describe("catalog capability coverage", () => {
  it("reports the bundled evidence, capability, and overlap truth", async () => {
    const catalog = await loadCatalog();
    const report = buildCatalogCoverage(catalog);
    expect(report.records).toBe(catalog.length);
    expect(report.fullyReviewedRecords).toBe(catalog.length);
    expect(report.immutablePins).toBe(catalog.length);
    expect(report.operatingSystems).toMatchObject({
      windows: catalog.length,
      macos: catalog.length,
      linux: catalog.length,
    });
    expect(report.components.skill).toBeGreaterThan(0);
    expect(report.components.mcp).toBeGreaterThan(0);
    expect(formatCatalogCoverage(report)).toContain("immutable pins");
  });

  it("keeps missing activity and NOASSERTION licenses explicit", () => {
    const report = buildCatalogCoverage([
      {
        id: "example",
        displayName: "Example",
        repository: "owner/example",
        description: "Example",
        category: "testing",
        tier: "community",
        license: "NOASSERTION",
        components: ["skill"],
        operatingSystems: ["windows", "macos", "linux"],
        source: {
          type: "github",
          url: "https://github.com/owner/example",
          defaultBranch: "main",
          commit: "a".repeat(40),
          evidencePaths: ["SKILL.md"],
          verifiedAt: "2026-07-16T00:00:00Z",
        },
      },
    ]);
    expect(report).toMatchObject({
      records: 1,
      fullyReviewedRecords: 1,
      assertedLicenses: 0,
      noAssertionLicenses: 1,
      activityObserved: 0,
    });
  });
});
