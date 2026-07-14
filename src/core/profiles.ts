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
    rationale: "Each is a broad skills collection, so installing several can duplicate discovery and workflow guidance."
  },
  {
    id: "web-research-mcp",
    label: "web research MCP servers",
    severity: "soft",
    packageIds: ["exa-mcp-server", "firecrawl-mcp-server"],
    rationale: "Both expose web search/crawling capabilities; they can coexist but may overlap in cost, permissions, and tool choice."
  }
];

function eligiblePackages(packages: CatalogPackage[], selection: InstallSelection): CatalogPackage[] {
  const ranked = [...packages].filter((pkg) => !pkg.archived).sort(compareCatalogPackages);
  if (selection.mode === "stable") return ranked.filter((pkg) => pkg.tier === "official" || pkg.tier === "stable");
  if (selection.mode === "maximum") return ranked;
  const ids = selection.packageIds ?? [];
  if (ids.length === 0) throw new Error("Custom mode requires at least one package id");
  const byId = new Map(packages.map((pkg) => [pkg.id, pkg]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length) throw new Error(`Unknown catalog package id(s): ${unknown.join(", ")}`);
  const archived = ids.filter((id) => byId.get(id)?.archived);
  if (archived.length) throw new Error(`Archived catalog package(s) cannot be selected: ${archived.join(", ")}`);
  return [...new Set(ids)].map((id) => byId.get(id)!).sort(compareCatalogPackages);
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
  families: CatalogConflictFamily[] = CATALOG_CONFLICT_FAMILIES
): ProfileResolution {
  if (!(["stable", "maximum", "custom"] as string[]).includes(selection.mode)) throw new Error(`Unknown install mode '${selection.mode}'`);
  const candidates = eligiblePackages(packages, selection);
  const selected = new Map(candidates.map((pkg) => [pkg.id, pkg]));
  const deferred: CatalogPackage[] = [];
  const conflicts: ProfileConflict[] = [];
  const warnings: string[] = [];

  for (const family of families) {
    const members = candidates.filter((pkg) => family.packageIds.includes(pkg.id)).sort(compareCatalogPackages);
    if (members.length < 2) continue;
    const names = members.map((pkg) => pkg.displayName).join(", ");
    if (family.severity === "hard") {
      throw new Error(`Hard conflict in ${family.label}: ${names}. Remove all but one package before continuing. ${family.rationale}`);
    }
    const primary = members[0];
    const message = `${family.label}: ${primary.displayName} is the default among ${names}. ${family.rationale}`;
    conflicts.push({ familyId: family.id, severity: family.severity, packageIds: members.map((pkg) => pkg.id), defaultPackageId: primary.id, message });
    if (selection.mode === "stable") {
      for (const secondary of members.slice(1)) {
        selected.delete(secondary.id);
        deferred.push(secondary);
      }
      warnings.push(`Stable Boost selected ${primary.displayName}; deferred ${members.slice(1).map((pkg) => pkg.displayName).join(", ")} because they overlap in ${family.label}.`);
    } else if (selection.mode === "custom") {
      warnings.push(`Custom selection retains the soft overlap in ${family.label}. Review ${names} before installation.`);
    } else {
      warnings.push(`Maximum Boost retains the soft overlap in ${family.label}. ${primary.displayName} is the recommended default; review each package before installation.`);
    }
  }
  return { mode: selection.mode, packages: [...selected.values()].sort(compareCatalogPackages), deferred: deferred.sort(compareCatalogPackages), conflicts, warnings };
}
