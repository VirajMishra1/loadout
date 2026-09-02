#!/usr/bin/env node
// Fails when documentation tells a reader to run a command the CLI does not
// have. Docs previously described `pack`, `publish`, and `registry-serve` for a
// release after those commands were removed, and no gate noticed.
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");

/** Every command and subcommand the CLI registers. */
async function registeredCommands() {
  const { stdout } = await exec(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", "completion", "bash"],
    { cwd: root, env: { ...process.env, NO_COLOR: "1" }, timeout: 60_000 },
  );
  const names = new Set(
    /commands="([^"]*)"/.exec(stdout)?.[1].split(/\s+/).filter(Boolean) ?? [],
  );
  if (!names.size) throw new Error("Could not read the CLI command list");
  // Subcommands are addressed as `loadout <parent> <child>`; allow both words.
  for (const extra of [
    "list",
    "inspect",
    "propose",
    "promote",
    "status",
    "set",
    "verify",
    "check",
    "delete",
    "install",
    "remove",
    "init",
    "send",
    "done",
  ])
    names.add(extra);
  return names;
}

async function markdownFiles() {
  const found = [];
  for (const entry of await readdir(join(root, "docs"), {
    withFileTypes: true,
  }))
    if (entry.isFile() && entry.name.endsWith(".md"))
      found.push(join(root, "docs", entry.name));
  found.push(join(root, "README.md"));
  return found;
}

const known = await registeredCommands();
const failures = [];

for (const path of await markdownFiles()) {
  const text = await readFile(path, "utf8");
  // A section may document a command that does not exist provided it says so.
  // The exemption runs from the disclaimer to the next heading, so it cannot
  // silently cover the rest of a file.
  let inDesignSection = false;
  let inFence = false;
  text.split("\n").forEach((line, index) => {
    if (/^\s*```/.test(line)) inFence = !inFence;
    // A shell comment inside a fence looks like a markdown heading, so only
    // headings outside a code block end the exemption.
    if (!inFence && /^#{1,6} /.test(line)) inDesignSection = false;
    if (/\*\*(?:Not implemented|Partly unimplemented)/.test(line))
      inDesignSection = true;
    if (inDesignSection) return;
    // Only flag imperative usages: `loadout <name>` in prose or a code block.
    for (const match of line.matchAll(/\bloadout\s+([a-z][a-z-]{2,})\b/g)) {
      const name = match[1];
      if (known.has(name)) continue;
      // Flags and prose words that follow "loadout" are not commands.
      if (
        name.startsWith("-") ||
        [
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
        ].includes(name)
      )
        continue;
      failures.push(
        `${path.replace(root + "/", "")}:${index + 1} documents 'loadout ${name}', which the CLI does not register`,
      );
    }
  });
}

if (failures.length) {
  console.error("[documented.commands]");
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    "\n  Remediation: update the document to a command that exists, or restore the command.",
  );
  process.exit(1);
}
console.log(
  `Verified documented commands against ${known.size} registered CLI names.`,
);
