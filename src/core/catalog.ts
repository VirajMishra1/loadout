import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogPackage } from "../shared/types.js";
import { fetchGitHubMetadata, type GitHubMetadataOptions } from "./github.js";
import { loadoutHome } from "./paths.js";

const cachedCatalogPath = () => join(loadoutHome(), "catalog.json");

export async function loadCatalog(path = join(process.cwd(), "catalog", "packages.json")): Promise<CatalogPackage[]> {
  const raw = await readFile(path, "utf8");
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error("Catalog must be an array");
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof (item as Record<string, unknown>).id !== "string") {
      throw new Error("Catalog contains an invalid package record");
    }
  }
  return value as CatalogPackage[];
}

/** Load the most recently refreshed catalog, falling back to the bundled catalog offline. */
export async function loadEffectiveCatalog(path = join(process.cwd(), "catalog", "packages.json")): Promise<CatalogPackage[]> {
  try {
    const raw = await readFile(cachedCatalogPath(), "utf8");
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value)) return value as CatalogPackage[];
  } catch { /* no refresh has been performed yet */ }
  return loadCatalog(path);
}

export interface CatalogRefreshResult {
  catalog: CatalogPackage[];
  failures: Array<{ repository: string; error: string }>;
}

/** Refreshes package metadata from GitHub and persists only data returned by the API. */
export async function refreshCatalog(
  packages: CatalogPackage[],
  options: GitHubMetadataOptions = {}
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
        archived: metadata.archived
      });
    } catch (error) {
      failures.push({ repository: pkg.repository, error: error instanceof Error ? error.message : String(error) });
      refreshed.push(pkg);
    }
  }
  await mkdir(loadoutHome(), { recursive: true });
  await writeFile(cachedCatalogPath(), `${JSON.stringify(refreshed, null, 2)}\n`, { mode: 0o600 });
  return { catalog: refreshed, failures };
}

export function rankCatalog(packages: CatalogPackage[]): CatalogPackage[] {
  return [...packages].sort((a, b) => {
    const tierScore = (tier: CatalogPackage["tier"]) => ({ official: 4, stable: 3, trending: 2, community: 1 }[tier]);
    return tierScore(b.tier) - tierScore(a.tier) || (b.stars ?? 0) - (a.stars ?? 0);
  });
}
