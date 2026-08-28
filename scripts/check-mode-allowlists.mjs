#!/usr/bin/env node
// Network guard against silent mode-allowlist rot.
//
// The Stable/Power allowlists in src/core/profiles.ts name specific skills by
// their SKILL.md `name` (or directory name). If an upstream repository renames
// or removes one of those skills at a newer commit, the mode quietly installs
// fewer skills with no error. This check fetches each allowlist package at its
// pinned reviewed commit and asserts every named skill still resolves, using
// the exact discovery code the installer uses.
//
// It needs network + git, so it is a live gate (like check:live-evidence), not
// part of the offline `verify` chain. Run: `npm run check:allowlists`.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Import the built output (run after `npm run build`), matching the other
// evidence scripts. Importing src/*.ts directly trips Node's type-stripping on
// the transitive .js specifiers inside core modules.
const [
  { loadCatalog },
  { fetchRepositorySnapshot },
  { discoverSkillDirectories },
  profiles,
] = await Promise.all([
  import("../dist/src/core/catalog.js"),
  import("../dist/src/core/source.js"),
  import("../dist/src/core/skills.js"),
  import("../dist/src/core/profiles.js"),
]);

const { STABLE_SKILL_ALLOWLIST, POWER_SKILL_ALLOWLIST } = profiles;

/** allowlisted name resolves if it equals a discovered skill's name or dir name. */
function resolves(allowedName, discovered) {
  return discovered.some(
    (skill) => skill.name === allowedName || skill.targetName === allowedName,
  );
}

async function discoveredSkills(path) {
  const found = [];
  // include is called for every SKILL.md directory with {name?, targetName};
  // return false so nothing is copied — we only want the inventory. validate is
  // off because we are reading names, not gating a real install.
  await discoverSkillDirectories(path, {
    validate: false,
    include: (skill) => {
      found.push({ name: skill.name, targetName: skill.targetName });
      return false;
    },
  });
  return found;
}

async function main() {
  const catalog = await loadCatalog(resolve(root, "catalog/packages.json"));
  const byId = new Map(catalog.map((pkg) => [pkg.id, pkg]));

  // Merge Stable and Power; a package can appear in both with different skills.
  const wanted = new Map();
  for (const allowlist of [STABLE_SKILL_ALLOWLIST, POWER_SKILL_ALLOWLIST])
    for (const [packageId, skills] of Object.entries(allowlist)) {
      const set = wanted.get(packageId) ?? new Set();
      for (const skill of skills) set.add(skill);
      wanted.set(packageId, set);
    }

  const failures = [];
  for (const [packageId, names] of wanted) {
    const pkg = byId.get(packageId);
    if (!pkg?.source?.commit) {
      failures.push(`${packageId}: not in catalog or missing pinned commit`);
      continue;
    }
    let snapshot;
    try {
      snapshot = await fetchRepositorySnapshot(pkg.repository, {
        ref: pkg.source.commit,
      });
    } catch (error) {
      failures.push(
        `${packageId}: could not fetch ${pkg.repository}@${pkg.source.commit}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (snapshot.commit.toLowerCase() !== pkg.source.commit.toLowerCase()) {
      failures.push(
        `${packageId}: resolved ${snapshot.commit}, expected ${pkg.source.commit}`,
      );
      continue;
    }
    const discovered = await discoveredSkills(snapshot.path);
    const missing = [...names].filter((name) => !resolves(name, discovered));
    if (missing.length)
      failures.push(
        `${packageId}@${pkg.source.commit.slice(0, 12)}: allowlisted skill(s) no longer resolve: ${missing.join(", ")}`,
      );
    else
      process.stdout.write(
        `ok  ${packageId}: ${names.size} skill(s) resolve at pinned commit\n`,
      );
  }

  if (failures.length) {
    process.stderr.write(
      `\nMode allowlist rot detected:\n${failures.map((f) => `  - ${f}`).join("\n")}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    "\nMode allowlist gate: PASS (all named skills resolve)\n",
  );
}

await main();
