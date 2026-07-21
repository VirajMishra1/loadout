import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyPreparedCatalogInstall,
  formatCatalogApplyGuidance,
  formatPreparedCatalogInstall,
  prepareCatalogInstall,
} from "../src/core/catalog-install.js";
import type { CatalogPackage, DetectedAgent } from "../src/shared/types.js";
import { activationLibraryPath, readInstallState } from "../src/core/state.js";
import { applySkillInstallBatch, buildSkillPlan } from "../src/core/install.js";
import { readSnapshot, restoreSnapshot } from "../src/core/snapshot.js";

const commit = "a".repeat(40);

describe("CLI-first catalog setup", () => {
  it("includes every required approval flag in risky preview guidance", () => {
    expect(formatCatalogApplyGuidance(false)).toBe(
      "Preview complete; nothing was changed. Re-run with --yes to install this exact screened plan.",
    );
    expect(formatCatalogApplyGuidance(true)).toBe(
      "Preview complete; nothing was changed. Inspect the plan with --details, then re-run with --yes --approve-risk only if you accept every reported finding.",
    );
  });

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
    expect(
      await readFile(
        join(
          activationLibraryPath("useful-skill", "codex", "skill"),
          "skill",
          "SKILL.md",
        ),
        "utf8",
      ),
    ).toContain("Useful reviewed skill");
    await expect(
      readFile(join(target, "skill", "SKILL.md"), "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    const state = await readInstallState();
    expect(state.profile).toMatchObject({
      mode: "maximum",
      agents: ["codex"],
    });
    expect(state.activations).toEqual([
      expect.objectContaining({
        packageId: "useful-skill",
        cacheState: "downloaded",
        activationState: "disabled",
      }),
    ]);
    expect(state.installs[0].staticAssessment).toMatchObject({
      status: "clear",
      findingCount: 0,
      policy: "install-safety-v1",
    });
    await restoreSnapshot(await readSnapshot(snapshot), {
      requireUnchangedPostMutationState: true,
    });
    expect((await readInstallState()).installs).toEqual([]);
  });

  it("previews active managed skills that an exact profile will retire", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-profile-retirement-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const target = join(root, "home", ".codex", "skills");
    const agent: DetectedAgent = {
      id: "codex",
      displayName: "Codex",
      installed: true,
      skillsDirectory: target,
    };
    const oldSource = join(root, "old-source");
    await mkdir(oldSource, { recursive: true });
    await writeFile(
      join(oldSource, "SKILL.md"),
      "---\nname: old-only\ndescription: Existing profile skill\n---\n",
    );
    await applySkillInstallBatch([
      { plan: await buildSkillPlan(oldSource, "old-only", [agent]) },
    ]);

    const newSource = join(root, "new-source");
    await mkdir(newSource, { recursive: true });
    await writeFile(
      join(newSource, "SKILL.md"),
      "---\nname: new-only\ndescription: Replacement profile skill\n---\n",
    );
    const pkg: CatalogPackage = {
      id: "new-only",
      displayName: "New Only",
      repository: "example/new-only",
      description: "Replacement",
      category: "test",
      tier: "stable",
      components: ["skill"],
      source: {
        type: "github",
        url: "https://github.com/example/new-only",
        defaultBranch: "main",
        commit,
        evidencePaths: ["SKILL.md"],
        verifiedAt: "2026-07-15T00:00:00Z",
      },
    };
    const prepared = await prepareCatalogInstall(
      { mode: "custom", packageIds: ["new-only"] },
      {
        catalog: [pkg],
        detectedAgents: [agent],
        fetchSnapshot: async () => ({
          repository: pkg.repository,
          commit,
          path: newSource,
        }),
      },
    );

    expect(prepared.reconciliation!.obsoleteTargets).toEqual([
      join(target, "old-only"),
    ]);
    expect(formatPreparedCatalogInstall(prepared)).toContain(
      "Profile reconciliation: 1 active managed skill will be retired",
    );
  });

  it("quarantines an invalid Maximum skill without discarding its safe siblings", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-maximum-quarantine-"));
    const repository = join(root, "repository");
    const safe = join(repository, "skills", "safe-skill");
    const invalid = join(repository, "skills", "invalid-skill");
    await mkdir(safe, { recursive: true });
    await mkdir(invalid, { recursive: true });
    await writeFile(
      join(safe, "SKILL.md"),
      "---\nname: safe-skill\ndescription: A valid reviewed skill\n---\n",
    );
    await writeFile(
      join(invalid, "SKILL.md"),
      "---\nname: invalid-skill\n---\n",
    );
    const pkg: CatalogPackage = {
      id: "mixed-collection",
      displayName: "Mixed Collection",
      repository: "example/mixed-collection",
      description: "Contains one safe and one invalid skill",
      category: "test",
      tier: "stable",
      components: ["skill"],
      source: {
        type: "github",
        url: "https://github.com/example/mixed-collection",
        defaultBranch: "main",
        commit,
        evidencePaths: ["skills/safe-skill/SKILL.md"],
        verifiedAt: "2026-07-15T00:00:00Z",
      },
    };
    const prepared = await prepareCatalogInstall(
      { mode: "maximum" },
      {
        catalog: [pkg],
        detectedAgents: [
          {
            id: "codex",
            displayName: "Codex",
            installed: true,
            skillsDirectory: join(root, "home", ".codex", "skills"),
          },
        ],
        fetchSnapshot: async () => ({
          repository: pkg.repository,
          commit,
          path: repository,
        }),
      },
    );

    expect(prepared.entries).toHaveLength(1);
    expect(prepared.entries[0].plan.files).toHaveLength(1);
    expect(prepared.entries[0].plan.files[0].target).toMatch(/safe-skill$/);
    expect(prepared.skipped).toEqual([
      expect.objectContaining({
        packageId: "mixed-collection",
        unitId: "invalid-skill",
        kind: "quarantined",
      }),
    ]);
    expect(formatPreparedCatalogInstall(prepared)).toContain(
      "Quarantined invalid skill units: 1",
    );
    expect(formatPreparedCatalogInstall(prepared)).not.toContain(
      "mixed-collection/invalid-skill",
    );
    expect(formatPreparedCatalogInstall(prepared, { details: true })).toContain(
      "mixed-collection/invalid-skill",
    );
  });

  it("quarantines an invalid selected Power skill without discarding its safe siblings", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-power-quarantine-"));
    const repository = join(root, "repository");
    const safe = join(repository, "skills", "using-superpowers");
    const invalid = join(repository, "skills", "writing-skills");
    await mkdir(safe, { recursive: true });
    await mkdir(invalid, { recursive: true });
    await writeFile(
      join(safe, "SKILL.md"),
      "---\nname: using-superpowers\ndescription: A valid reviewed skill\n---\n",
    );
    await writeFile(
      join(invalid, "SKILL.md"),
      "---\nname: writing-skills\n---\n",
    );
    const pkg: CatalogPackage = {
      id: "superpowers",
      displayName: "Superpowers",
      repository: "example/superpowers",
      description: "Contains one safe and one invalid selected Power skill",
      category: "test",
      tier: "stable",
      components: ["skill"],
      source: {
        type: "github",
        url: "https://github.com/example/superpowers",
        defaultBranch: "main",
        commit,
        evidencePaths: ["skills/using-superpowers/SKILL.md"],
        verifiedAt: "2026-07-15T00:00:00Z",
      },
    };
    const prepared = await prepareCatalogInstall(
      { mode: "power" },
      {
        catalog: [pkg],
        detectedAgents: [
          {
            id: "codex",
            displayName: "Codex",
            installed: true,
            skillsDirectory: join(root, "home", ".codex", "skills"),
          },
        ],
        fetchSnapshot: async () => ({
          repository: pkg.repository,
          commit,
          path: repository,
        }),
      },
    );

    expect(prepared.entries).toHaveLength(1);
    expect(prepared.entries[0].plan.files).toHaveLength(1);
    expect(prepared.entries[0].plan.files[0].target).toMatch(
      /using-superpowers$/,
    );
    expect(prepared.skipped).toEqual([
      expect.objectContaining({
        packageId: "superpowers",
        unitId: "writing-skills",
        kind: "quarantined",
      }),
    ]);
    expect(formatPreparedCatalogInstall(prepared)).not.toContain(
      "Preparation failures",
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

  it("warns when a broad plan exceeds the recommended active skill budget", async () => {
    const prepared = {
      selection: { mode: "maximum" as const },
      access: { modelApis: [] },
      resolution: {
        mode: "maximum" as const,
        packages: [],
        deferred: [],
        conflicts: [],
        warnings: [],
      },
      agents: [
        {
          id: "codex" as const,
          displayName: "Codex",
          installed: true,
          skillsDirectory: "/tmp/skills",
        },
      ],
      entries: [
        {
          package: {
            id: "large",
            displayName: "Large",
            repository: "example/large",
            description: "Large",
            category: "test",
            tier: "stable" as const,
          },
          plan: {
            packageId: "large",
            targetAgents: ["codex" as const],
            warnings: [],
            files: Array.from({ length: 31 }, (_, index) => ({
              source: `/source/${index}`,
              target: `/tmp/skills/${index}`,
            })),
          },
          safety: { approvalRequired: false, findings: [] },
        },
      ],
      skipped: [],
      collisions: [],
    };
    expect(formatPreparedCatalogInstall(prepared)).toContain(
      "exceeds Stable's 30-skill bound",
    );
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
