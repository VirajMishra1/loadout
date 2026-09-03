import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..");

describe("catalog command structure", () => {
  it("keeps the catalog coordinator below the command-module size limit", async () => {
    const source = await readFile(
      resolve(repositoryRoot, "src/commands/catalog.ts"),
      "utf8",
    );
    const lineCount = source.split("\n").length;

    expect(lineCount).toBeLessThanOrEqual(850);
  });
});
