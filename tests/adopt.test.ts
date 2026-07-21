import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applySkillAdoption, planSkillAdoption } from "../src/core/adopt.js";
import { readInstallState } from "../src/core/state.js";
import type { DetectedAgent } from "../src/shared/types.js";
import type { CatalogSkillIndex } from "../src/core/provenance.js";

function exactIndex(fingerprint: string): CatalogSkillIndex {
  return {
    schemaVersion: 1,
    catalogDigest: "catalog",
    generatedAt: new Date(0).toISOString(),
    failures: [],
    records: [
      {
        packageId: "catalog-skill",
        packageDisplayName: "Catalog Skill",
        repository: "https://example.com/catalog.git",
        commit: "a".repeat(40),
        tier: "stable",
        category: "test",
        skillName: "my-skill",
        skillPath: "my-skill/SKILL.md",
        fingerprint,
      },
    ],
  };
}

describe("explicit unmanaged skill adoption", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("records ownership without changing the selected skill bytes", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-adopt-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const skillsDirectory = join(root, "skills");
    const skillPath = join(skillsDirectory, "my-skill");
    const content =
      "---\nname: my-skill\ndescription: Existing local skill\n---\nBody\n";
    await mkdir(skillPath, { recursive: true });
    await writeFile(join(skillPath, "SKILL.md"), content);
    await mkdir(join(skillPath, "references"));
    await writeFile(
      join(skillPath, "references", "guide.txt"),
      "accepted bytes",
    );
    const agent: DetectedAgent = {
      id: "codex",
      displayName: "Codex",
      installed: true,
      skillsDirectory,
    };

    const plan = await planSkillAdoption("my-skill", agent);
    expect(plan.treeEvidence).toEqual([
      { path: "references", type: "directory" },
      {
        path: "references/guide.txt",
        type: "file",
        sha256: createHash("sha256").update("accepted bytes").digest("hex"),
      },
      {
        path: "SKILL.md",
        type: "file",
        sha256: createHash("sha256").update(content).digest("hex"),
      },
    ]);
    expect(plan.reviewed).toBe(false);
    const snapshot = await applySkillAdoption(plan);
    expect(snapshot).toBeTruthy();
    expect(await readFile(join(skillPath, "SKILL.md"), "utf8")).toBe(content);
    const state = await readInstallState();
    expect(state.installs[0].packageId).toBe("adopted-codex-my-skill");
    expect(state.installs[0].ownershipOrigin).toBe("adopted");
    expect(state.installs[0].files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: join(skillPath, "references", "guide.txt"),
          sha256: createHash("sha256").update("accepted bytes").digest("hex"),
        }),
      ]),
    );
    expect(state.activations?.[0]).toMatchObject({
      unitId: "my-skill",
      activationState: "active",
      reviewState: "unreviewed",
    });
  });

  it.each([
    [
      "changed",
      async (path: string) => writeFile(join(path, "extra.txt"), "changed"),
    ],
    [
      "added",
      async (path: string) => writeFile(join(path, "added.txt"), "new"),
    ],
    ["removed", async (path: string) => rm(join(path, "extra.txt"))],
    [
      "type-changed",
      async (path: string) => {
        await rm(join(path, "extra.txt"));
        await mkdir(join(path, "extra.txt"));
      },
    ],
  ])(
    "refuses adoption when an auxiliary file is %s after preview",
    async (_name, mutate) => {
      root = await mkdtemp(join(tmpdir(), "loadout-adopt-drift-"));
      process.env.LOADOUT_HOME = join(root, ".loadout");
      const skillsDirectory = join(root, "skills");
      const skillPath = join(skillsDirectory, "my-skill");
      await mkdir(skillPath, { recursive: true });
      await writeFile(
        join(skillPath, "SKILL.md"),
        "---\nname: my-skill\ndescription: Test\n---\n",
      );
      await writeFile(join(skillPath, "extra.txt"), "original");
      const agent: DetectedAgent = {
        id: "codex",
        displayName: "Codex",
        installed: true,
        skillsDirectory,
      };
      const plan = await planSkillAdoption("my-skill", agent);
      await mutate(skillPath);
      await expect(applySkillAdoption(plan)).rejects.toThrow(
        "changed after preview",
      );
      expect((await readInstallState()).installs).toEqual([]);
    },
  );

  it("rejects symlinks, including links escaping the skill root", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-adopt-link-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const skillsDirectory = join(root, "skills");
    const skillPath = join(skillsDirectory, "my-skill");
    await mkdir(skillPath, { recursive: true });
    await writeFile(
      join(skillPath, "SKILL.md"),
      "---\nname: my-skill\ndescription: Test\n---\n",
    );
    await writeFile(join(root, "outside"), "secret");
    await symlink(join(root, "outside"), join(skillPath, "escape"));
    const agent: DetectedAgent = {
      id: "codex",
      displayName: "Codex",
      installed: true,
      skillsDirectory,
    };
    await expect(planSkillAdoption("my-skill", agent)).rejects.toThrow(
      "Refusing symlink",
    );
  });

  it.skipIf(process.platform === "win32")(
    "rejects special filesystem entries",
    async () => {
      root = await mkdtemp(join(tmpdir(), "loadout-adopt-special-"));
      process.env.LOADOUT_HOME = join(root, ".loadout");
      const skillsDirectory = join(root, "skills");
      const skillPath = join(skillsDirectory, "my-skill");
      await mkdir(skillPath, { recursive: true });
      await writeFile(
        join(skillPath, "SKILL.md"),
        "---\nname: my-skill\ndescription: Test\n---\n",
      );
      execFileSync("mkfifo", [join(skillPath, "pipe")]);
      const agent: DetectedAgent = {
        id: "codex",
        displayName: "Codex",
        installed: true,
        skillsDirectory,
      };
      await expect(planSkillAdoption("my-skill", agent)).rejects.toThrow(
        "Refusing special file",
      );
    },
  );

  it("rejects copied plans and repeat adoption", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-adopt-repeat-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const skillsDirectory = join(root, "skills");
    const skillPath = join(skillsDirectory, "my-skill");
    await mkdir(skillPath, { recursive: true });
    await writeFile(
      join(skillPath, "SKILL.md"),
      "---\nname: my-skill\ndescription: Test\n---\n",
    );
    const agent: DetectedAgent = {
      id: "codex",
      displayName: "Codex",
      installed: true,
      skillsDirectory,
    };
    const preview = await planSkillAdoption("my-skill", agent);
    const unsafe = {
      ...preview,
      treeEvidence: [
        { path: "../outside", type: "file" as const, sha256: "0" },
      ],
    };
    await expect(applySkillAdoption(unsafe)).rejects.toThrow("not issued");
    const plan = await planSkillAdoption("my-skill", agent);
    await applySkillAdoption(plan);
    await expect(planSkillAdoption("my-skill", agent)).rejects.toThrow(
      "already managed",
    );
  });

  it("rejects a structured-cloned plan with coordinated provenance forgery", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-adopt-clone-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const skillsDirectory = join(root, "skills");
    const skillPath = join(skillsDirectory, "my-skill");
    await mkdir(skillPath, { recursive: true });
    await writeFile(
      join(skillPath, "SKILL.md"),
      "---\nname: my-skill\ndescription: Test\n---\n",
    );
    const agent: DetectedAgent = {
      id: "codex",
      displayName: "Codex",
      installed: true,
      skillsDirectory,
    };
    const preview = await planSkillAdoption("my-skill", agent);
    const forged = structuredClone(preview);
    forged.reviewed = true;
    forged.repository = "https://evil.example/repository.git";
    forged.resolvedCommit = "f".repeat(40);
    forged.provenance.kind = "catalog-exact";
    forged.provenance.confidence = "exact";
    await expect(applySkillAdoption(forged)).rejects.toThrow("not issued");
    expect((await readInstallState()).installs).toEqual([]);
  });

  it("does not mark catalog-matching SKILL.md as reviewed when auxiliary bytes exist", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-adopt-review-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const skillsDirectory = join(root, "skills");
    const skillPath = join(skillsDirectory, "my-skill");
    const content = "---\nname: my-skill\ndescription: Test\n---\n";
    await mkdir(skillPath, { recursive: true });
    await writeFile(join(skillPath, "SKILL.md"), content);
    await writeFile(join(skillPath, "unreviewed.js"), "unknown()");
    const agent: DetectedAgent = {
      id: "codex",
      displayName: "Codex",
      installed: true,
      skillsDirectory,
    };
    const plan = await planSkillAdoption(
      "my-skill",
      agent,
      exactIndex(createHash("sha256").update(content).digest("hex")),
    );
    expect(plan.provenance.kind).toBe("catalog-exact");
    expect(plan.reviewed).toBe(false);
    expect(plan.installPlan.warnings.join(" ")).toContain("auxiliary");
    await applySkillAdoption(plan);
    expect((await readInstallState()).activations?.[0].reviewState).toBe(
      "unreviewed",
    );
  });

  it("marks a catalog-exact SKILL.md-only tree as reviewed", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-adopt-exact-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const skillsDirectory = join(root, "skills");
    const skillPath = join(skillsDirectory, "my-skill");
    const content = "---\nname: my-skill\ndescription: Test\n---\n";
    await mkdir(skillPath, { recursive: true });
    await writeFile(join(skillPath, "SKILL.md"), content);
    const agent: DetectedAgent = {
      id: "codex",
      displayName: "Codex",
      installed: true,
      skillsDirectory,
    };
    const plan = await planSkillAdoption(
      "my-skill",
      agent,
      exactIndex(createHash("sha256").update(content).digest("hex")),
    );
    expect(plan.reviewed).toBe(true);
    expect(plan.installPlan.warnings).toEqual([]);
  });

  it.each(["packageId", "target", "source", "agent", "component"])(
    "prevents mutation of nested install plan %s",
    async (field) => {
      root = await mkdtemp(join(tmpdir(), "loadout-adopt-plan-"));
      process.env.LOADOUT_HOME = join(root, ".loadout");
      const skillsDirectory = join(root, "skills");
      const skillPath = join(skillsDirectory, "my-skill");
      await mkdir(skillPath, { recursive: true });
      await writeFile(
        join(skillPath, "SKILL.md"),
        "---\nname: my-skill\ndescription: Test\n---\n",
      );
      const agent: DetectedAgent = {
        id: "codex",
        displayName: "Codex",
        installed: true,
        skillsDirectory,
      };
      const plan = await planSkillAdoption("my-skill", agent);
      const changed =
        field === "packageId"
          ? Reflect.set(plan.installPlan, "packageId", "tampered")
          : field === "target"
            ? Reflect.set(
                plan.installPlan.files[0],
                "target",
                join(root, "victim"),
              )
            : field === "source"
              ? Reflect.set(
                  plan.installPlan.files[0],
                  "source",
                  join(root, "victim"),
                )
              : field === "agent"
                ? Reflect.set(plan.installPlan, "targetAgents", ["claude-code"])
                : Reflect.set(
                    plan.installPlan.files[0],
                    "componentType",
                    "mcp",
                  );
      expect(changed).toBe(false);
      await applySkillAdoption(plan);
      expect((await readInstallState()).installs[0].packageId).toBe(
        plan.packageId,
      );
    },
  );

  it("deep-freezes coordinated review, provenance, repository, path, and evidence mutation", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-adopt-frozen-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const skillsDirectory = join(root, "skills");
    const skillPath = join(skillsDirectory, "my-skill");
    const content = "---\nname: my-skill\ndescription: Test\n---\n";
    await mkdir(skillPath, { recursive: true });
    await writeFile(join(skillPath, "SKILL.md"), content);
    const agent: DetectedAgent = {
      id: "codex",
      displayName: "Codex",
      installed: true,
      skillsDirectory,
    };
    const plan = await planSkillAdoption(
      "my-skill",
      agent,
      exactIndex(createHash("sha256").update(content).digest("hex")),
    );
    expect(Reflect.set(plan, "reviewed", false)).toBe(false);
    expect(Reflect.set(plan.provenance, "kind", "unknown")).toBe(false);
    expect(Reflect.set(plan, "repository", "https://evil.example/repo")).toBe(
      false,
    );
    expect(Reflect.set(plan, "path", join(root, "victim"))).toBe(false);
    expect(Reflect.set(plan.treeEvidence![0], "sha256", "0".repeat(64))).toBe(
      false,
    );
    expect(Object.isFrozen(plan.provenance.candidates)).toBe(true);
    expect(Object.isFrozen(plan.installPlan.files[0])).toBe(true);
    await applySkillAdoption(plan);
    expect((await readInstallState()).activations?.[0].reviewState).toBe(
      "reviewed",
    );
  });

  it("rejects a mutation between preflight validation and ownership recording", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-adopt-race-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const skillsDirectory = join(root, "skills");
    const skillPath = join(skillsDirectory, "my-skill");
    await mkdir(skillPath, { recursive: true });
    await writeFile(
      join(skillPath, "SKILL.md"),
      "---\nname: my-skill\ndescription: Test\n---\n",
    );
    const agent: DetectedAgent = {
      id: "codex",
      displayName: "Codex",
      installed: true,
      skillsDirectory,
    };
    const plan = await planSkillAdoption("my-skill", agent);
    await expect(
      applySkillAdoption(plan, {
        beforeRecord: () => writeFile(join(skillPath, "late.txt"), "late"),
      }),
    ).rejects.toThrow("changed after preview");
    expect((await readInstallState()).installs).toEqual([]);
  });
});
