import { describe, expect, it } from "vitest";
import {
  POWER_SKILL_ALLOWLIST,
  STABLE_BOOST_PACKAGE_IDS,
  STABLE_SKILL_ALLOWLIST,
  catalogTrustStage,
  formatCatalogTrustStage,
  isPowerSkillSelected,
  isStableSkillSelected,
  resolveCatalogProfile,
  type CatalogConflictFamily,
} from "../src/core/profiles.js";
import type { CatalogPackage } from "../src/shared/types.js";

const item = (
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

describe("catalog profile conflict resolution", () => {
  const first = item("first", "stable", 1000);
  const second = item("second", "stable", 10);
  const families: CatalogConflictFamily[] = [
    {
      id: "overlap",
      label: "test overlap",
      severity: "soft",
      packageIds: ["first", "second"],
      rationale: "They overlap.",
    },
  ];

  it("selects one explainable default for Stable Boost", () => {
    const result = resolveCatalogProfile(
      [first, second],
      { mode: "stable" },
      families,
    );
    expect(result.packages.map((pkg) => pkg.id)).toEqual(["first"]);
    expect(result.deferred.map((pkg) => pkg.id)).toEqual(["second"]);
    expect(result.conflicts[0]).toMatchObject({
      defaultPackageId: "first",
      severity: "soft",
    });
    expect(result.warnings.join(" ")).toMatch(
      /Loadout policy selection for Stable chose first/,
    );
  });

  it("keeps an intentional soft overlap in Custom mode with a warning", () => {
    const result = resolveCatalogProfile(
      [first, second],
      { mode: "custom", packageIds: ["first", "second"] },
      families,
    );
    expect(result.packages.map((pkg) => pkg.id)).toEqual(["first", "second"]);
    expect(result.warnings.join(" ")).toMatch(/Custom selection retains/);
  });

  it("blocks every mode when a verified hard family contains multiple choices", () => {
    const hard: CatalogConflictFamily[] = [
      {
        ...families[0],
        severity: "hard",
        rationale: "Their config formats are mutually exclusive.",
      },
    ];
    expect(() =>
      resolveCatalogProfile([first, second], { mode: "stable" }, hard),
    ).toThrow(/Hard conflict.*Remove all but one/i);
    expect(() =>
      resolveCatalogProfile(
        [first, second],
        { mode: "custom", packageIds: ["first", "second"] },
        hard,
      ),
    ).toThrow(/Hard conflict/);
  });

  it("refuses archived records even when explicitly selected", () => {
    expect(() =>
      resolveCatalogProfile(
        [{ ...first, archived: true }],
        { mode: "custom", packageIds: ["first"] },
        [],
      ),
    ).toThrow(/Archived catalog package/);
  });

  it("keeps Stable bounded to the recommended daily-driver sources", () => {
    const superpowers = item("superpowers", "stable", 1000);
    const context7 = item("context7", "stable", 900);
    const addy = item("addyosmani-agent-skills", "stable", 800);
    const agents = item("wshobson-agents", "stable", 700);
    const popularExtra = item("popular-extra", "official", 1_000_000);
    const result = resolveCatalogProfile(
      [popularExtra, agents, addy, context7, superpowers],
      { mode: "stable" },
      [],
    );
    expect(result.packages.map((pkg) => pkg.id)).toEqual([
      "superpowers",
      "context7",
      "addyosmani-agent-skills",
      "wshobson-agents",
    ]);
    expect(STABLE_BOOST_PACKAGE_IDS).toEqual(
      Object.keys(STABLE_SKILL_ALLOWLIST),
    );
    expect(
      Object.values(STABLE_SKILL_ALLOWLIST).reduce(
        (total, skills) => total + skills.length,
        0,
      ),
    ).toBe(30);
    expect(
      isStableSkillSelected(
        "wshobson-agents",
        "code-review-excellence",
        "code-review-excellence",
      ),
    ).toBe(true);
    expect(
      isStableSkillSelected(
        "wshobson-agents",
        "employment-contract-templates",
        "employment-contract-templates",
      ),
    ).toBe(false);
    expect(
      catalogTrustStage({
        ...superpowers,
        license: "MIT",
        source: {
          type: "github",
          url: "https://github.com/example/superpowers",
          defaultBranch: "main",
          commit: "a".repeat(40),
          evidencePaths: ["skills/example/SKILL.md"],
          verifiedAt: "2026-07-16T00:00:00Z",
        },
      }),
    ).toBe("recommended");
    expect(catalogTrustStage(popularExtra)).toBe("discovered");
    expect(formatCatalogTrustStage("recommended")).toBe("policy-selected");
  });

  it("describes Stable as a Loadout policy selection, not an empirical winner", () => {
    const first = item("first", "stable", 1000);
    const second = item("second", "stable", 10);
    const result = resolveCatalogProfile(
      [first, second],
      { mode: "stable" },
      families,
    );
    expect(result.warnings.join(" ")).toContain("Loadout policy selection");
    expect(result.warnings.join(" ")).not.toMatch(/strongest|tested|winner/i);
  });

  it("selects broad Power collections but filters them at skill granularity", () => {
    const superpowers = item("superpowers", "stable", 1000);
    const wshobson = item("wshobson-agents", "stable", 900);
    const unrelated = item("unrelated", "stable", 2000);
    const result = resolveCatalogProfile(
      [unrelated, wshobson, superpowers],
      { mode: "power" },
      [],
    );
    expect(result.packages.map((pkg) => pkg.id)).toEqual([
      "superpowers",
      "wshobson-agents",
    ]);
    expect(Object.keys(POWER_SKILL_ALLOWLIST).length).toBeGreaterThan(5);
    expect(
      isPowerSkillSelected(
        "wshobson-agents",
        "typescript-advanced-types",
        "typescript-advanced-types",
      ),
    ).toBe(true);
    expect(
      isPowerSkillSelected(
        "wshobson-agents",
        "employment-contract-templates",
        "employment-contract-templates",
      ),
    ).toBe(false);
  });
});

describe("mode allowlist integrity (anti-rot guard)", () => {
  // These hardcoded allowlists silently degrade if a catalog package they name
  // is renamed or removed: the mode just installs less, with no error. This
  // guard fails loudly instead. (Skill-name-level rot at a pinned commit needs
  // a network fetch and is checked separately in scripts, not here.)
  const loadBundledCatalog = async (): Promise<CatalogPackage[]> => {
    const { loadCatalog } = await import("../src/core/catalog.js");
    return loadCatalog(
      new URL("../catalog/packages.json", import.meta.url).pathname,
    );
  };

  it("keeps every Stable and Power allowlist package present and installable", async () => {
    const catalog = await loadBundledCatalog();
    const byId = new Map(catalog.map((pkg) => [pkg.id, pkg]));
    for (const [name, allowlist] of [
      ["stable", STABLE_SKILL_ALLOWLIST],
      ["power", POWER_SKILL_ALLOWLIST],
    ] as const) {
      for (const [packageId, skills] of Object.entries(allowlist)) {
        const pkg = byId.get(packageId);
        expect(
          pkg,
          `${name} allowlist package '${packageId}' missing from catalog`,
        ).toBeDefined();
        expect(pkg!.archived ?? false).toBe(false);
        expect(
          skills.length,
          `${name} allowlist for '${packageId}' is empty`,
        ).toBeGreaterThan(0);
        expect(
          new Set(skills).size,
          `${name} allowlist for '${packageId}' has duplicates`,
        ).toBe(skills.length);
      }
    }
  });

  it("only draws Stable from reviewed (stable/official) tiers", async () => {
    const catalog = await loadBundledCatalog();
    const byId = new Map(catalog.map((pkg) => [pkg.id, pkg]));
    for (const packageId of Object.keys(STABLE_SKILL_ALLOWLIST)) {
      const tier = byId.get(packageId)?.tier;
      expect(
        ["stable", "official"],
        `Stable package '${packageId}' has tier '${tier}'`,
      ).toContain(tier);
    }
  });
});
