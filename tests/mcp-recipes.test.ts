import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMcpConfigPlan } from "../src/core/mcp.js";
import { planMcpRecipe, verifyMcpRecipe } from "../src/core/mcp-recipes.js";

describe("reviewed MCP recipes", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("plans a reviewed recipe without a credential value and preserves unrelated JSON", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-mcp-recipe-"));
    const config = join(root, "mcp.json");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(config, JSON.stringify({ untouched: true })),
    );
    const plan = await planMcpRecipe("github-readonly", config);
    expect(JSON.stringify(plan)).not.toContain("secret");
    expect(plan.authorization.join(" ")).toContain(
      "GITHUB_PERSONAL_ACCESS_TOKEN",
    );
    await applyMcpConfigPlan(plan.config);
    const persisted = JSON.parse(await readFile(config, "utf8"));
    expect(persisted.untouched).toBe(true);
    expect(persisted.mcpServers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe(
      "${GITHUB_PERSONAL_ACCESS_TOKEN}",
    );
    await expect(
      verifyMcpRecipe("github-readonly", config),
    ).resolves.toMatchObject({ configured: true });
  });
});
