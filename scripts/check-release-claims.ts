#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  auditReleaseClaims,
  formatReleaseEvidenceIndex,
} from "../src/core/release-claims.js";

const root = resolve(import.meta.dirname, "..");
const readme = await readFile(resolve(root, "README.md"), "utf8");
const catalog: unknown = JSON.parse(
  await readFile(resolve(root, "catalog/packages.json"), "utf8"),
);
if (!Array.isArray(catalog)) throw new Error("Catalog must be an array");
const index = await auditReleaseClaims({
  root,
  readme,
  catalogCount: catalog.length,
});
process.stdout.write(`${formatReleaseEvidenceIndex(index)}\n`);
if (index.releaseBlocked) process.exitCode = 1;
