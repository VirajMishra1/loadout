import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DetectedAgent } from "../src/shared/types.js";
import {
  formatInstalledSkillInventory,
  scanInstalledSkills,
} from "../src/core/skill-inventory.js";

describe("existing skill inventory", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    delete process.env.LOADOUT_HOME;
  });

  it("separates managed skills, within-agent duplicates, and cross-agent mirrors", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-inventory-"));
    process.env.LOADOUT_HOME = join(root, "state");
    const claudeRoot = join(root, "home", ".claude", "skills");
    const codexRoot = join(root, "home", ".agents", "skills");
    const create = async (
      base: string,
      directory: string,
      name: string,
      description = "Test skill",
    ) => {
      const target = join(base, directory);
      await mkdir(target, { recursive: true });
      const content = `---\nname: ${name}\ndescription: ${description}\n---\n`;
      await writeFile(join(target, "SKILL.md"), content);
      return { target, content };
    };
    const managed = await create(claudeRoot, "managed", "managed");
    await create(claudeRoot, "review-one", "review");
    await create(claudeRoot, "review-two", "review");
    await create(claudeRoot, "shared", "shared");
    await create(codexRoot, "shared", "shared");
    await mkdir(process.env.LOADOUT_HOME, { recursive: true });
    await writeFile(
      join(process.env.LOADOUT_HOME, "state.json"),
      JSON.stringify({
        version: 1,
        installs: [
          {
            packageId: "managed-package",
            targetAgents: ["claude-code"],
            files: [
              {
                path: join(managed.target, "SKILL.md"),
                sha256: createHash("sha256")
                  .update(managed.content)
                  .digest("hex"),
              },
            ],
            snapshotId: "snapshot",
            installedAt: "2026-07-15T00:00:00.000Z",
          },
        ],
        mcpInstalls: [],
      }),
    );
    const agents: DetectedAgent[] = [
      {
        id: "claude-code",
        displayName: "Claude Code",
        installed: true,
        skillsDirectory: claudeRoot,
      },
      {
        id: "codex",
        displayName: "Codex",
        installed: true,
        skillsDirectory: codexRoot,
      },
    ];

    const report = await scanInstalledSkills(agents);
    expect(report).toMatchObject({
      total: 5,
      managed: 1,
      unmanaged: 4,
      uniqueNames: 3,
    });
    expect(report.duplicates).toEqual([
      expect.objectContaining({ name: "review", kind: "within-agent" }),
      expect.objectContaining({
        name: "shared",
        kind: "cross-agent-mirror",
      }),
    ]);
    expect(formatInstalledSkillInventory(report)).toContain(
      "Read-only scan complete",
    );
  });
});
