import type {
  CatalogPackage,
  ComponentType,
  OperatingSystem,
} from "../shared/types.js";
import { catalogTrustStage, type CatalogTrustStage } from "./profiles.js";

export interface CatalogCoverageReport {
  records: number;
  categoryCount: number;
  targetRecords: number;
  technicallyScreenedRecords: number;
  recommendedRecords: number;
  trustStages: Record<CatalogTrustStage, number>;
  immutablePins: number;
  assertedLicenses: number;
  noAssertionLicenses: number;
  activityObserved: number;
  evaluationReady: number;
  categories: Record<string, number>;
  components: Record<ComponentType, number>;
  operatingSystems: Record<OperatingSystem, number>;
  installShapes: {
    skills: number;
    mcpOnly: number;
    mixed: number;
  };
  duplicateCapabilityGroups: Array<{
    category: string;
    records: number;
  }>;
}

const componentTypes: ComponentType[] = [
  "skill",
  "rule",
  "command",
  "agent",
  "mcp",
  "plugin",
  "root",
];
const operatingSystems: OperatingSystem[] = ["windows", "macos", "linux"];
const trustStages: CatalogTrustStage[] = [
  "discovered",
  "inspected",
  "human-reviewed",
  "benchmarked",
  "recommended",
];

function tally<T extends string>(values: T[], keys: T[]): Record<T, number> {
  return Object.fromEntries(
    keys.map((key) => [key, values.filter((value) => value === key).length]),
  ) as Record<T, number>;
}

function technicallyScreened(pkg: CatalogPackage): boolean {
  return Boolean(
    pkg.license &&
    pkg.components?.length &&
    pkg.operatingSystems?.length === operatingSystems.length &&
    operatingSystems.every((system) =>
      pkg.operatingSystems?.includes(system),
    ) &&
    pkg.source?.commit.match(/^[a-f0-9]{40}$/) &&
    pkg.source.evidencePaths.length &&
    pkg.source.verifiedAt,
  );
}

/**
 * Explain catalog breadth without pretending repository count equals quality.
 * All metrics are derived from technically screened records; live activity remains explicit
 * and absent until `catalog --refresh` observes it.
 */
export function buildCatalogCoverage(
  catalog: CatalogPackage[],
  targetRecords = 50,
): CatalogCoverageReport {
  const categories = catalog.reduce<Record<string, number>>((result, pkg) => {
    result[pkg.category] = (result[pkg.category] ?? 0) + 1;
    return result;
  }, {});
  const components = tally(
    catalog.flatMap((pkg) => pkg.components ?? []),
    componentTypes,
  );
  const platforms = tally(
    catalog.flatMap((pkg) => pkg.operatingSystems ?? []),
    operatingSystems,
  );
  return {
    records: catalog.length,
    categoryCount: Object.keys(categories).length,
    targetRecords,
    technicallyScreenedRecords: catalog.filter(technicallyScreened).length,
    recommendedRecords: catalog.filter(
      (pkg) => catalogTrustStage(pkg) === "recommended",
    ).length,
    trustStages: tally(catalog.map(catalogTrustStage), trustStages),
    immutablePins: catalog.filter((pkg) =>
      pkg.source?.commit.match(/^[a-f0-9]{40}$/),
    ).length,
    assertedLicenses: catalog.filter(
      (pkg) => pkg.license && pkg.license !== "NOASSERTION",
    ).length,
    noAssertionLicenses: catalog.filter((pkg) => pkg.license === "NOASSERTION")
      .length,
    activityObserved: catalog.filter((pkg) => pkg.pushedAt || pkg.lastUpdatedAt)
      .length,
    evaluationReady: catalog.filter(
      (pkg) =>
        pkg.source?.evidencePaths.length &&
        pkg.components?.some((type) => type === "skill" || type === "mcp"),
    ).length,
    categories,
    components,
    operatingSystems: platforms,
    installShapes: {
      skills: catalog.filter(
        (pkg) =>
          pkg.components?.includes("skill") && !pkg.components.includes("mcp"),
      ).length,
      mcpOnly: catalog.filter(
        (pkg) =>
          pkg.components?.includes("mcp") && !pkg.components.includes("skill"),
      ).length,
      mixed: catalog.filter(
        (pkg) =>
          pkg.components?.includes("skill") && pkg.components.includes("mcp"),
      ).length,
    },
    duplicateCapabilityGroups: Object.entries(categories)
      .filter(([, records]) => records > 1)
      .map(([category, records]) => ({ category, records }))
      .sort(
        (left, right) =>
          right.records - left.records ||
          left.category.localeCompare(right.category),
      ),
  };
}

export function formatCatalogCoverage(report: CatalogCoverageReport): string {
  const categories = Object.entries(report.categories)
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .map(([category, count]) => `${category}:${count}`)
    .join(", ");
  return [
    `Screened catalog: ${report.technicallyScreenedRecords}/${report.records} technically complete records (target ${report.targetRecords})`,
    `Catalog maturity: ${report.records} sourced · ${report.technicallyScreenedRecords} technically inspected · ${report.recommendedRecords} selected for Stable`,
    `Higher-confidence evidence: ${report.trustStages["human-reviewed"]} stored human-review attestations · ${report.trustStages.benchmarked} signed benchmark results`,
    `Evidence: ${report.immutablePins} immutable pins · ${report.assertedLicenses} asserted licenses · ${report.noAssertionLicenses} NOASSERTION`,
    `Coverage: ${Object.values(report.categories).length} categories · ${report.evaluationReady} evaluation-ready · ${report.activityObserved} with refreshed activity`,
    `Install shape: ${report.installShapes.skills} skill · ${report.installShapes.mcpOnly} MCP-only · ${report.installShapes.mixed} mixed`,
    `Categories: ${categories}`,
  ].join("\n");
}
