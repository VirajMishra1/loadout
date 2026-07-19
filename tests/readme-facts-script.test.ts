import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  replaceGeneratedBlock,
  renderReadmeFactBlocks,
  renderReadmeFactBlocksFromSources,
  updateReadmeFacts,
} from "../scripts/update-readme-facts.mjs";

const blockNames = [
  "catalog-coverage",
  "evidence-stages",
  "support-summary",
  "verification-summary",
  "current-limits",
];

const temporaryPaths: string[] = [];

async function temporaryReadme(content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "loadout-readme-facts-"));
  temporaryPaths.push(directory);
  const path = join(directory, "README.md");
  await writeFile(path, content, "utf8");
  return path;
}

function markers(name: string, content = "stale"): string {
  return `<!-- loadout:${name}:start -->\n${content}\n<!-- loadout:${name}:end -->`;
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map(async (directory) => {
      await import("node:fs/promises").then(({ rm }) =>
        rm(directory, { recursive: true, force: true }),
      );
    }),
  );
});

describe("README fact generator", () => {
  it("reports stale generated blocks in --check mode without writing", async () => {
    const path = await temporaryReadme(
      `${blockNames.map((name) => markers(name)).join("\n\n")}\n`,
    );

    const result = await updateReadmeFacts({ path, check: true });

    expect(result).toMatchObject({ changed: true, wrote: false });
    expect(await readFile(path, "utf8")).toContain("\nstale\n");
  });

  it("rejects missing, reversed, and duplicate marker pairs", () => {
    expect(() =>
      replaceGeneratedBlock("human prose", "catalog-coverage", "new"),
    ).toThrow(/exactly one ordered/i);
    expect(() =>
      replaceGeneratedBlock(
        "<!-- loadout:catalog-coverage:end -->\n<!-- loadout:catalog-coverage:start -->",
        "catalog-coverage",
        "new",
      ),
    ).toThrow(/exactly one ordered/i);
    expect(() =>
      replaceGeneratedBlock(
        `${markers("catalog-coverage")}\n${markers("catalog-coverage")}`,
        "catalog-coverage",
        "new",
      ),
    ).toThrow(/exactly one ordered/i);
  });

  it("rejects nested marker spans before writing the README", async () => {
    const nestedCatalogAndSupport = [
      "<!-- loadout:catalog-coverage:start -->",
      "<!-- loadout:support-summary:start -->",
      "<!-- loadout:support-summary:end -->",
      "<!-- loadout:catalog-coverage:end -->",
    ].join("\n");
    const before = `${[
      nestedCatalogAndSupport,
      ...blockNames
        .filter(
          (name) => name !== "catalog-coverage" && name !== "support-summary",
        )
        .map((name) => markers(name)),
    ].join("\n\n")}\n`;
    const path = await temporaryReadme(before);

    await expect(updateReadmeFacts({ path })).rejects.toThrow(/overlapping/i);
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("updates only bytes inside the selected marker pair", () => {
    const before = `Human introduction\n\n${markers("catalog-coverage", "old")}\n\nHuman footer\n`;
    const after = replaceGeneratedBlock(before, "catalog-coverage", "new");
    const start = "<!-- loadout:catalog-coverage:start -->";
    const end = "<!-- loadout:catalog-coverage:end -->";

    expect(after.slice(0, after.indexOf(start))).toBe(
      before.slice(0, before.indexOf(start)),
    );
    expect(after.slice(after.indexOf(end) + end.length)).toBe(
      before.slice(before.indexOf(end) + end.length),
    );
    expect(after).toContain(`${start}\n\nnew\n\n${end}`);
  });

  it("keeps verification commands ordered and README facts compact", async () => {
    const blocks = await renderReadmeFactBlocks();

    expect(blocks["verification-summary"]).toContain(
      "`check:evidence`, `test`, `test:e2e:cli`",
    );
    expect(blocks["evidence-stages"]).toContain(
      "[catalog policy](./docs/CATALOG_POLICY.md)",
    );
    expect(blocks["evidence-stages"]).not.toMatch(/^\|/m);
    expect(blocks["support-summary"]).toContain("**12 agents**");
    expect(blocks["support-summary"]).toContain(
      "[complete feature matrix](./docs/FEATURE_TEST_MATRIX.md)",
    );
    expect(blocks["support-summary"]).toContain(
      "A configured target path does not prove that the native application recognizes or executes it.",
    );
    expect(blocks["support-summary"]).not.toMatch(/^\|/m);
    expect(blocks["support-summary"]).toContain(
      "Linux (CI configured), macOS (CI configured), Windows (CI configured)",
    );
    expect(blocks["support-summary"]).toContain(
      "`.github/workflows/ci.yml (cross-platform job)`",
    );
    expect(blocks["support-summary"]).toContain(
      "Native application execution is not inferred",
    );
  });

  it("uses catalog evidence for Stable policy counts and code-point support sorting", () => {
    const blocks = renderReadmeFactBlocksFromSources({
      coverage: {
        technicallyScreenedRecords: 8,
        recommendedRecords: 7,
        trustStages: {
          benchmarked: 0,
          discovered: 0,
          "human-reviewed": 0,
          inspected: 1,
          recommended: 7,
        },
      },
      facts: {
        catalog: {
          records: 8,
          categories: 2,
          components: { skill: 3 },
          installShapes: { mcpOnly: 2 },
          noAssertionLicenses: 1,
        },
        agents: { supportedNames: ["Zulu", "äther", "Alpha"] },
      },
      packageJson: {
        scripts: { verify: "npm run check:evidence && npm test" },
      },
      conformance: [
        {
          agent: "codex",
          displayName: "Alpha",
          pathKnown: false,
          filesystemVerified: true,
          nativeApplicationVerified: false,
          platformEvidence: [],
        },
        {
          agent: "claude-code",
          displayName: "Zulu",
          pathKnown: true,
          filesystemVerified: false,
          nativeApplicationVerified: true,
          platformEvidence: [
            {
              platform: "linux",
              kind: "ci-configured",
              source: ".github/workflows/ci.yml (cross-platform job)",
            },
          ],
        },
      ],
    });

    expect(blocks["catalog-coverage"]).toContain(
      "7 sources are selected by the bounded Stable policy",
    );
    expect(blocks["evidence-stages"]).toContain("**7 policy-selected**");
    expect(blocks["evidence-stages"]).not.toContain("recommended");
    expect(blocks["support-summary"]).toContain(
      "covers **2 agents**: Alpha, Zulu",
    );
    expect(blocks["support-summary"]).toContain("**2 agents**");
    expect(blocks["support-summary"]).toContain(
      "[complete feature matrix](./docs/FEATURE_TEST_MATRIX.md)",
    );
    expect(blocks["support-summary"]).not.toMatch(/^\|/m);
  });

  it("requires explicit conformance evidence instead of fabricating support rows", () => {
    expect(() =>
      // @ts-expect-error Deliberately omit required evidence to verify runtime callers fail closed.
      renderReadmeFactBlocksFromSources({
        coverage: {
          technicallyScreenedRecords: 0,
          recommendedRecords: 0,
          trustStages: {},
        },
        facts: {
          catalog: {
            records: 0,
            categories: 0,
            components: { skill: 0 },
            installShapes: { mcpOnly: 0 },
            noAssertionLicenses: 0,
          },
          agents: { supportedNames: [] },
        },
        packageJson: { scripts: { verify: "npm test" } },
      }),
    ).toThrow(/conformance evidence is required/i);
  });
});
