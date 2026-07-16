#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replaceReadmeDiscoveryStatus } from "./daily-discovery.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifact = JSON.parse(
  await readFile(resolve(root, "catalog/discovered.json"), "utf8"),
);
const markdown = await readFile(resolve(root, "docs/DISCOVERED.md"), "utf8");
const readme = await readFile(resolve(root, "README.md"), "utf8");
const catalog = JSON.parse(
  await readFile(resolve(root, "catalog/packages.json"), "utf8"),
);

if (replaceReadmeDiscoveryStatus(readme, artifact) !== readme) {
  throw new Error("README daily discovery status does not match the artifact");
}

if (
  artifact?.schemaVersion !== 1 ||
  !Array.isArray(artifact.queries) ||
  artifact.queries.length === 0 ||
  artifact.queries.length > 10 ||
  !Array.isArray(artifact.repositories) ||
  artifact.repositories.length === 0
) {
  throw new Error("Discovery artifact is empty or has an unsupported schema");
}
if (artifact.source?.provider !== "GitHub REST API") {
  throw new Error(
    "Discovery artifact does not identify the GitHub REST API source",
  );
}

const cataloged = new Set(
  catalog.map((item) => String(item.repository).toLowerCase()),
);
const seen = new Set();
let currentCount = 0;
let candidateCount = 0;
let reviewedCount = 0;
for (const item of artifact.repositories) {
  const key = String(item.repository).toLowerCase();
  if (seen.has(key)) throw new Error(`Duplicate discovery repository: ${key}`);
  seen.add(key);
  if (!/^https:\/\/github\.com\//.test(item.url)) {
    throw new Error(`Non-GitHub discovery URL for ${item.repository}`);
  }
  const expectedStatus = cataloged.has(key) ? "reviewed" : "candidate";
  if (item.catalogStatus !== expectedStatus) {
    throw new Error(
      `Stale catalog status for ${item.repository}: expected ${expectedStatus}`,
    );
  }
  if (
    !Array.isArray(item.observations) ||
    item.observations.length > artifact.policy.observationLimitPerRepository
  ) {
    throw new Error(`Unbounded observation history for ${item.repository}`);
  }
  for (let index = 1; index < item.observations.length; index += 1) {
    if (
      item.observations[index - 1].observedAt >=
      item.observations[index].observedAt
    ) {
      throw new Error(`Unordered observation history for ${item.repository}`);
    }
  }
  if (item.seenInLatestRun) {
    currentCount += 1;
    if (expectedStatus === "candidate") candidateCount += 1;
    else reviewedCount += 1;
    if (!markdown.includes(`](${item.url})`)) {
      throw new Error(`docs/DISCOVERED.md is missing ${item.repository}`);
    }
    if (
      !item.observations.some(
        (observation) => observation.observedAt === artifact.generatedAt,
      )
    ) {
      throw new Error(`Current observation is missing for ${item.repository}`);
    }
  }
}

const expected = artifact.statistics;
if (
  expected.currentRepositories !== currentCount ||
  expected.uncatalogedCandidates !== candidateCount ||
  expected.reviewedRepositories !== reviewedCount ||
  expected.retainedRepositories !== artifact.repositories.length - currentCount
) {
  throw new Error("Discovery statistics do not match repository evidence");
}

process.stdout.write(
  `Verified ${currentCount} current discovery records and ${artifact.repositories.length - currentCount} retained records.\n`,
);
