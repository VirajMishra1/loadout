#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const PROSE_WORDS = new Set([
  "ai",
  "home",
  "and",
  "the",
  "was",
  "can",
  "will",
  "does",
  "has",
  "not",
  "for",
  "with",
  "from",
  "run",
  "adds",
  "keeps",
  "installs",
  "manages",
  "previews",
  "reads",
  "shows",
  "supports",
  "uses",
  "writes",
  "should",
  "you",
  "your",
  "must",
  "may",
  "never",
  "always",
  "still",
  "then",
  "when",
  "which",
]);
const RETIRED_PATHS = new Set([
  "handoff init",
  "handoff send",
  "handoff done",
  "handoff status",
  "handoff cancel",
]);

async function registeredCommands(repositoryRoot) {
  const { stdout } = await exec(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", "completion", "--commands-json"],
    {
      cwd: repositoryRoot,
      env: { ...process.env, NO_COLOR: "1" },
      timeout: 60_000,
    },
  );
  const paths = JSON.parse(stdout);
  if (!Array.isArray(paths) || !paths.every((path) => typeof path === "string"))
    throw new Error("Could not read the CLI command paths");
  return new Set(paths);
}

async function markdownFiles(repositoryRoot) {
  const found = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".md")) found.push(path);
    }
  }
  await walk(join(repositoryRoot, "docs"));
  found.push(join(repositoryRoot, "README.md"));
  return found;
}

/** Validate documented top-level and nested paths against the live CLI tree. */
export function validateDocumentedCommands(
  text,
  commandPaths,
  filePath = "document",
) {
  const failures = [];
  const parents = new Set(
    [...commandPaths]
      .filter((path) => path.includes(" "))
      .map((path) => path.split(" ")[0]),
  );
  let inDesignSection = false;
  let inFence = false;
  text.split("\n").forEach((line, index) => {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && /^#{1,6} /.test(line)) inDesignSection = false;
    if (/\*\*(?:Not implemented|Partly unimplemented)/.test(line))
      inDesignSection = true;
    if (inDesignSection) return;

    for (const match of line.matchAll(
      /\bloadout\s+([a-z][a-z-]{2,})(?:\s+([a-z][a-z-]{2,}))?/g,
    )) {
      const top = match[1];
      const child = match[2];
      if (!commandPaths.has(top)) {
        if (PROSE_WORDS.has(top)) continue;
        failures.push(
          `${filePath}:${index + 1} documents 'loadout ${top}', which the CLI does not register`,
        );
        continue;
      }

      if (!child) continue;
      const nested = `${top} ${child}`;
      if (RETIRED_PATHS.has(nested)) {
        failures.push(
          `${filePath}:${index + 1} documents retired syntax 'loadout ${nested}'`,
        );
      } else if (parents.has(top) && !commandPaths.has(nested)) {
        failures.push(
          `${filePath}:${index + 1} documents 'loadout ${nested}', which the CLI does not register`,
        );
      }
    }
  });
  return failures;
}

async function main(repositoryRoot = root) {
  const known = await registeredCommands(repositoryRoot);
  const failures = [];
  for (const path of await markdownFiles(repositoryRoot)) {
    const text = await readFile(path, "utf8");
    failures.push(
      ...validateDocumentedCommands(
        text,
        known,
        relative(repositoryRoot, path),
      ),
    );
  }
  if (failures.length) {
    console.error("[documented.commands]");
    for (const failure of failures) console.error(`  ${failure}`);
    console.error(
      "\n  Remediation: update the document to a registered command path, or restore the command.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Verified documented commands against ${known.size} registered CLI paths.`,
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) await main(root);
