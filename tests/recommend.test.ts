import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recommendPackages, scanProject } from "../src/core/recommend.js";
import type { CatalogPackage } from "../src/shared/types.js";

describe("project recommendations", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });
  it("explains web recommendations from local project signals", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-recommend-"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        dependencies: { next: "1", react: "1" },
        devDependencies: { "@playwright/test": "1" },
      }),
    );
    const signals = await scanProject(root);
    const ids = ["superpowers", "context7", "ui-ux-pro-max", "playwright-mcp"];
    const catalog = ids.map((id) => ({
      id,
      displayName: id,
      repository: `x/${id}`,
      description: id,
      category: "x",
      tier: "stable",
    })) as CatalogPackage[];
    expect(signals.frameworks).toEqual(
      expect.arrayContaining(["next.js", "react", "playwright"]),
    );
    expect(
      recommendPackages(signals, catalog).map((item) => item.packageId),
    ).toEqual(ids);
  });
});
