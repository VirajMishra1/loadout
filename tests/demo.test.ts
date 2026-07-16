import { afterEach, describe, expect, it } from "vitest";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatDemoResult, runIsolatedDemo } from "../src/core/demo.js";
import type { CatalogPackage } from "../src/shared/types.js";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("isolated demo mode", () => {
  const directories: string[] = [];
  const originalUserHome = process.env.LOADOUT_USER_HOME;
  const originalLoadoutHome = process.env.LOADOUT_HOME;

  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
    if (originalUserHome === undefined) delete process.env.LOADOUT_USER_HOME;
    else process.env.LOADOUT_USER_HOME = originalUserHome;
    if (originalLoadoutHome === undefined) delete process.env.LOADOUT_HOME;
    else process.env.LOADOUT_HOME = originalLoadoutHome;
  });

  async function createSkillSource(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "loadout-demo-source-"));
    directories.push(root);
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "SKILL.md"),
      "---\nname: demo-skill\ndescription: An isolated demo skill\n---\n\nUse the demo skill.\n",
    );
    return root;
  }

  it("installs and rolls back inside a disposable profile without changing process configuration", async () => {
    const source = await createSkillSource();
    process.env.LOADOUT_USER_HOME = "/real-user-home-must-not-be-touched";
    process.env.LOADOUT_HOME = "/real-loadout-home-must-not-be-touched";

    const result = await runIsolatedDemo({
      source,
      packageId: "demo-skill",
      agents: ["codex"],
    });

    expect(result.repository).toContain("local source:");
    expect(result.reviewed).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(result.cleanedUp).toBe(true);
    expect(await pathExists(result.profile)).toBe(false);
    expect(await readFile(join(source, "SKILL.md"), "utf8")).toContain(
      "demo-skill",
    );
    expect(process.env.LOADOUT_USER_HOME).toBe(
      "/real-user-home-must-not-be-touched",
    );
    expect(process.env.LOADOUT_HOME).toBe(
      "/real-loadout-home-must-not-be-touched",
    );
    expect(formatDemoResult(result)).toContain(
      "Installed 1 planned skill directory(ies); tracking 1 file(s).",
    );
  });

  it("fetches a catalog repository at its immutable reviewed commit", async () => {
    const source = await createSkillSource();
    const commit = "a".repeat(40);
    const catalog: CatalogPackage[] = [
      {
        id: "obra-superpowers",
        displayName: "Superpowers",
        repository: "obra/superpowers",
        description: "Reviewed demo",
        category: "workflow",
        tier: "stable",
        components: ["skill"],
        source: {
          type: "github",
          url: "https://github.com/obra/superpowers",
          defaultBranch: "main",
          commit,
          evidencePaths: ["SKILL.md"],
          verifiedAt: "2026-07-16T00:00:00Z",
        },
      },
    ];
    const requests: Array<{ repository: string; ref?: string }> = [];
    const result = await runIsolatedDemo({
      catalog,
      fetchSnapshot: async (repository, options) => {
        requests.push({ repository, ref: options?.ref });
        return { repository, commit, path: source };
      },
    });
    expect(requests).toEqual([{ repository: "obra/superpowers", ref: commit }]);
    expect(result.reviewed).toBe(true);
    expect(formatDemoResult(result)).toContain("Reviewed source:");
  });

  it("can retain a still-isolated profile for a presenter to inspect", async () => {
    const source = await createSkillSource();
    const result = await runIsolatedDemo({
      source,
      packageId: "demo-skill",
      agents: ["codex", "claude-code"],
      keep: true,
    });
    directories.push(result.profile);

    expect(result.rolledBack).toBe(false);
    expect(result.cleanedUp).toBe(false);
    expect(
      await readFile(
        join(result.profile, ".agents", "skills", "demo-skill", "SKILL.md"),
        "utf8",
      ),
    ).toContain("demo-skill");
    expect(
      await readFile(
        join(result.profile, ".claude", "skills", "demo-skill", "SKILL.md"),
        "utf8",
      ),
    ).toContain("demo-skill");
  });
});
