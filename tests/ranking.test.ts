import { describe, expect, it } from "vitest";
import { explainCatalogScore } from "../src/core/catalog.js";
import type { CatalogPackage } from "../src/shared/types.js";

const base: CatalogPackage = {
  id: "evidenced-package", displayName: "Evidenced Package", repository: "example/evidenced-package", description: "test", category: "test", tier: "stable",
  stars: 1_000_000, license: "MIT", components: ["skill"], operatingSystems: ["windows", "macos", "linux"],
  source: { type: "github", url: "https://github.com/example/evidenced-package", defaultBranch: "main", commit: "a".repeat(40), evidencePaths: ["SKILL.md"], verifiedAt: "2026-01-01T00:00:00Z" }
};

describe("catalog score explanation", () => {
  it("caps and logarithmically scales popularity instead of allowing stars to dominate", () => {
    const score = explainCatalogScore(base, new Date("2026-07-14T00:00:00Z"));
    expect(score.contributions.find((item) => item.factor === "adoption")).toMatchObject({ maximum: 30, points: 30 });
    expect(score.contributions.find((item) => item.factor === "momentum")).toMatchObject({ points: 0, evidence: expect.stringMatching(/single snapshot/) });
    expect(score.guardrails.join(" ")).toMatch(/unrelated tools/);
  });

  it("does not mistake catalog verification or metadata updates for code maintenance", () => {
    const score = explainCatalogScore({ ...base, stars: undefined, pushedAt: undefined, lastUpdatedAt: "2026-07-14T00:00:00Z" }, new Date("2026-07-14T00:00:00Z"));
    expect(score.contributions.find((item) => item.factor === "maintenance")).toMatchObject({ points: 0, evidence: expect.stringMatching(/code-push timestamp/) });
    expect(score.contributions.find((item) => item.factor === "adoption")?.points).toBe(0);
  });
});
