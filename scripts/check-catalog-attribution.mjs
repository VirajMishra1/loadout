#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = resolve(root, "catalog/packages.json");
const creditPath = resolve(root, "docs/CATALOG.md");

const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const credits = await readFile(creditPath, "utf8");
if (!Array.isArray(catalog))
  throw new Error("catalog/packages.json is not an array");

const missing = catalog
  .filter((item) => item && typeof item.repository === "string")
  .filter(
    (item) =>
      !credits.includes(`https://github.com/${item.repository}`) ||
      !credits.includes(
        `https://github.com/${item.repository}/tree/${item.source?.commit}`,
      ),
  )
  .map((item) => item.repository);

if (missing.length) {
  throw new Error(
    `docs/CATALOG.md is missing repository or immutable-commit credit links for: ${missing.join(", ")}`,
  );
}

process.stdout.write(
  `Verified repository and immutable-commit credit links for ${catalog.length} catalog records.\n`,
);
