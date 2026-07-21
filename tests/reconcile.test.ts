import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DetectedAgent } from "../src/shared/types.js";
import type { CatalogSkillIndex } from "../src/core/provenance.js";
import {
  applyReconcilePlan,
  buildReconcilePlan,
  formatReconcilePlan,
} from "../src/core/reconcile.js";
import { repositoryCachePath } from "../src/core/source.js";
import { readInstallState } from "../src/core/state.js";
import { scanInstalledSkills } from "../src/core/skill-inventory.js";

const commit = "a".repeat(40);

describe("existing skill reconciliation", () => {
  const originalState = process.env.LOADOUT_HOME;
  const originalHome = process.env.LOADOUT_USER_HOME;
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
    if (originalState === undefined) delete process.env.LOADOUT_HOME;
    else process.env.LOADOUT_HOME = originalState;
    if (originalHome === undefined) delete process.env.LOADOUT_USER_HOME;
    else process.env.LOADOUT_USER_HOME = originalHome;
  });

  async function fixture(
    options: { outdated?: boolean; risky?: boolean } = {},
  ) {
    root = await mkdtemp(join(tmpdir(), "loadout-reconcile-"));
    process.env.LOADOUT_HOME = join(root, "state");
    process.env.LOADOUT_USER_HOME = join(root, "home");
    const source = join(
      repositoryCachePath("example/reviewed-skills", commit),
      "skills",
      "review",
    );
    const current = [
      "---",
      "name: review",
      "description: Reviewed workflow",
      "---",
      options.risky ? "See https://example.com/docs" : "Current instructions.",
      "",
    ].join("\n");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "SKILL.md"), current);
    await writeFile(join(source, "reference.md"), "current reference\n");
    const installations = [
      {
        agent: "claude-code" as const,
        root: join(root, "home", ".claude", "skills"),
      },
      {
        agent: "codex" as const,
        root: join(root, "home", ".codex", "skills"),
      },
    ];
    for (const installation of installations) {
      const target = join(installation.root, "review");
      await mkdir(target, { recursive: true });
      await writeFile(
        join(target, "SKILL.md"),
        options.outdated
          ? "---\nname: review\ndescription: Reviewed workflow\n---\nOld.\n"
          : current,
      );
      await writeFile(
        join(target, "reference.md"),
        options.outdated ? "old reference\n" : "current reference\n",
      );
    }
    const agents: DetectedAgent[] = [
      {
        id: "claude-code",
        displayName: "Claude Code",
        installed: true,
        skillsDirectory: installations[0].root,
      },
      {
        id: "codex",
        displayName: "Codex",
        installed: true,
        skillsDirectory: join(root, "home", ".agents", "skills"),
        additionalSkillsDirectories: [installations[1].root],
      },
    ];
    const index: CatalogSkillIndex = {
      schemaVersion: 1,
      catalogDigest: "digest",
      generatedAt: "2026-07-21T00:00:00.000Z",
      failures: [],
      records: [
        {
          packageId: "reviewed-skills",
          packageDisplayName: "Reviewed Skills",
          repository: "example/reviewed-skills",
          commit,
          tier: "stable",
          category: "review",
          license: "MIT",
          skillName: "review",
          description: "Reviewed workflow",
          skillPath: "skills/review",
          fingerprint: "fixture",
        },
      ],
    };
    return { agents, index, source, installations };
  }

  it("groups exact cross-agent mirrors and adopts them without changing bytes", async () => {
    const { agents, index, installations } = await fixture();
    const before = await readFile(
      join(installations[0].root, "review", "SKILL.md"),
      "utf8",
    );
    const plan = await buildReconcilePlan(agents, index);
    expect(plan.summary).toMatchObject({
      existing: 2,
      exact: 1,
      outdated: 0,
      mirroredGroups: 1,
    });
    expect(formatReconcilePlan(plan)).toContain("1 exact upstream match");

    const result = await applyReconcilePlan(plan);
    expect(result).toMatchObject({ adopted: 1, updated: 0 });
    expect(
      await readFile(join(installations[0].root, "review", "SKILL.md"), "utf8"),
    ).toBe(before);
    const state = await readInstallState();
    expect(state.installs).toEqual([
      expect.objectContaining({
        repository: "example/reviewed-skills",
        resolvedCommit: commit,
        targetAgents: ["claude-code", "codex"],
      }),
    ]);
    expect(state.activations).toHaveLength(2);
    const inventory = await scanInstalledSkills(agents);
    expect(inventory).toMatchObject({ total: 2, managed: 2, unmanaged: 0 });
  });

  it("requires explicit risk approval and replaces outdated mirrors atomically", async () => {
    const { agents, index, installations } = await fixture({
      outdated: true,
      risky: true,
    });
    const plan = await buildReconcilePlan(agents, index);
    expect(plan.summary).toMatchObject({ exact: 0, outdated: 1 });
    expect(plan.items[0]).toMatchObject({
      status: "outdated",
      approvalRequired: true,
    });
    await expect(
      applyReconcilePlan(plan, { replaceOutdated: true }),
    ).rejects.toThrow(/requires --approve-risk/);

    const result = await applyReconcilePlan(plan, {
      replaceOutdated: true,
      approveRisk: true,
    });
    expect(result).toMatchObject({ adopted: 0, updated: 1 });
    for (const installation of installations)
      expect(
        await readFile(
          join(installation.root, "review", "reference.md"),
          "utf8",
        ),
      ).toBe("current reference\n");
    expect((await readInstallState()).activations).toHaveLength(2);
  });

  it("uses an installed Git origin to disambiguate same-name catalog sources", async () => {
    const { agents, index, installations } = await fixture({ outdated: true });
    const gitDirectory = join(installations[0].root, "review", ".git");
    await mkdir(gitDirectory, { recursive: true });
    await writeFile(
      join(gitDirectory, "config"),
      '[remote "origin"]\n\turl = https://github.com/example/reviewed-skills.git\n',
    );
    index.records.push({
      ...index.records[0],
      packageId: "another-review",
      repository: "someone/another-review",
      commit: "b".repeat(40),
    });
    const alternate = join(
      repositoryCachePath("someone/another-review", "b".repeat(40)),
      "skills",
      "review",
    );
    await mkdir(alternate, { recursive: true });
    await writeFile(
      join(alternate, "SKILL.md"),
      "---\nname: review\ndescription: Another workflow\n---\nDifferent.\n",
    );
    const plan = await buildReconcilePlan(agents, index);
    expect(plan.items).toEqual([
      expect.objectContaining({
        status: "outdated",
        candidate: expect.objectContaining({
          repository: "example/reviewed-skills",
        }),
      }),
    ]);
  });
});
