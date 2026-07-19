#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");

const blockNames = [
  "catalog-coverage",
  "evidence-stages",
  "support-summary",
  "verification-summary",
  "current-limits",
];

function marker(name, boundary) {
  return `<!-- loadout:${name}:${boundary} -->`;
}

function markdownList(values) {
  return values.map((value) => `\`${value}\``).join(", ");
}

function verificationCommands(script) {
  const commands = [];
  for (const match of script.matchAll(/npm run ([a-z0-9:_-]+)|npm test\b/gi)) {
    commands.push(match[1] ?? "test");
  }
  return commands;
}

function markdownEvidenceTable(rows) {
  const stageWidth = Math.max(
    "Stage".length,
    ...rows.map(([stage]) => stage.length),
  );
  const recordsWidth = Math.max(
    "Records".length,
    ...rows.map(([, records]) => String(records).length),
  );
  return [
    `| ${"Stage".padEnd(stageWidth)} | ${"Records".padEnd(recordsWidth)} |`,
    `| ${"-".repeat(stageWidth)} | ${"-".repeat(recordsWidth - 1)}: |`,
    ...rows.map(
      ([stage, records]) =>
        `| ${stage.padEnd(stageWidth)} | ${String(records).padStart(recordsWidth)} |`,
    ),
  ];
}

function markdownTable(headers, rows) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  );
  const render = (row) =>
    `| ${row.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;
  return [
    render(headers),
    render(widths.map((width) => "-".repeat(width))),
    ...rows.map(render),
  ];
}

async function sourceFacts() {
  const [
    { ADAPTER_CAPABILITIES },
    { loadCatalog },
    { buildCatalogCoverage },
    { POWER_SKILL_ALLOWLIST, STABLE_SKILL_ALLOWLIST },
    { deriveReadmeFacts },
    { buildAdapterConformanceMatrix, platformEvidenceFromCiWorkflow },
  ] = await Promise.all([
    import("../src/core/adapters.ts"),
    import("../src/core/catalog.ts"),
    import("../src/core/catalog-coverage.ts"),
    import("../src/core/profiles.ts"),
    import("../src/core/readme-facts.ts"),
    import("../src/core/conformance.ts"),
  ]);
  const packageJson = JSON.parse(
    await readFile(resolve(projectRoot, "package.json"), "utf8"),
  );
  const catalog = await loadCatalog(
    resolve(projectRoot, "catalog/packages.json"),
  );
  const platformEvidence = platformEvidenceFromCiWorkflow(
    await readFile(resolve(projectRoot, ".github/workflows/ci.yml"), "utf8"),
  );
  return {
    coverage: buildCatalogCoverage(catalog),
    facts: deriveReadmeFacts({
      catalog,
      packageJson,
      agents: ADAPTER_CAPABILITIES,
      profiles: {
        stable: STABLE_SKILL_ALLOWLIST,
        power: POWER_SKILL_ALLOWLIST,
      },
    }),
    packageJson,
    conformance: buildAdapterConformanceMatrix(undefined, platformEvidence),
  };
}

export function renderReadmeFactBlocksFromSources({
  coverage,
  facts,
  packageJson,
  conformance,
}) {
  if (!Array.isArray(conformance))
    throw new Error(
      "Conformance evidence is required for README support rendering.",
    );
  const evidenceRows = Object.entries(coverage.trustStages)
    .map(([stage, records]) => [
      stage === "recommended" ? "policy-selected" : stage,
      records,
    ])
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const commands = verificationCommands(packageJson.scripts.verify);
  const supportEvidence = [...conformance].sort((left, right) =>
    left.displayName < right.displayName
      ? -1
      : left.displayName > right.displayName
        ? 1
        : 0,
  );
  const supportRows = supportEvidence.map((entry) => [
    entry.displayName,
    entry.pathKnown ? "Loadout-configured" : "Not configured",
    entry.filesystemVerified ? "Verified" : "Not verified",
    entry.nativeApplicationVerified ? "Verified" : "Not verified",
    entry.platformEvidence.length
      ? entry.platformEvidence
          .map(
            (evidence) =>
              `${
                evidence.platform === "macos"
                  ? "macOS"
                  : evidence.platform[0].toUpperCase() +
                    evidence.platform.slice(1)
              } (${evidence.kind === "ci-configured" ? "CI configured" : "current test host"})`,
          )
          .join(", ")
      : "None",
  ]);
  const platformSources = [
    ...new Set(
      supportEvidence.flatMap((entry) =>
        entry.platformEvidence.map((evidence) => evidence.source),
      ),
    ),
  ].sort();

  return {
    "catalog-coverage": [
      `The bundled catalog currently contains **${facts.catalog.records} credited public repositories** across **${facts.catalog.categories} categories**: **${facts.catalog.components.skill} have skill components** and **${facts.catalog.installShapes.mcpOnly} are MCP-only**. All ${coverage.technicallyScreenedRecords} are technically screened and pinned; ${coverage.recommendedRecords} sources are selected by the bounded Stable policy. See every linked source, license status, component type, and pinned commit in **[Catalog and upstream credits](./docs/CATALOG.md)**.`,
    ].join("\n"),
    "evidence-stages": [
      "Current catalog evidence-stage counts:",
      "",
      ...markdownEvidenceTable(evidenceRows),
    ].join("\n"),
    "support-summary": [
      `Loadout's adapter capability matrix currently declares configured skill-directory targets for **${supportEvidence.length} agents**: ${supportEvidence.map((entry) => entry.displayName).join(", ")}.`,
      "",
      ...markdownTable(
        [
          "Agent",
          "Skill path",
          "Disposable filesystem lifecycle",
          "Native application",
          "Platform evidence",
        ],
        supportRows,
      ),
      "",
      `Platform evidence source${platformSources.length === 1 ? "" : "s"}: ${platformSources.length ? platformSources.map((source) => `\`${source}\``).join(", ") : "none"}.`,
      "",
      "`tests/adapter-conformance.test.ts` plans, applies, inspects, disables, re-enables, and rolls back one skill for every row when the suite runs. A configured target path does not prove that the native application recognizes or executes it. Native application execution is not inferred from filesystem simulation. Configured CI platforms describe a manually triggered workflow, not evidence that a current run passed.",
    ].join("\n"),
    "verification-summary": [
      `\`verify\` invokes ${markdownList(commands)} in that order. Use \`npm run verify:full\` to include the optional Playwright dashboard check.`,
    ].join("\n"),
    "current-limits": [
      `- **${facts.catalog.noAssertionLicenses} catalog records** currently have \`NOASSERTION\` license status and need upstream-license review before a public release decision.`,
    ].join("\n"),
  };
}

export async function renderReadmeFactBlocks() {
  return renderReadmeFactBlocksFromSources(await sourceFacts());
}

function generatedMarkerSpan(readme, name) {
  const start = marker(name, "start");
  const end = marker(name, "end");
  const startIndex = readme.indexOf(start);
  const endIndex = readme.indexOf(end);
  if (
    startIndex === -1 ||
    endIndex === -1 ||
    startIndex >= endIndex ||
    startIndex !== readme.lastIndexOf(start) ||
    endIndex !== readme.lastIndexOf(end)
  ) {
    throw new Error(
      `README must contain exactly one ordered generated marker block for '${name}'`,
    );
  }
  return { name, start, end, startIndex, endIndex: endIndex + end.length };
}

/** Replace exactly one machine-owned block while preserving all human prose. */
export function replaceGeneratedBlock(readme, name, content) {
  const span = generatedMarkerSpan(readme, name);
  return `${readme.slice(0, span.startIndex)}${span.start}\n\n${content}\n\n${span.end}${readme.slice(span.endIndex)}`;
}

function validateGeneratedMarkerSpans(readme) {
  const spans = blockNames
    .map((name) => generatedMarkerSpan(readme, name))
    .sort(
      (left, right) =>
        left.startIndex - right.startIndex ||
        (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
    );
  for (let index = 1; index < spans.length; index += 1) {
    if (spans[index].startIndex < spans[index - 1].endIndex) {
      throw new Error(
        `README generated marker blocks are overlapping: '${spans[index - 1].name}' and '${spans[index].name}'`,
      );
    }
  }
}

export async function updateReadmeFacts({
  path = resolve(projectRoot, "README.md"),
  check = false,
} = {}) {
  const blocks = await renderReadmeFactBlocks();
  const readme = await readFile(path, "utf8");
  validateGeneratedMarkerSpans(readme);
  const nextReadme = blockNames.reduce(
    (current, name) => replaceGeneratedBlock(current, name, blocks[name]),
    readme,
  );
  const changed = nextReadme !== readme;
  if (changed && !check) await writeFile(path, nextReadme, "utf8");
  return { changed, wrote: changed && !check };
}

function parseArguments(argumentsList) {
  if (argumentsList.length === 0) return { check: false };
  if (argumentsList.length === 1 && argumentsList[0] === "--check")
    return { check: true };
  throw new Error("Usage: node scripts/update-readme-facts.mjs [--check]");
}

async function main() {
  const { check } = parseArguments(process.argv.slice(2));
  const result = await updateReadmeFacts({ check });
  if (check && result.changed) {
    throw new Error(
      "README generated fact blocks are stale; run npm run readme:update",
    );
  }
  process.stdout.write(
    result.changed
      ? "Updated README generated fact blocks.\n"
      : "README generated fact blocks are current.\n",
  );
}

function isEntrypoint() {
  return process.argv[1] && resolve(process.argv[1]) === scriptPath;
}

if (isEntrypoint()) {
  if (!process.env.LOADOUT_README_FACTS_TSX) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", scriptPath, ...process.argv.slice(2)],
      {
        env: { ...process.env, LOADOUT_README_FACTS_TSX: "1" },
        stdio: "inherit",
      },
    );
    process.exitCode = result.status ?? 1;
  } else {
    main().catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
  }
}
