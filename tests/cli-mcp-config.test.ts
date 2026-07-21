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

  it("previews, configures, verifies, and removes a reviewed Codex recipe", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-cli-codex-recipe-"));
    const env = {
      ...process.env,
      LOADOUT_HOME: join(root, "state"),
      LOADOUT_USER_HOME: join(root, "user"),
      NO_COLOR: "1",
    };
    const config = join(root, "user", ".codex", "config.toml");
    try {
      const preview = await run(
        process.execPath,
        [cli, entry, "mcp-recipe", "playwright", "--agent", "codex"],
        { env },
      );
      expect(preview.stdout).toContain("Target: Codex");
      expect(preview.stdout).toContain("Dry run only");
      await expect(readFile(config, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });

      const applied = await run(
        process.execPath,
        [cli, entry, "mcp-recipe", "playwright", "--agent", "codex", "--yes"],
        { env },
      );
      expect(applied.stdout).toContain("Configured for Codex");
      expect(await readFile(config, "utf8")).toContain(
        '[mcp_servers."playwright"]',
      );

      const verified = await run(
        process.execPath,
        [
          cli,
          entry,
          "mcp-recipe",
          "playwright",
          "--agent",
          "codex",
          "--verify",
        ],
        { env },
      );
      expect(verified.stdout).toContain("Configured: playwright");

      const health = await run(
        process.execPath,
        [cli, entry, "health", "--json"],
        { env },
      );
      expect(JSON.parse(health.stdout)).toMatchObject({
        driftedMcpServers: 0,
      });

      const rolledBack = await run(process.execPath, [cli, entry, "rollback"], {
        env,
      });
      expect(rolledBack.stdout).toContain("configure Codex MCP playwright");
      await expect(readFile(config, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        readFile(join(root, "state", "state.json"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });

      await run(
        process.execPath,
        [cli, entry, "mcp-recipe", "playwright", "--agent", "codex", "--yes"],
        { env },
      );

      await run(
        process.execPath,
        [cli, entry, "remove", "mcp-recipe:playwright:codex", "--yes"],
        { env },
      );
      expect(await readFile(config, "utf8")).not.toContain(
        '[mcp_servers."playwright"]',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("previews, configures, verifies, and removes a reviewed Claude Code recipe", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-cli-claude-recipe-"));
    const env = {
      ...process.env,
      LOADOUT_HOME: join(root, "state"),
      LOADOUT_USER_HOME: join(root, "user"),
      NO_COLOR: "1",
    };
    const config = join(root, "user", ".claude.json");
    try {
      const preview = await run(
        process.execPath,
        [cli, entry, "mcp-recipe", "playwright", "--agent", "claude-code"],
        { env },
      );
      expect(preview.stdout).toContain("Target: Claude Code");
      expect(preview.stdout).toContain("Dry run only");

      await run(
        process.execPath,
        [
          cli,
          entry,
          "mcp-recipe",
          "playwright",
          "--agent",
          "claude-code",
          "--yes",
        ],
        { env },
      );
      expect(JSON.parse(await readFile(config, "utf8"))).toHaveProperty(
        "mcpServers.playwright",
      );

      const verified = await run(
        process.execPath,
        [
          cli,
          entry,
          "mcp-recipe",
          "playwright",
          "--agent",
          "claude-code",
          "--verify",
        ],
        { env },
      );
      expect(verified.stdout).toContain("Configured: playwright");

      await run(
        process.execPath,
        [cli, entry, "remove", "mcp-recipe:playwright:claude-code", "--yes"],
        { env },
      );
      expect(JSON.parse(await readFile(config, "utf8"))).not.toHaveProperty(
        "mcpServers.playwright",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
