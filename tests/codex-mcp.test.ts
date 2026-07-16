import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyCodexMcpConfigPlan,
  planCodexMcpConfig,
} from "../src/core/codex-mcp.js";
import type { McpServer } from "../src/shared/types.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loadout-codex-mcp-"));
  process.env.LOADOUT_HOME = join(root, ".loadout");
});
afterEach(async () => {
  delete process.env.LOADOUT_HOME;
  await rm(root, { recursive: true, force: true });
});

const server: McpServer = {
  name: "context7",
  command: "npx",
  args: ["-y", "@upstash/context7-mcp"],
  env: { API_TOKEN: "secret" },
  sourcePath: "mcp.json",
  warnings: [],
};

describe("Codex TOML MCP configuration", () => {
  it("preserves existing TOML and appends a safe server table", async () => {
    const path = join(root, "config.toml");
    await writeFile(path, 'model = "gpt-5"\n# preserve this comment\n');
    const plan = await planCodexMcpConfig(path, server);
    expect(plan.summary).not.toContain("secret");
    const snapshot = await applyCodexMcpConfigPlan(plan);
    const content = await readFile(path, "utf8");
    expect(content).toContain("# preserve this comment");
    expect(content).toContain('[mcp_servers."context7"]');
    expect(content).toContain('API_TOKEN = "secret"');
    expect(snapshot.existed).toBe(true);
  });

  it("refuses to overwrite an existing server table", async () => {
    const path = join(root, "config.toml");
    await writeFile(path, '[mcp_servers."context7"]\ncommand = "old"\n');
    await expect(planCodexMcpConfig(path, server)).rejects.toThrow(
      "already exists",
    );
  });

  it("refuses to overwrite TOML changed after preview", async () => {
    const path = join(root, "config.toml");
    await writeFile(path, 'model = "gpt-5"\n');
    const plan = await planCodexMcpConfig(path, server);
    await writeFile(path, 'model = "newer"\n');
    await expect(applyCodexMcpConfigPlan(plan)).rejects.toThrow(
      /changed after preview/,
    );
    expect(await readFile(path, "utf8")).toBe('model = "newer"\n');
  });
});
