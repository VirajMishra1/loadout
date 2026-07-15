import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadCatalog,
  loadEffectiveCatalog,
  rankCatalog,
  refreshCatalog,
  selectCatalogPackages,
  validateCatalog,
} from "../src/core/catalog.js";
import type { CatalogPackage } from "../src/shared/types.js";

const packageRecord = (
  id: string,
  tier: CatalogPackage["tier"],
  stars: number,
): CatalogPackage => ({
  id,
  displayName: id,
  repository: `example/${id}`,
  description: id,
  category: "test",
  tier,
  stars,
});

describe("catalog ranking", () => {
  it("prioritizes official packages, then tier, then popularity", () => {
    const ranked = rankCatalog([
      packageRecord("community-popular", "community", 100000),
      packageRecord("stable", "stable", 100),
      packageRecord("official", "official", 1),
      packageRecord("trending", "trending", 1000),
    ]);
    expect(ranked.map((item) => item.id)).toEqual([
      "official",
      "stable",
      "trending",
      "community-popular",
    ]);
  });

  it("selects reviewed, non-archived packages for stable and maximum modes", () => {
    const packages = [
      packageRecord("official", "official", 1),
      packageRecord("stable", "stable", 2),
      packageRecord("trending", "trending", 99),
      { ...packageRecord("archived", "stable", 1000), archived: true },
    ];
    expect(
      selectCatalogPackages(packages, { mode: "stable" }).map((pkg) => pkg.id),
    ).toEqual(["official", "stable"]);
    expect(
      selectCatalogPackages(packages, { mode: "maximum" }).map((pkg) => pkg.id),
    ).toEqual(["official", "stable", "trending"]);
  });

  it("validates custom package ids", () => {
    const packages = [packageRecord("one", "community", 1)];
    expect(
      selectCatalogPackages(packages, {
        mode: "custom",
        packageIds: ["one"],
      })[0].id,
    ).toBe("one");
    expect(() =>
      selectCatalogPackages(packages, {
        mode: "custom",
        packageIds: ["missing"],
      }),
    ).toThrow(/Unknown catalog/);
  });
});

describe("catalog evidence validation", () => {
  const verified = {
    ...packageRecord("verified-package", "stable", 1),
    license: "MIT",
    components: ["skill"] as const,
    operatingSystems: ["windows", "macos", "linux"] as const,
    source: {
      type: "github" as const,
      url: "https://github.com/example/verified-package",
      defaultBranch: "main",
      commit: "a".repeat(40),
      evidencePaths: ["skills/example/SKILL.md"],
      verifiedAt: "2026-07-14T18:17:03Z",
    },
  };

  it("loads the bundled catalog with pinned source, component, platform, and license evidence", async () => {
    const catalog = await loadCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(18);
    for (const item of catalog) {
      expect(item.source?.commit).toMatch(/^[a-f0-9]{40}$/);
      expect(item.source?.url).toBe(`https://github.com/${item.repository}`);
      expect(item.components?.length).toBeGreaterThan(0);
      expect(item.operatingSystems).toEqual(["windows", "macos", "linux"]);
      expect(item.license).toBeTruthy();
    }
  });

  it("rejects invalid catalog records with actionable errors", () => {
    const invalid: Array<{ value: unknown; message: RegExp }> = [
      { value: {}, message: /Catalog must be an array/ },
      { value: [{ ...verified, id: "Not Kebab" }], message: /kebab-case/ },
      {
        value: [{ ...verified, repository: "invalid" }],
        message: /owner\/repository/,
      },
      { value: [{ ...verified, tier: "untrusted" }], message: /tier/ },
      { value: [{ ...verified, stars: -1 }], message: /stars/ },
      {
        value: [{ ...verified, components: ["skill", "skill"] }],
        message: /duplicates/,
      },
      {
        value: [{ ...verified, operatingSystems: ["macos", "beos"] }],
        message: /operatingSystems/,
      },
      {
        value: [
          {
            ...verified,
            source: {
              ...verified.source,
              url: "https://github.com/example/other",
            },
          },
        ],
        message: /source.url/,
      },
      {
        value: [
          { ...verified, source: { ...verified.source, commit: "short" } },
        ],
        message: /full Git SHA/,
      },
      {
        value: [
          {
            ...verified,
            source: { ...verified.source, evidencePaths: ["../escape"] },
          },
        ],
        message: /evidencePaths/,
      },
      {
        value: [{ ...verified, source: undefined }],
        message: /immutable source evidence/,
      },
    ];
    for (const item of invalid)
      expect(() =>
        validateCatalog(item.value, { requireEvidence: true }),
      ).toThrow(item.message);
  });

  it("rejects duplicate package ids and repositories", () => {
    expect(() =>
      validateCatalog([verified, { ...verified, displayName: "Duplicate" }], {
        requireEvidence: true,
      }),
    ).toThrow(/duplicates id/);
    expect(() =>
      validateCatalog([verified, { ...verified, id: "another-package" }], {
        requireEvidence: true,
      }),
    ).toThrow(/duplicates repository/);
  });

  it("reports malformed bundled-style JSON before selection", async () => {
    const directory = await mkdtemp(`${tmpdir()}/loadout-catalog-json-`);
    const path = join(directory, "packages.json");
    try {
      await writeFile(
        path,
        JSON.stringify([
          {
            ...verified,
            source: { ...verified.source, verifiedAt: "not-a-date" },
          },
        ]),
      );
      await expect(loadCatalog(path)).rejects.toThrow(/verifiedAt/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("catalog refresh", () => {
  let home: string;
  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true });
    delete process.env.LOADOUT_HOME;
  });

  it("refreshes API metadata and persists an offline catalog", async () => {
    home = await mkdtemp(`${tmpdir()}/loadout-catalog-`);
    process.env.LOADOUT_HOME = home;
    const result = await refreshCatalog([packageRecord("x", "stable", 1)], {
      fetcher: async () =>
        new Response(
          JSON.stringify({
            stargazers_count: 99,
            description: "live",
            topics: ["agents"],
            open_issues_count: 3,
            archived: false,
            updated_at: "2026-01-02T00:00:00Z",
            pushed_at: "2026-01-03T00:00:00Z",
            default_branch: "main",
          }),
          { status: 200 },
        ),
    });
    expect(result.failures).toHaveLength(0);
    expect(result.catalog[0]).toMatchObject({
      stars: 99,
      description: "live",
      topics: ["agents"],
      openIssues: 3,
    });
    expect((await loadEffectiveCatalog())[0].stars).toBe(99);
  });

  it("keeps the known package when GitHub refresh fails", async () => {
    home = await mkdtemp(`${tmpdir()}/loadout-catalog-`);
    process.env.LOADOUT_HOME = home;
    const result = await refreshCatalog([packageRecord("x", "stable", 7)], {
      fetcher: async () => new Response("rate limited", { status: 429 }),
    });
    expect(result.failures).toHaveLength(1);
    expect(result.catalog[0].stars).toBe(7);
  });

  it("preserves bundled immutable evidence when an older cache only has live metadata", async () => {
    home = await mkdtemp(`${tmpdir()}/loadout-catalog-`);
    process.env.LOADOUT_HOME = home;
    const bundled = await loadCatalog();
    const superpowers = bundled.find((pkg) => pkg.id === "superpowers")!;
    await writeFile(
      join(home, "catalog.json"),
      JSON.stringify([
        {
          id: superpowers.id,
          displayName: superpowers.displayName,
          repository: superpowers.repository,
          description: "cached description",
          category: superpowers.category,
          tier: superpowers.tier,
          stars: 123,
          pushedAt: "2026-07-14T00:00:00Z",
        },
      ]),
    );
    const effective = await loadEffectiveCatalog();
    expect(effective[0]).toMatchObject({
      id: "superpowers",
      stars: 123,
      components: superpowers.components,
      source: superpowers.source,
      license: superpowers.license,
    });
  });
});
