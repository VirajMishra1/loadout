import { describe, expect, it } from "vitest";
import { rankCatalog } from "../src/core/catalog.js";
import type { CatalogPackage } from "../src/shared/types.js";

const packageRecord = (id: string, tier: CatalogPackage["tier"], stars: number): CatalogPackage => ({
  id, displayName: id, repository: `example/${id}`, description: id, category: "test", tier, stars
});

describe("catalog ranking", () => {
  it("prioritizes official packages, then tier, then popularity", () => {
    const ranked = rankCatalog([
      packageRecord("community-popular", "community", 100000),
      packageRecord("stable", "stable", 100),
      packageRecord("official", "official", 1),
      packageRecord("trending", "trending", 1000)
    ]);
    expect(ranked.map((item) => item.id)).toEqual(["official", "stable", "trending", "community-popular"]);
  });
});
