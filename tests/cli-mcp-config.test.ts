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
});
