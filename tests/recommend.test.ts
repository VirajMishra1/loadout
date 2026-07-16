import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  personalizeRecommendations,
  recommendPackages,
  scanProject,
} from "../src/core/recommend.js";
import type { LocalOutcomeStore } from "../src/core/outcomes.js";
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

  it("uses agent-scoped local outcomes without introducing new packages", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-recommend-outcomes-"));
    await writeFile(join(root, "package.json"), JSON.stringify({}));
    const signals = await scanProject(root);
    const baseline = [
      {
        packageId: "superpowers",
        reason: "baseline",
        confidence: "high" as const,
      },
      {
        packageId: "context7",
        reason: "baseline",
        confidence: "medium" as const,
      },
    ];
    const outcomes: LocalOutcomeStore = {
      schemaVersion: 1,
      privacy: "local-only-no-project-or-content",
      events: [
        {
          id: "1",
          recordedAt: "2026-07-16T00:00:00Z",
          selector: "superpowers/review",
          agent: "codex",
          taskFamily: "javascript",
          result: "rollback",
        },
        {
          id: "2",
          recordedAt: "2026-07-16T00:00:00Z",
          selector: "context7/docs",
          agent: "codex",
          taskFamily: "general",
          result: "success",
        },
      ],
    };
    const personalized = personalizeRecommendations(
      baseline,
      signals,
      outcomes,
      "codex",
    );
    expect(personalized.map((item) => item.packageId)).toEqual([
      "context7",
      "superpowers",
    ]);
    expect(personalized[1].confidence).toBe("medium");
    expect(
      personalized.every((item) =>
        baseline.some((base) => base.packageId === item.packageId),
      ),
    ).toBe(true);
  });
});
