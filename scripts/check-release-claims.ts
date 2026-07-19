#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditReleaseClaims,
  formatReleaseEvidenceIndex,
} from "../src/core/release-claims.js";
import { parseLiveCheckReport } from "./check-live-evidence.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(import.meta.dirname, "..");

export function assertRepositoryCommitIsAncestor(
  root: string,
  commit: string,
  head = "HEAD",
): void {
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error(
      `Evidence repository commit is not a 40-hex SHA: ${commit}`,
    );
  try {
    execFileSync("git", ["-C", root, "cat-file", "-e", `${commit}^{commit}`], {
      stdio: "pipe",
      timeout: 10_000,
    });
  } catch {
    throw new Error(`Evidence repository commit does not exist: ${commit}`);
  }
  try {
    execFileSync(
      "git",
      ["-C", root, "merge-base", "--is-ancestor", commit, head],
      { stdio: "pipe", timeout: 10_000 },
    );
  } catch {
    throw new Error(
      `Evidence repository commit is not an ancestor of ${head}: ${commit}`,
    );
  }
}

export async function validateReleaseEvidenceBindings(
  root: string,
): Promise<void> {
  const [review, liveValue] = await Promise.all([
    readFile(resolve(root, "docs/RELEASE_REVIEW.md"), "utf8"),
    readFile(
      resolve(root, "docs/evidence/live-checks-2026-07-19.json"),
      "utf8",
    ).then(JSON.parse),
  ]);
  const testedCommit = /exact tested commit\s+`([0-9a-f]{40})`/i.exec(
    review,
  )?.[1];
  if (!testedCommit)
    throw new Error("Release review has no exact tested 40-hex commit");
  const live = parseLiveCheckReport(liveValue, [
    "npm",
    "stable-install",
    "github",
  ]);
  assertRepositoryCommitIsAncestor(root, testedCommit);
  assertRepositoryCommitIsAncestor(root, live.repositoryCommit);
  if (live.repositoryCommit !== testedCommit)
    throw new Error(
      `Deterministic and live evidence must bind to the same repository commit: deterministic=${testedCommit}, live=${live.repositoryCommit}`,
    );
}

/** Build the release-claim index for reuse by deterministic evidence gates. */
export async function buildReleaseEvidenceIndex(root = projectRoot) {
  const [readme, catalogValue] = await Promise.all([
    readFile(resolve(root, "README.md"), "utf8"),
    readFile(resolve(root, "catalog/packages.json"), "utf8").then(JSON.parse),
  ]);
  await validateReleaseEvidenceBindings(root);
  if (!Array.isArray(catalogValue)) throw new Error("Catalog must be an array");
  return auditReleaseClaims({
    root,
    readme,
    catalogCount: catalogValue.length,
  });
}

async function main() {
  const index = await buildReleaseEvidenceIndex();
  process.stdout.write(`${formatReleaseEvidenceIndex(index)}\n`);
  if (index.releaseBlocked) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
