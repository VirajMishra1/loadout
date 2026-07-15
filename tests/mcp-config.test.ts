import { expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyMcpConfigPlan,
  planMcpConfig,
  restoreMcpConfig,
  summarizeMcpConfigPlan,
} from "../src/core/mcp.js";
import type { McpServer } from "../src/shared/types.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loadout-mcp-config-"));
  process.env.LOADOUT_HOME = join(root, ".loadout");
});
afterEach(async () => {
  delete process.env.LOADOUT_HOME;
  await rm(root, { recursive: true, force: true });
});

const server: McpServer = {
  name: "docs",
  command: "npx",
  args: ["-y", "server"],
  env: { TOKEN: "super-secret" },
  sourcePath: "repo/mcp.json",
  warnings: [],
};

it("plans while preserving unrelated keys and redacting secrets in output", async () => {
  const path = join(root, "claude.json");
  await writeFile(
    path,
    JSON.stringify({ theme: "dark", mcpServers: { old: { command: "old" } } }),
  );
  const plan = await planMcpConfig(path, server);
  expect(plan.proposed.theme).toBe("dark");
  expect(summarizeMcpConfigPlan(plan)).not.toContain("super-secret");
  expect(summarizeMcpConfigPlan(plan)).toContain("Add MCP server 'docs'");
});

it("applies atomically and restores exact previous config", async () => {
  const path = join(root, "codex.json");
  const original = JSON.stringify({ untouched: { value: 1 } });
  await writeFile(path, original);
  const plan = await planMcpConfig(path, server);
  const snapshot = await applyMcpConfigPlan(plan);
  const updated = JSON.parse(await readFile(path, "utf8"));
  expect(updated.untouched).toEqual({ value: 1 });
  expect(updated.mcpServers.docs.command).toBe("npx");
  expect(updated.mcpServers.docs.env.TOKEN).toBe("super-secret");
  await restoreMcpConfig(snapshot);
  expect(await readFile(path, "utf8")).toBe(original);
});

it("rejects malformed server names", async () => {
  await expect(
    planMcpConfig(join(root, "x.json"), server, "bad/name"),
  ).rejects.toThrow();
});
