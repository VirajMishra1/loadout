import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogPackage } from "../shared/types.js";
import {
  fetchGitHubReleaseMetadata,
  type GitHubMetadataOptions,
} from "./github.js";
import { writeFileAtomically } from "./atomic-file.js";
import { loadoutHome } from "./paths.js";

export interface CatalogObservation {
  repository: string;
  observedAt: string;
  stars: number;
  latestReleaseTag: string | null;
  latestReleasePublishedAt: string | null;
  latestReleaseDownloads: number;
}

export interface ObservationRecordResult {
  recorded: number;
  failures: Array<{ repository: string; error: string }>;
}

const MAX_OBSERVATIONS_PER_REPOSITORY = 90;

function observationPath(repository: string): string {
  return join(
    loadoutHome(),
    "observations",
    `${repository.replace("/", "__")}.json`,
  );
}

export async function readCatalogObservations(
  repository: string,
): Promise<CatalogObservation[]> {
  try {
    const value: unknown = JSON.parse(
      await readFile(observationPath(repository), "utf8"),
    );
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is CatalogObservation =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as CatalogObservation).repository === "string" &&
        typeof (item as CatalogObservation).observedAt === "string" &&
        typeof (item as CatalogObservation).stars === "number" &&
        typeof (item as CatalogObservation).latestReleaseDownloads === "number",
    );
  } catch {
    return [];
  }
}

/**
 * Persist one daily-like observation per repository. Existing observations on
 * the same UTC date are replaced, so repeated refreshes do not fake velocity.
 */
export async function recordCatalogObservations(
  packages: CatalogPackage[],
  options: GitHubMetadataOptions = {},
): Promise<ObservationRecordResult> {
  const failures: ObservationRecordResult["failures"] = [];
  let recorded = 0;
  const observedAt = new Date().toISOString();
  const day = observedAt.slice(0, 10);
  for (const pkg of packages) {
    if (typeof pkg.stars !== "number") continue;
    try {
      const release = await fetchGitHubReleaseMetadata(pkg.repository, options);
      const observation: CatalogObservation = {
        repository: pkg.repository,
        observedAt,
        stars: pkg.stars,
        latestReleaseTag: release.tag,
        latestReleasePublishedAt: release.publishedAt,
        latestReleaseDownloads: release.downloadCount,
      };
      const prior = await readCatalogObservations(pkg.repository);
      const retained = prior.filter(
        (item) => item.observedAt.slice(0, 10) !== day,
      );
      retained.push(observation);
      retained.sort((left, right) =>
        left.observedAt.localeCompare(right.observedAt),
      );
      await writeFileAtomically(
        observationPath(pkg.repository),
        `${JSON.stringify(retained.slice(-MAX_OBSERVATIONS_PER_REPOSITORY), null, 2)}\n`,
      );
      recorded++;
    } catch (error) {
      failures.push({
        repository: pkg.repository,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { recorded, failures };
}

const SPARKS = "▁▂▃▄▅▆▇█";

/** A compact terminal chart. One observation cannot establish a trend. */
export function formatStarHistory(observations: CatalogObservation[]): string {
  if (!observations.length)
    return "No observations yet. Run `loadout catalog --refresh`.";
  const values = observations.map((item) => item.stars);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const chart = values
    .map((value) => {
      if (maximum === minimum) return SPARKS[0];
      return SPARKS[
        Math.round(
          ((value - minimum) / (maximum - minimum)) * (SPARKS.length - 1),
        )
      ];
    })
    .join("");
  const latest = observations.at(-1)!;
  const previous = observations.at(-2);
  const delta = previous ? latest.stars - previous.stars : undefined;
  return [
    `${latest.repository}  ${chart}`,
    `stars ${latest.stars}${delta === undefined ? " (first observation)" : ` (${delta >= 0 ? "+" : ""}${delta} since previous)`}`,
    `latest release ${latest.latestReleaseTag ?? "none"} · downloads ${latest.latestReleaseDownloads}`,
  ].join("\n");
}
