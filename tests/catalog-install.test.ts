import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyPreparedCatalogInstall,
  formatPreparedCatalogInstall,
  prepareCatalogInstall,
} from "../src/core/catalog-install.js";
import type { CatalogPackage, DetectedAgent } from "../src/shared/types.js";

const commit = "a".repeat(40);

describe("CLI-first catalog setup", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("prepares pinned skill repositories and defers explicit MCP setup", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-catalog-setup-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const source = join(root, "source", "skill");
    const target = join(root, "home", ".codex", "skills");
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: useful\ndescription: Useful reviewed skill\n---\n",
    );
    const skill: CatalogPackage = {
      id: "useful-skill",
      displayName: "Useful Skill",
      repository: "example/useful-skill",
      description: "Useful",
      category: "test",
      tier: "stable",
      components: ["skill"],
      source: {
        type: "github",
        url: "https://github.com/example/useful-skill",
        defaultBranch: "main",
        commit,
        evidencePaths: ["skill/SKILL.md"],
        verifiedAt: "2026-07-15T00:00:00Z",
      },
    };
    const mcp: CatalogPackage = {
      ...skill,
      id: "explicit-mcp",
      displayName: "Explicit MCP",
      repository: "example/explicit-mcp",
      components: ["mcp"],
      source: {
        ...skill.source!,
        url: "https://github.com/example/explicit-mcp",
      },
    };
    const agent: DetectedAgent = {
      id: "codex",
      displayName: "Codex",
      installed: true,
      skillsDirectory: target,
    };
    const fetches: Array<{ repository: string; ref?: string }> = [];

    const prepared = await prepareCatalogInstall(
      { mode: "maximum" },
      {
        catalog: [skill, mcp],
        detectedAgents: [agent],
        fetchSnapshot: async (repository, options) => {
          fetches.push({ repository, ref: options?.ref });
          return { repository, commit, path: join(root, "source") };
        },
      },
    );

    expect(fetches).toEqual([
      { repository: "example/useful-skill", ref: commit },
    ]);
    expect(prepared.entries).toHaveLength(1);
    expect(prepared.skipped).toEqual([
      expect.objectContaining({ packageId: "explicit-mcp" }),
    ]);
    expect(formatPreparedCatalogInstall(prepared)).toContain(
      "Ready to install: 1 skill repositories",
    );

    const snapshot = await applyPreparedCatalogInstall(prepared);
    expect(snapshot).toBeTruthy();
    expect(await readFile(join(target, "skill", "SKILL.md"), "utf8")).toContain(
      "Useful reviewed skill",
    );
  });

  it("refuses setup when no supported agent is installed", async () => {
    await expect(
      prepareCatalogInstall(
        { mode: "maximum" },
        { catalog: [], detectedAgents: [] },
      ),
    ).rejects.toThrow(/No supported AI coding agent/);
  });

  it("keeps the higher-ranked source when broad collections share a skill target", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-catalog-collision-"));
    const target = join(root, "home", ".codex", "skills");
    const agent: DetectedAgent = {
      id: "codex",
      displayName: "Codex",
      installed: true,
      skillsDirectory: target,
    };
    const sources = new Map<string, string>();
    for (const id of ["official", "stable"]) {
      const source = join(root, id, "shared");
      await mkdir(source, { recursive: true });
      await writeFile(
        join(source, "SKILL.md"),
        `---\nname: shared\ndescription: ${id} source\n---\n`,
      );
      sources.set(`example/${id}`, join(root, id));
    }
    const catalog = (["official", "stable"] as const).map(
      (tier, index): CatalogPackage => ({
        id: `${tier}-collection`,
        displayName: `${tier} collection`,
        repository: `example/${tier}`,
        description: tier,
        category: "test",
        tier,
        components: ["skill"],
        source: {
          type: "github",
          url: `https://github.com/example/${tier}`,
          defaultBranch: "main",
          commit: String(index + 1).repeat(40),
          evidencePaths: ["shared/SKILL.md"],
          verifiedAt: "2026-07-15T00:00:00Z",
        },
      }),
    );

    const prepared = await prepareCatalogInstall(
      { mode: "maximum" },
      {
        catalog,
        detectedAgents: [agent],
        fetchSnapshot: async (repository, options) => ({
          repository,
          commit: options!.ref!,
          path: sources.get(repository)!,
        }),
      },
    );

    expect(prepared.entries.map((entry) => entry.package.id)).toEqual([
      "official-collection",
    ]);
    expect(prepared.collisions).toEqual([
      expect.objectContaining({
        keptPackageId: "official-collection",
        deferredPackageId: "stable-collection",
      }),
    ]);
    expect(prepared.skipped).toEqual([
      expect.objectContaining({ packageId: "stable-collection" }),
    ]);
  });
});
