import { afterEach, describe, expect, it } from "vitest";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CatalogPackage,
  DetectedAgent,
  HealthReport,
} from "../src/shared/types.js";
import {
  applyUpgrade,
  formatUpgradePlan,
  planUpgrade,
  summarizeUpgradePlan,
} from "../src/core/upgrade.js";

const commit = "a".repeat(40);

describe("unified upgrade journey", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    delete process.env.LOADOUT_HOME;
    delete process.env.LOADOUT_USER_HOME;
  });

  it("previews project, health, recommendations, exact targets, and guarantees before one apply", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-upgrade-"));
    process.env.LOADOUT_HOME = join(root, "state");
    process.env.LOADOUT_USER_HOME = join(root, "home");
    const project = join(root, "project");
    const source = join(root, "source", "skill");
    const target = join(root, "home", ".codex", "skills");
    await mkdir(project, { recursive: true });
    await writeFile(
      join(project, "package.json"),
      '{"dependencies":{"react":"1"}}',
    );
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: useful\ndescription: Useful reviewed skill\n---\n",
    );
    const pkg: CatalogPackage = {
      id: "useful",
      displayName: "Useful",
      repository: "example/useful",
      description: "Useful",
      category: "testing",
      tier: "stable",
      license: "MIT",
      components: ["skill"],
      source: {
        type: "github",
        url: "https://github.com/example/useful",
        defaultBranch: "main",
        commit,
        evidencePaths: ["skill/SKILL.md"],
        verifiedAt: "2026-07-16T00:00:00.000Z",
      },
    };
    const agent: DetectedAgent = {
      id: "codex",
      displayName: "Codex",
      installed: true,
      skillsDirectory: target,
    };
    const health: HealthReport = {
      status: "healthy",
      generatedAt: "2026-07-16T00:00:00.000Z",
      agents: [agent],
      installedPackages: 0,
      updatesChecked: false,
      updatesAvailable: 0,
      driftedFiles: 0,
      driftedMcpServers: 0,
      findings: [],
    };
    const plan = await planUpgrade(
      { mode: "custom", packageIds: ["useful"] },
      {
        projectPath: project,
        catalog: [pkg],
        detectedAgents: [agent],
        health: async () => health,
        healthScores: async () => [],
        now: () => new Date("2026-07-16T01:00:00.000Z"),
        fetchSnapshot: async () => ({
          repository: pkg.repository,
          commit,
          path: join(root, "source"),
        }),
      },
    );

    await expect(access(join(target, "skill", "SKILL.md"))).rejects.toThrow();
    expect(plan.project.frameworks).toContain("react");
    expect(plan.riskApprovalRequired).toBe(false);
    expect(formatUpgradePlan(plan)).toContain("Loadout upgrade preview");
    expect(summarizeUpgradePlan(plan)).toMatchObject({
      mode: "custom",
      install: { repositoryCount: 1, targetDirectoryCount: 1 },
    });

    const result = await applyUpgrade(plan, {
      health: async () => health,
      healthScores: async () => [],
    });
    expect(result.snapshotId).toBeTruthy();
    expect(await readFile(join(target, "skill", "SKILL.md"), "utf8")).toContain(
      "Useful reviewed skill",
    );
  });

  it("requires the separate risk approval recorded by the preview", async () => {
    const plan = {
      riskApprovalRequired: true,
    } as Awaited<ReturnType<typeof planUpgrade>>;
    await expect(applyUpgrade(plan)).rejects.toThrow(/--approve-risk/);
  });
});
