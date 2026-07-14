import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogPackage } from "../shared/types.js";

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

export function rankCatalog(packages: CatalogPackage[]): CatalogPackage[] {
  return [...packages].sort((a, b) => {
    const tierScore = (tier: CatalogPackage["tier"]) => ({ official: 4, stable: 3, trending: 2, community: 1 }[tier]);
    return tierScore(b.tier) - tierScore(a.tier) || (b.stars ?? 0) - (a.stars ?? 0);
  });
}
