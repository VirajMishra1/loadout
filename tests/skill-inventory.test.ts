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
  const originalLoadoutHome = process.env.LOADOUT_HOME;
  const originalUserHome = process.env.LOADOUT_USER_HOME;
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
    if (originalLoadoutHome === undefined) delete process.env.LOADOUT_HOME;
    else process.env.LOADOUT_HOME = originalLoadoutHome;
    if (originalUserHome === undefined) delete process.env.LOADOUT_USER_HOME;
    else process.env.LOADOUT_USER_HOME = originalUserHome;
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

  it("includes runtime-tool skills installed outside an agent's standard skill root", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-runtime-inventory-"));
    const stateHome = join(root, "state");
    const home = join(root, "home");
    process.env.LOADOUT_HOME = stateHome;
    process.env.LOADOUT_USER_HOME = home;
    const claudeRoot = join(home, ".claude", "skills");
    const codexRoot = join(home, ".agents", "skills");
    const targets = [
      join(home, ".claude", "skills", "graphify"),
      join(home, ".codex", "skills", "graphify"),
    ];
    for (const target of targets) {
      await mkdir(target, { recursive: true });
      await writeFile(
        join(target, "SKILL.md"),
        "---\nname: graphify\ndescription: Runtime graph tool\n---\n",
      );
    }
    await mkdir(stateHome, { recursive: true });
    await writeFile(
      join(stateHome, "runtime-tools.json"),
      JSON.stringify({
        schemaVersion: 1,
        tools: {
          graphify: {
            version: "0.9.17",
            installedAt: "2026-07-21T00:00:00.000Z",
            snapshotId: "snapshot",
            agents: ["claude-code", "codex"],
            runtimeRoot: join(stateHome, "runtime", "graphify"),
          },
        },
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
        additionalSkillsDirectories: [join(home, ".codex", "skills")],
      },
    ];

    const report = await scanInstalledSkills(agents);
    expect(report).toMatchObject({ total: 2, managed: 2, unmanaged: 0 });
    expect(report.skills).toEqual([
      expect.objectContaining({
        agent: "claude-code",
        packageId: "runtime-tool:graphify",
      }),
      expect.objectContaining({
        agent: "codex",
        packageId: "runtime-tool:graphify",
      }),
    ]);
    expect(report.agents).toEqual([
      expect.objectContaining({ managed: 1, runtimeToolTargets: 1 }),
      expect.objectContaining({ managed: 1, runtimeToolTargets: 1 }),
    ]);
    expect(formatInstalledSkillInventory(report)).toContain(
      "including 1 runtime-tool skill(s)",
    );
  });

  it("counts Codex skills from canonical and compatibility roots", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-codex-roots-"));
    process.env.LOADOUT_HOME = join(root, "state");
    process.env.LOADOUT_USER_HOME = join(root, "home");
    const canonical = join(root, "home", ".agents", "skills");
    const compatibility = join(root, "home", ".codex", "skills");
    for (const [base, name] of [
      [canonical, "canonical"],
      [compatibility, "compatibility"],
    ]) {
      const target = join(base, name);
      await mkdir(target, { recursive: true });
      await writeFile(
        join(target, "SKILL.md"),
        `---\nname: ${name}\ndescription: Test\n---\n`,
      );
    }
    const bundled = join(compatibility, ".system", "bundled");
    await mkdir(bundled, { recursive: true });
    await writeFile(
      join(bundled, "SKILL.md"),
      "---\nname: bundled\ndescription: Host managed\n---\n",
    );

    const report = await scanInstalledSkills([
      {
        id: "codex",
        displayName: "Codex",
        installed: true,
        skillsDirectory: canonical,
        additionalSkillsDirectories: [compatibility],
      },
    ]);
    expect(report).toMatchObject({ total: 2, managed: 0, unmanaged: 2 });
    expect(report.agents[0]).toMatchObject({
      total: 2,
      additionalDirectories: [compatibility],
    });
    expect(formatInstalledSkillInventory(report)).toContain(compatibility);
  });
});
