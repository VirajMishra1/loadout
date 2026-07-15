import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffRepositorySnapshots } from "../src/core/diff.js";

describe("repository diff", () => {
  it("reports safe changes to skills, MCP manifests, and config files", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-diff-"));
    const oldPath = join(root, "old");
    const newPath = join(root, "new");
    try {
      await mkdir(join(oldPath, "skills"), { recursive: true });
      await mkdir(join(newPath, "skills"), { recursive: true });
      await writeFile(join(oldPath, "skills", "SKILL.md"), "old");
      await writeFile(join(oldPath, "mcp.json"), "{}\n");
      await writeFile(join(oldPath, "removed-config.json"), "{}\n");
      await writeFile(join(newPath, "skills", "SKILL.md"), "new");
      await writeFile(join(newPath, "mcp.json"), '{"mcpServers":{}}\n');
      await writeFile(join(newPath, "config.json"), "{}\n");
      await writeFile(join(newPath, "README.md"), "ignored");
      expect(await diffRepositorySnapshots(oldPath, newPath)).toEqual([
        { path: "config.json", kind: "config", status: "added" },
        { path: "mcp.json", kind: "mcp", status: "changed" },
        { path: "removed-config.json", kind: "config", status: "removed" },
        { path: "skills/SKILL.md", kind: "skill", status: "changed" },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not inspect or execute unrelated files", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-diff-"));
    try {
      await expect(
        diffRepositorySnapshots(
          join(root, "missing-old"),
          join(root, "missing-new"),
        ),
      ).resolves.toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
