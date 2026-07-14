import { describe, expect, it } from "vitest";
import { resolveCatalogProfile, type CatalogConflictFamily } from "../src/core/profiles.js";
import type { CatalogPackage } from "../src/shared/types.js";

const item = (id: string, tier: CatalogPackage["tier"], stars: number): CatalogPackage => ({ id, displayName: id, repository: `example/${id}`, description: id, category: "test", tier, stars });

describe("catalog profile conflict resolution", () => {
  const first = item("first", "stable", 1000);
  const second = item("second", "stable", 10);
  const families: CatalogConflictFamily[] = [{ id: "overlap", label: "test overlap", severity: "soft", packageIds: ["first", "second"], rationale: "They overlap." }];

  it("selects one explainable default for Stable Boost", () => {
    const result = resolveCatalogProfile([first, second], { mode: "stable" }, families);
    expect(result.packages.map((pkg) => pkg.id)).toEqual(["first"]);
    expect(result.deferred.map((pkg) => pkg.id)).toEqual(["second"]);
    expect(result.conflicts[0]).toMatchObject({ defaultPackageId: "first", severity: "soft" });
    expect(result.warnings.join(" ")).toMatch(/Stable Boost selected first/);
  });

  it("keeps an intentional soft overlap in Custom mode with a warning", () => {
    const result = resolveCatalogProfile([first, second], { mode: "custom", packageIds: ["first", "second"] }, families);
    expect(result.packages.map((pkg) => pkg.id)).toEqual(["first", "second"]);
    expect(result.warnings.join(" ")).toMatch(/Custom selection retains/);
  });

  it("blocks every mode when a verified hard family contains multiple choices", () => {
    const hard: CatalogConflictFamily[] = [{ ...families[0], severity: "hard", rationale: "Their config formats are mutually exclusive." }];
    expect(() => resolveCatalogProfile([first, second], { mode: "stable" }, hard)).toThrow(/Hard conflict.*Remove all but one/i);
    expect(() => resolveCatalogProfile([first, second], { mode: "custom", packageIds: ["first", "second"] }, hard)).toThrow(/Hard conflict/);
  });

  it("refuses archived records even when explicitly selected", () => {
    expect(() => resolveCatalogProfile([{ ...first, archived: true }], { mode: "custom", packageIds: ["first"] }, [])).toThrow(/Archived catalog package/);
  });
});
