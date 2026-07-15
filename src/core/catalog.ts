import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogPackage } from "../shared/types.js";
import { catalogSchema, formatSchemaError } from "../shared/schemas.js";
import { fetchGitHubMetadata, type GitHubMetadataOptions } from "./github.js";
import { loadoutHome } from "./paths.js";
import { compareCatalogPackages, explainCatalogScore } from "./ranking.js";
import { resolveCatalogProfile } from "./profiles.js";

export type InstallSelectionMode = "stable" | "maximum" | "custom";

export interface InstallSelection {
  mode: InstallSelectionMode;
  /** Explicit catalog ids used by custom mode. */
  packageIds?: string[];
}

const cachedCatalogPath = () => join(loadoutHome(), "catalog.json");

const TIERS = new Set<CatalogPackage["tier"]>([
  "official",
  "stable",
  "trending",
  "community",
]);
const COMPONENTS = new Set([
  "skill",
  "rule",
  "command",
  "agent",
  "mcp",
  "plugin",
  "root",
]);
const OPERATING_SYSTEMS = new Set(["windows", "macos", "linux"]);

function invalid(record: number, message: string): never {
  throw new Error(`Catalog record ${record + 1}: ${message}`);
}

/**
 * Validate catalog data before it is shown or selected. This intentionally
 * checks provenance only when it is present, so older cached catalogs remain
 * readable; the bundled catalog is required to carry complete provenance.
 */
export function validateCatalog(
  value: unknown,
  options: { requireEvidence?: boolean } = {},
): asserts value is CatalogPackage[] {
  if (!Array.isArray(value)) throw new Error("Catalog must be an array");
  const schema = catalogSchema.safeParse(value);
  if (!schema.success)
    throw new Error(
      `Catalog schema is invalid: ${formatSchemaError(schema.error)}`,
    );
  const ids = new Set<string>();
  const repositories = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      invalid(index, "must be an object");
    const record = item as Record<string, unknown>;
    const text = (field: string): string => {
      const candidate = record[field];
      if (typeof candidate !== "string" || !candidate.trim())
        invalid(index, `'${field}' must be a non-empty string`);
      return candidate;
    };
    const id = text("id");
    if (!/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(id))
      invalid(index, "'id' must be lowercase kebab-case");
    if (ids.has(id)) invalid(index, `duplicates id '${id}'`);
    ids.add(id);
    text("displayName");
    text("description");
    text("category");
    const repository = text("repository");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
      invalid(index, "'repository' must be owner/repository");
    if (repositories.has(repository.toLowerCase()))
      invalid(index, `duplicates repository '${repository}'`);
    repositories.add(repository.toLowerCase());
    if (
      typeof record.tier !== "string" ||
      !TIERS.has(record.tier as CatalogPackage["tier"])
    )
      invalid(index, "'tier' is invalid");
    if (
      record.stars !== undefined &&
      (typeof record.stars !== "number" ||
        !Number.isFinite(record.stars) ||
        record.stars < 0)
    )
      invalid(index, "'stars' must be a non-negative number");
    if (
      record.license !== undefined &&
      (typeof record.license !== "string" || !record.license.trim())
    )
      invalid(index, "'license' must be a non-empty string");

    const components = record.components;
    if (components !== undefined) {
      if (
        !Array.isArray(components) ||
        !components.length ||
        components.some(
          (component) =>
            typeof component !== "string" || !COMPONENTS.has(component),
        )
      )
        invalid(index, "'components' must contain supported component kinds");
      if (new Set(components).size !== components.length)
        invalid(index, "'components' must not contain duplicates");
    }
    const operatingSystems = record.operatingSystems;
    if (operatingSystems !== undefined) {
      if (
        !Array.isArray(operatingSystems) ||
        !operatingSystems.length ||
        operatingSystems.some(
          (system) =>
            typeof system !== "string" || !OPERATING_SYSTEMS.has(system),
        )
      )
        invalid(
          index,
          "'operatingSystems' must contain supported operating systems",
        );
      if (new Set(operatingSystems).size !== operatingSystems.length)
        invalid(index, "'operatingSystems' must not contain duplicates");
    }
    const source = record.source;
    if (options.requireEvidence && source === undefined)
      invalid(index, "is missing immutable source evidence");
    if (source !== undefined) {
      if (!source || typeof source !== "object" || Array.isArray(source))
        invalid(index, "'source' must be an object");
      const evidence = source as Record<string, unknown>;
      if (evidence.type !== "github")
        invalid(index, "'source.type' must be github");
      if (evidence.url !== `https://github.com/${repository}`)
        invalid(index, "'source.url' must match repository");
      if (
        typeof evidence.defaultBranch !== "string" ||
        !/^[A-Za-z0-9._/-]+$/.test(evidence.defaultBranch)
      )
        invalid(index, "'source.defaultBranch' is invalid");
      if (
        typeof evidence.commit !== "string" ||
        !/^[a-f0-9]{40}$/i.test(evidence.commit)
      )
        invalid(index, "'source.commit' must be a full Git SHA");
      if (
        !Array.isArray(evidence.evidencePaths) ||
        !evidence.evidencePaths.length ||
        evidence.evidencePaths.some(
          (path) =>
            typeof path !== "string" ||
            !path ||
            path.startsWith("/") ||
            path.split("/").includes(".."),
        )
      )
        invalid(
          index,
          "'source.evidencePaths' must be safe repository-relative paths",
        );
      if (
        typeof evidence.verifiedAt !== "string" ||
        Number.isNaN(Date.parse(evidence.verifiedAt))
      )
        invalid(index, "'source.verifiedAt' must be an ISO date");
      if (
        options.requireEvidence &&
        (components === undefined ||
          operatingSystems === undefined ||
          record.license === undefined)
      )
        invalid(index, "is missing component, platform, or license evidence");
    }
  }
}

export async function loadCatalog(
  path = join(process.cwd(), "catalog", "packages.json"),
): Promise<CatalogPackage[]> {
  const raw = await readFile(path, "utf8");
  const value: unknown = JSON.parse(raw);
  validateCatalog(value, { requireEvidence: true });
  return value;
}

/** Load the most recently refreshed catalog, falling back to the bundled catalog offline. */
export async function loadEffectiveCatalog(
  path = join(process.cwd(), "catalog", "packages.json"),
): Promise<CatalogPackage[]> {
  try {
    const raw = await readFile(cachedCatalogPath(), "utf8");
    const value: unknown = JSON.parse(raw);
    validateCatalog(value);
    const bundled = await loadCatalog(path);
    const verified = new Map(bundled.map((pkg) => [pkg.id, pkg]));
    // A refresh cache contains mutable GitHub fields. Never allow an older
    // cache format to erase immutable provenance or static compatibility facts.
    return value.map((cached) => {
      const base = verified.get(cached.id);
      if (!base) return cached;
      return {
        ...base,
        ...(cached.stars !== undefined ? { stars: cached.stars } : {}),
        ...(cached.description ? { description: cached.description } : {}),
        ...(cached.lastUpdatedAt
          ? { lastUpdatedAt: cached.lastUpdatedAt }
          : {}),
        ...(cached.pushedAt ? { pushedAt: cached.pushedAt } : {}),
        ...(cached.topics ? { topics: cached.topics } : {}),
        ...(cached.openIssues !== undefined
          ? { openIssues: cached.openIssues }
          : {}),
        ...(cached.archived !== undefined ? { archived: cached.archived } : {}),
      };
    });
  } catch {
    /* no refresh has been performed yet */
  }
  return loadCatalog(path);
}

export interface CatalogRefreshResult {
  catalog: CatalogPackage[];
  failures: Array<{ repository: string; error: string }>;
}

/** Refreshes package metadata from GitHub and persists only data returned by the API. */
export async function refreshCatalog(
  packages: CatalogPackage[],
  options: GitHubMetadataOptions = {},
): Promise<CatalogRefreshResult> {
  const refreshed: CatalogPackage[] = [];
  const failures: CatalogRefreshResult["failures"] = [];
  for (const pkg of packages) {
    try {
      const metadata = await fetchGitHubMetadata(pkg.repository, options);
      refreshed.push({
        ...pkg,
        stars: metadata.stars,
        description: metadata.description || pkg.description,
        lastUpdatedAt: metadata.lastUpdatedAt,
        pushedAt: metadata.pushedAt ?? undefined,
        topics: metadata.topics,
        openIssues: metadata.openIssues,
        archived: metadata.archived,
      });
    } catch (error) {
      failures.push({
        repository: pkg.repository,
        error: error instanceof Error ? error.message : String(error),
      });
      refreshed.push(pkg);
    }
  }
  await mkdir(loadoutHome(), { recursive: true });
  await writeFile(
    cachedCatalogPath(),
    `${JSON.stringify(refreshed, null, 2)}\n`,
    { mode: 0o600 },
  );
  return { catalog: refreshed, failures };
}

export function rankCatalog(packages: CatalogPackage[]): CatalogPackage[] {
  return [...packages].sort(compareCatalogPackages);
}

/** Return the evidence behind a package's ordering without pretending it is objective quality. */
export { explainCatalogScore };

/**
 * Select packages for an installation loadout. This is deliberately based on
 * catalog metadata, not star count alone: archived repositories are never
 * selected automatically and stable mode only includes reviewed tiers.
 */
export function selectCatalogPackages(
  packages: CatalogPackage[],
  selection: InstallSelection,
): CatalogPackage[] {
  return resolveCatalogProfile(packages, selection).packages;
}
