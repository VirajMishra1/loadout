import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const cli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const entry = join(process.cwd(), "src", "cli.ts");

describe("mcp-config CLI", () => {
  it("shows help and keeps dry-run output free of environment values", async () => {
    const help = await run(process.execPath, [
      cli,
      entry,
      "mcp-config",
      "--help",
    ]);
    expect(help.stdout).toContain("--config <path>");
    expect(help.stdout).toContain("--env <NAME=VALUE>");

    const root = await mkdtemp(join(tmpdir(), "loadout-cli-mcp-"));
    const config = join(root, "mcp.json");
    try {
      const result = await run(process.execPath, [
        cli,
        entry,
        "mcp-config",
        "--config",
        config,
        "--name",
        "docs",
        "--command",
        "npx",
        "--arg",
        "-y",
        "--env",
        "TOKEN=secret-value",
      ]);
      expect(result.stdout).toContain("Dry run only");
      expect(result.stdout).not.toContain("secret-value");
      await expect(readFile(config, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("never launches a reviewed MCP artifact without explicit approval", async () => {
    await expect(
      run(process.execPath, [
        cli,
        entry,
        "mcp-recipe",
        "playwright",
        "--connect",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("explicit approveRisk"),
    });
  });

  it("requires a resolved credential reference before writing a credentialed recipe", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-cli-mcp-recipe-"));
    const config = join(root, "mcp.json");
    try {
      await expect(
        run(process.execPath, [
          cli,
          entry,
          "mcp-recipe",
          "github-readonly",
          "--config",
          config,
          "--yes",
        ]),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("requires a credential reference"),
      });

      const secret = "cli-test-secret";
      const result = await run(
        process.execPath,
        [
          cli,
          entry,
          "mcp-recipe",
          "github-readonly",
          "--config",
          config,
          "--credential",
          "GITHUB_PERSONAL_ACCESS_TOKEN=env:LOADOUT_TEST_GITHUB_TOKEN",
          "--yes",
        ],
        {
          env: { ...process.env, LOADOUT_TEST_GITHUB_TOKEN: secret },
        },
      );
      expect(result.stdout).not.toContain(secret);
      const persisted = JSON.parse(await readFile(config, "utf8"));
      expect(persisted.mcpServers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe(
        "${LOADOUT_TEST_GITHUB_TOKEN}",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
