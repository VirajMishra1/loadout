import type { CatalogPackage, ComponentType } from "../shared/types.js";
import { supportedAdapterNames, type AdapterCapabilities } from "./adapters.js";
import { buildCatalogCoverage } from "./catalog-coverage.js";

type SkillAllowlist = Readonly<Record<string, readonly string[]>>;

export interface ReadmeFactPackageJson {
  name: string;
  version: string;
  bin: Record<string, string>;
  engines: {
    node: string;
  };
}

export interface ReadmeFactProfiles {
  stable: SkillAllowlist;
  power: SkillAllowlist;
}

export interface DeriveReadmeFactsOptions {
  catalog: CatalogPackage[];
  packageJson: ReadmeFactPackageJson;
  agents: readonly AdapterCapabilities[];
  profiles: ReadmeFactProfiles;
}

export interface ReadmeFacts {
  catalog: {
    records: number;
    categories: number;
    components: Record<ComponentType, number>;
    installShapes: {
      skills: number;
      mcpOnly: number;
      mixed: number;
    };
    assertedLicenses: number;
    noAssertionLicenses: number;
  };
  profiles: Record<
    "stable" | "power",
    {
      sources: number;
      skillDirectories: number;
    }
  >;
  agents: {
    supportedNames: string[];
  };
  package: {
    name: string;
    version: string;
    bin: Record<string, string>;
  };
  runtime: {
    node: string;
  };
}

function profileFacts(allowlist: SkillAllowlist): {
  sources: number;
  skillDirectories: number;
} {
  return {
    sources: Object.keys(allowlist).length,
    skillDirectories: Object.values(allowlist).reduce(
      (count, skills) => count + skills.length,
      0,
    ),
  };
}

/**
 * Derive all changeable README facts from passed authoritative source data.
 * This module intentionally neither reads nor parses README text.
 */
export function deriveReadmeFacts({
  catalog,
  packageJson,
  agents,
  profiles,
}: DeriveReadmeFactsOptions): ReadmeFacts {
  const coverage = buildCatalogCoverage(catalog);
  return {
    catalog: {
      records: coverage.records,
      categories: coverage.categoryCount,
      components: coverage.components,
      installShapes: coverage.installShapes,
      assertedLicenses: coverage.assertedLicenses,
      noAssertionLicenses: coverage.noAssertionLicenses,
    },
    profiles: {
      stable: profileFacts(profiles.stable),
      power: profileFacts(profiles.power),
    },
    agents: {
      supportedNames: supportedAdapterNames(agents),
    },
    package: {
      name: packageJson.name,
      version: packageJson.version,
      bin: { ...packageJson.bin },
    },
    runtime: {
      node: packageJson.engines.node,
    },
  };
}
