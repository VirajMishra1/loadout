import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  replaceGeneratedBlock,
  renderReadmeFactBlocks,
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

  it("keeps the verification commands in the order verify executes them", async () => {
    const blocks = await renderReadmeFactBlocks();

    expect(blocks["verification-summary"]).toContain(
      "`check:evidence`, `test`, `test:e2e:cli`",
    );
    expect(blocks["evidence-stages"]).toContain(
      "| Stage          | Records |\n| -------------- | ------: |",
    );
  });
});
