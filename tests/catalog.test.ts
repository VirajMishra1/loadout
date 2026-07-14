import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadEffectiveCatalog, rankCatalog, refreshCatalog, selectCatalogPackages } from "../src/core/catalog.js";
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

  it("selects reviewed, non-archived packages for stable and maximum modes", () => {
    const packages = [
      packageRecord("official", "official", 1),
      packageRecord("stable", "stable", 2),
      packageRecord("trending", "trending", 99),
      { ...packageRecord("archived", "stable", 1000), archived: true }
    ];
    expect(selectCatalogPackages(packages, { mode: "stable" }).map((pkg) => pkg.id)).toEqual(["official", "stable"]);
    expect(selectCatalogPackages(packages, { mode: "maximum" }).map((pkg) => pkg.id)).toEqual(["official", "stable", "trending"]);
  });

  it("validates custom package ids", () => {
    const packages = [packageRecord("one", "community", 1)];
    expect(selectCatalogPackages(packages, { mode: "custom", packageIds: ["one"] })[0].id).toBe("one");
    expect(() => selectCatalogPackages(packages, { mode: "custom", packageIds: ["missing"] })).toThrow(/Unknown catalog/);
  });
});

describe("catalog refresh", () => {
  let home: string;
  afterEach(async () => { if (home) await rm(home, { recursive: true, force: true }); delete process.env.LOADOUT_HOME; });

  it("refreshes API metadata and persists an offline catalog", async () => {
    home = await mkdtemp(`${tmpdir()}/loadout-catalog-`); process.env.LOADOUT_HOME = home;
    const result = await refreshCatalog([packageRecord("x", "stable", 1)], {
      fetcher: async () => new Response(JSON.stringify({ stargazers_count: 99, description: "live", topics: ["agents"], open_issues_count: 3, archived: false, updated_at: "2026-01-02T00:00:00Z", pushed_at: "2026-01-03T00:00:00Z", default_branch: "main" }), { status: 200 })
    });
    expect(result.failures).toHaveLength(0);
    expect(result.catalog[0]).toMatchObject({ stars: 99, description: "live", topics: ["agents"], openIssues: 3 });
    expect((await loadEffectiveCatalog())[0].stars).toBe(99);
  });

  it("keeps the known package when GitHub refresh fails", async () => {
    home = await mkdtemp(`${tmpdir()}/loadout-catalog-`); process.env.LOADOUT_HOME = home;
    const result = await refreshCatalog([packageRecord("x", "stable", 7)], { fetcher: async () => new Response("rate limited", { status: 429 }) });
    expect(result.failures).toHaveLength(1);
    expect(result.catalog[0].stars).toBe(7);
  });
});
