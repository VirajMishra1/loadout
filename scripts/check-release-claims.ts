#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditReleaseClaims,
  formatReleaseEvidenceIndex,
} from "../src/core/release-claims.js";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(import.meta.dirname, "..");

/** Build the release-claim index for reuse by deterministic evidence gates. */
export async function buildReleaseEvidenceIndex(root = projectRoot) {
  const [readme, catalogValue] = await Promise.all([
    readFile(resolve(root, "README.md"), "utf8"),
    readFile(resolve(root, "catalog/packages.json"), "utf8").then(JSON.parse),
  ]);
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
