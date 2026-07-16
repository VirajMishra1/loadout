import type { CatalogPackage } from "../shared/types.js";
import type { InstallSelection, InstallSelectionMode } from "./catalog.js";
import { compareCatalogPackages } from "./ranking.js";

export interface CatalogConflictFamily {
  id: string;
  label: string;
  severity: "soft" | "hard";
  packageIds: string[];
  rationale: string;
}

export interface ProfileConflict {
  familyId: string;
  severity: CatalogConflictFamily["severity"];
  packageIds: string[];
  defaultPackageId?: string;
  message: string;
}

export interface ProfileResolution {
  mode: InstallSelectionMode;
  packages: CatalogPackage[];
  deferred: CatalogPackage[];
  conflicts: ProfileConflict[];
  warnings: string[];
}

/**
 * Stable is Loadout's recommended daily driver: broad enough to improve normal
 * engineering work immediately, but bounded at skill granularity and restricted
 * to catalog sources with an identified SPDX license. Maximum remains the
 * explicit broad-library mode.
 */
export const STABLE_SKILL_ALLOWLIST: Readonly<
  Record<string, readonly string[]>
> = {
  superpowers: [
    "executing-plans",
    "receiving-code-review",
    "requesting-code-review",
    "test-driven-development",
    "verification-before-completion",
    "writing-plans",
  ],
  context7: ["context7-cli", "context7-mcp", "find-docs"],
  "addyosmani-agent-skills": [
    "context-engineering",
    "documentation-and-adrs",
    "frontend-ui-engineering",
    "git-workflow-and-versioning",
    "observability-and-instrumentation",
    "performance-optimization",
  ],
  "wshobson-agents": ["architecture-patterns", "code-review-excellence"],
} as const;

export const STABLE_BOOST_PACKAGE_IDS = Object.freeze(
  Object.keys(STABLE_SKILL_ALLOWLIST),
);

export type CatalogTrustStage =
  "discovered" | "inspected" | "human-reviewed" | "benchmarked" | "recommended";

/**
 * Trust is deliberately separate from popularity and publisher tier. No
 * bundled record is labelled human-reviewed or benchmarked until that evidence
 * is actually stored; Stable is the policy-recommended subset.
 */
export function catalogTrustStage(pkg: CatalogPackage): CatalogTrustStage {
  if (
    STABLE_BOOST_PACKAGE_IDS.includes(pkg.id) &&
    pkg.license &&
    pkg.license !== "NOASSERTION" &&
    pkg.source?.commit &&
    !pkg.archived
  )
    return "recommended";
  if (pkg.source?.commit && pkg.source.evidencePaths.length) return "inspected";
  return "discovered";
}

export function isStableSkillSelected(
  packageId: string,
  skillName: string | undefined,
  targetName: string,
): boolean {
  const selected = STABLE_SKILL_ALLOWLIST[packageId];
  if (!selected) return true;
  return (
    selected.includes(skillName ?? targetName) || selected.includes(targetName)
  );
}

/**
 * Broad daily-driver capabilities selected at skill granularity. Collection
 * repositories stay available in full through Maximum Library, while Power
 * activates only skills with a clear cross-project job.
 */
export const POWER_SKILL_ALLOWLIST: Readonly<
  Record<string, readonly string[]>
> = {
  superpowers: [
    "brainstorming",
    "dispatching-parallel-agents",
    "executing-plans",
    "finishing-a-development-branch",
    "receiving-code-review",
    "requesting-code-review",
    "subagent-driven-development",
    "systematic-debugging",
    "test-driven-development",
    "using-git-worktrees",
    "using-superpowers",
    "verification-before-completion",
    "writing-plans",
    "writing-skills",
  ],
  context7: ["context7-cli", "context7-docs", "context7-mcp", "find-docs"],
  "anthropic-skills": [
    "docx",
    "frontend-design",
    "mcp-builder",
    "pdf",
    "web-artifacts-builder",
    "webapp-testing",
  ],
  "openai-skills": [
    "cli-creator",
    "figma-implement-design",
    "gh-fix-ci",
    "imagegen",
    "openai-docs",
    "playwright",
    "screenshot",
    "security-best-practices",
  ],
  "vercel-agent-skills": [
    "deploy-to-vercel",
    "vercel-composition-patterns",
    "vercel-optimize",
    "vercel-react-best-practices",
    "web-design-guidelines",
  ],
  "ui-ux-pro-max": ["design-system", "slides", "ui-styling", "ui-ux-pro-max"],
  "wshobson-agents": [
    "accessibility-compliance",
    "api-design-principles",
    "architecture-patterns",
    "code-review-excellence",
    "debugging-strategies",
    "e2e-testing-patterns",
    "modern-javascript-patterns",
    "python-testing-patterns",
    "python-type-safety",
    "typescript-advanced-types",
  ],
  "awesome-copilot": [
    "acquire-codebase-knowledge",
    "chrome-devtools",
    "create-implementation-plan",
    "github-actions-hardening",
    "security-review",
  ],
} as const;

export function isPowerSkillSelected(
  packageId: string,
  skillName: string | undefined,
  targetName: string,
): boolean {
  const selected = POWER_SKILL_ALLOWLIST[packageId];
  if (!selected) return false;
  return (
    selected.includes(skillName ?? targetName) || selected.includes(targetName)
  );
}

/**
 * These are overlap warnings, not claims that the listed repositories are
 * technically incompatible. The catalog currently has no evidenced hard
 * family; hard-family support exists for a future verified incompatibility.
 */
export const CATALOG_CONFLICT_FAMILIES: CatalogConflictFamily[] = [
  {
    id: "agent-skill-collections",
    label: "agent skill collections",
    severity: "soft",
    packageIds: ["openai-skills", "anthropic-skills", "wshobson-agents"],
    rationale:
      "Each is a broad skills collection, so installing several can duplicate discovery and workflow guidance.",
  },
  {
    id: "web-research-mcp",
    label: "web research MCP servers",
    severity: "soft",
    packageIds: ["exa-mcp-server", "firecrawl-mcp-server"],
    rationale:
      "Both expose web search/crawling capabilities; they can coexist but may overlap in cost, permissions, and tool choice.",
  },
];

function eligiblePackages(
  packages: CatalogPackage[],
  selection: InstallSelection,
): CatalogPackage[] {
  const ranked = [...packages]
    .filter((pkg) => !pkg.archived)
    .sort(compareCatalogPackages);
  if (selection.mode === "stable") {
    const reviewed = ranked.filter(
      (pkg) => pkg.tier === "official" || pkg.tier === "stable",
    );
    const curated = reviewed.filter((pkg) =>
      STABLE_BOOST_PACKAGE_IDS.includes(pkg.id),
    );
    // Fixtures and downstream catalogs may not contain Loadout's bundled ids;
    // preserve reviewed-tier behavior in that case instead of returning empty.
    return curated.length ? curated : reviewed;
  }
  if (selection.mode === "power") {
    const packageIds = new Set(Object.keys(POWER_SKILL_ALLOWLIST));
    const selected = ranked.filter((pkg) => packageIds.has(pkg.id));
    return selected.length
      ? selected
      : ranked.filter((pkg) => pkg.components?.includes("skill"));
  }
  if (selection.mode === "maximum") return ranked;
  const ids = selection.packageIds ?? [];
  if (ids.length === 0)
    throw new Error("Custom mode requires at least one package id");
  const byId = new Map(packages.map((pkg) => [pkg.id, pkg]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length)
    throw new Error(`Unknown catalog package id(s): ${unknown.join(", ")}`);
  const archived = ids.filter((id) => byId.get(id)?.archived);
  if (archived.length)
    throw new Error(
      `Archived catalog package(s) cannot be selected: ${archived.join(", ")}`,
    );
  return [...new Set(ids)]
    .map((id) => byId.get(id)!)
    .sort(compareCatalogPackages);
}

/**
 * Resolve catalog overlap before any repository is fetched or files are
 * written. Stable keeps one explainable default per soft family. Maximum and
 * Custom retain soft-overlap candidates but report the chosen default; runtime
 * activation is never claimed because skills do not have a universal enable
 * switch. Hard families always stop the operation for human resolution.
 */
export function resolveCatalogProfile(
  packages: CatalogPackage[],
  selection: InstallSelection,
  families: CatalogConflictFamily[] = CATALOG_CONFLICT_FAMILIES,
): ProfileResolution {
  if (
    !(["stable", "power", "maximum", "custom"] as string[]).includes(
      selection.mode,
    )
  )
    throw new Error(`Unknown install mode '${selection.mode}'`);
  const candidates = eligiblePackages(packages, selection);
  const selected = new Map(candidates.map((pkg) => [pkg.id, pkg]));
  const deferred: CatalogPackage[] = [];
  const conflicts: ProfileConflict[] = [];
  const warnings: string[] = [];

  for (const family of families) {
    const members = candidates
      .filter((pkg) => family.packageIds.includes(pkg.id))
      .sort(compareCatalogPackages);
    if (members.length < 2) continue;
    const names = members.map((pkg) => pkg.displayName).join(", ");
    if (family.severity === "hard") {
      throw new Error(
        `Hard conflict in ${family.label}: ${names}. Remove all but one package before continuing. ${family.rationale}`,
      );
    }
    const primary = members[0];
    const message = `${family.label}: ${primary.displayName} is the default among ${names}. ${family.rationale}`;
    conflicts.push({
      familyId: family.id,
      severity: family.severity,
      packageIds: members.map((pkg) => pkg.id),
      defaultPackageId: primary.id,
      message,
    });
    if (selection.mode === "stable") {
      for (const secondary of members.slice(1)) {
        selected.delete(secondary.id);
        deferred.push(secondary);
      }
      warnings.push(
        `Stable Boost selected ${primary.displayName}; deferred ${members
          .slice(1)
          .map((pkg) => pkg.displayName)
          .join(", ")} because they overlap in ${family.label}.`,
      );
    } else if (selection.mode === "custom") {
      warnings.push(
        `Custom selection retains the soft overlap in ${family.label}. Review ${names} before installation.`,
      );
    } else {
      warnings.push(
        `${selection.mode === "power" ? "Power Boost" : "Maximum Library"} retains the soft overlap in ${family.label}. ${primary.displayName} is the recommended default; review each package before installation.`,
      );
    }
  }
  return {
    mode: selection.mode,
    packages: [...selected.values()].sort(compareCatalogPackages),
    deferred: deferred.sort(compareCatalogPackages),
    conflicts,
    warnings,
  };
}
