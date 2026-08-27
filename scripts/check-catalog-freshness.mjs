#!/usr/bin/env node
// Catalog freshness re-verify.
//
// The reviewed catalog is pinned to exact commits, which keeps installs
// reproducible, but "reviewed" still decays: an upstream repository can be
// archived, renamed, or go stale long after it was last verified. Pinning
// hides that from the installer. This check re-contacts each cataloged GitHub
// repository and reports the decay signals a frozen catalog cannot see:
//   - archived upstreams (hard failure — they should be flagged or removed)
//   - a changed default branch (advisory — the commit pin still holds)
//   - staleness (advisory — verifiedAt older than the freshness window)
//
// It needs network, so it is a live gate (run: `npm run check:catalog-freshness`),
// separate from the offline verify chain. Reuses fetchGitHubMetadata, the same
// client the discovery and ranking code uses.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FRESHNESS_WINDOW_DAYS = Number(process.env.LOADOUT_FRESHNESS_DAYS ?? 180);

const [{ loadCatalog }, { fetchGitHubMetadata }] = await Promise.all([
  import("../dist/src/core/catalog.js"),
  import("../dist/src/core/github.js"),
]);

function networkUnavailable(error) {
  return /ENOTFOUND|EAI_AGAIN|ECONN|ETIMEDOUT|network|fetch failed|rate limit|unreachable|could not reach/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

function ageInDays(iso) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return undefined;
  return Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
}

async function main() {
  const catalog = await loadCatalog(resolve(root, "catalog/packages.json"));
  const github = catalog.filter((pkg) => pkg.source?.type === "github");

  const archived = [];
  const advisories = [];
  let unreachable = 0;

  for (const pkg of github) {
    let meta;
    try {
      meta = await fetchGitHubMetadata(pkg.repository);
    } catch (error) {
      if (networkUnavailable(error)) {
        unreachable += 1;
        continue;
      }
      advisories.push(`${pkg.id}: metadata error: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (meta.archived) {
      // An archive already acknowledged in the catalog (archived: true) is
      // handled — the installer skips it. Only unacknowledged archives fail.
      if (pkg.archived)
        advisories.push(
          `${pkg.id} is archived upstream (already flagged archived in the catalog)`,
        );
      else archived.push(`${pkg.id} (${pkg.repository}) is archived upstream`);
      continue;
    }
    if (
      pkg.source?.defaultBranch &&
      meta.defaultBranch &&
      meta.defaultBranch !== pkg.source.defaultBranch
    )
      advisories.push(
        `${pkg.id}: default branch changed ${pkg.source.defaultBranch} -> ${meta.defaultBranch} (commit pin still valid)`,
      );
    const age = pkg.source?.verifiedAt ? ageInDays(pkg.source.verifiedAt) : undefined;
    if (age !== undefined && age > FRESHNESS_WINDOW_DAYS)
      advisories.push(
        `${pkg.id}: last verified ${age}d ago (> ${FRESHNESS_WINDOW_DAYS}d) — re-review and refresh verifiedAt`,
      );
  }

  process.stdout.write(
    `Catalog freshness: ${github.length} GitHub record(s) checked, ${unreachable} unreachable this run.\n`,
  );
  for (const advisory of advisories) process.stdout.write(`  advisory: ${advisory}\n`);

  if (archived.length) {
    process.stderr.write(
      `\nArchived upstreams (flag or remove from the catalog):\n${archived.map((a) => `  - ${a}`).join("\n")}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `\nCatalog freshness gate: PASS (no archived upstreams; ${advisories.length} advisory note(s)).\n`,
  );
}

await main();
