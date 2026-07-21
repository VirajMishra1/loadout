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
import {
  applySkillInstallBatch,
  applySkillLibraryBatch,
  type InstallBatchEntry,
} from "../src/core/install.js";
import { activationLibraryPath, readInstallState } from "../src/core/state.js";

describe("Maximum Library over an existing Stable install", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    delete process.env.LOADOUT_HOME;
  });

  it("keeps matching Stable units active and caches additional Maximum units", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-library-overlay-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const source = join(root, "source");
    const stableSource = join(source, "stable-skill");
    const extraSource = join(source, "extra-skill");
    const targetRoot = join(root, "home", ".codex", "skills");
    await mkdir(stableSource, { recursive: true });
    await mkdir(extraSource, { recursive: true });
    await writeFile(
      join(stableSource, "SKILL.md"),
      "---\nname: stable-skill\ndescription: Stable unit\n---\n",
    );
    await writeFile(
      join(extraSource, "SKILL.md"),
      "---\nname: extra-skill\ndescription: Extra unit\n---\n",
    );
    const stableTarget = join(targetRoot, "stable-skill");
    const extraTarget = join(targetRoot, "extra-skill");
    const metadata = {
      repository: "example/collection",
      resolvedCommit: "a".repeat(40),
      reviewed: true,
    };
    const stableEntry: InstallBatchEntry = {
      plan: {
        packageId: "collection",
        targetAgents: ["codex"],
        warnings: [],
        files: [
          {
            source: stableSource,
            target: stableTarget,
            targetAgent: "codex",
            componentType: "skill",
          },
        ],
      },
      metadata,
    };
    await applySkillInstallBatch([stableEntry]);

    const maximumEntry: InstallBatchEntry = {
      plan: {
        ...stableEntry.plan,
        files: [
          ...stableEntry.plan.files,
          {
            source: extraSource,
            target: extraTarget,
            targetAgent: "codex",
            componentType: "skill",
          },
        ],
      },
      metadata,
    };
    await applySkillLibraryBatch([maximumEntry]);

    expect(await readFile(join(stableTarget, "SKILL.md"), "utf8")).toContain(
      "Stable unit",
    );
    await expect(
      readFile(join(extraTarget, "SKILL.md"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const state = await readInstallState();
    expect(state.activations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packageId: "collection",
          unitId: "stable-skill",
          cacheState: "downloaded",
          activationState: "active",
        }),
        expect.objectContaining({
          packageId: "collection",
          unitId: "extra-skill",
          cacheState: "downloaded",
          activationState: "disabled",
        }),
      ]),
    );
    expect(
      await readFile(
        join(
          activationLibraryPath("collection", "codex", "extra-skill"),
          "extra-skill",
          "SKILL.md",
        ),
        "utf8",
      ),
    ).toContain("Extra unit");
  });

  it("fails closed without partial state when an active unit is genuinely missing", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-library-missing-active-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const source = join(root, "source", "active-skill");
    const target = join(root, "home", ".agents", "skills", "active-skill");
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: active-skill\ndescription: Active unit\n---\n",
    );
    const metadata = {
      repository: "example/collection",
      resolvedCommit: "a".repeat(40),
      reviewed: true,
    };
    await applySkillInstallBatch([
      {
        plan: {
          packageId: "collection",
          targetAgents: ["codex"],
          warnings: [],
          files: [
            {
              source,
              target,
              targetAgent: "codex",
              componentType: "skill",
            },
          ],
        },
        metadata,
      },
    ]);
    const before = await readInstallState();
    const missingSource = join(root, "source", "different-skill");
    await mkdir(missingSource, { recursive: true });
    await writeFile(
      join(missingSource, "SKILL.md"),
      "---\nname: different-skill\ndescription: Different unit\n---\n",
    );

    await expect(
      applySkillLibraryBatch([
        {
          plan: {
            packageId: "collection",
            targetAgents: ["codex"],
            warnings: [],
            files: [
              {
                source: missingSource,
                target: join(
                  root,
                  "home",
                  ".agents",
                  "skills",
                  "different-skill",
                ),
                targetAgent: "codex",
                componentType: "skill",
              },
            ],
          },
          metadata,
        },
      ]),
    ).rejects.toThrow(/active-skill.*absent from the prepared library/);
    expect(await readInstallState()).toEqual(before);
    await expect(
      access(activationLibraryPath("collection", "codex")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed without partial state when the reviewed commit changes", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-library-commit-mismatch-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const source = join(root, "source", "active-skill");
    const target = join(root, "home", ".agents", "skills", "active-skill");
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: active-skill\ndescription: Active unit\n---\n",
    );
    const plan = {
      packageId: "collection",
      targetAgents: ["codex" as const],
      warnings: [],
      files: [
        {
          source,
          target,
          targetAgent: "codex" as const,
          componentType: "skill" as const,
        },
      ],
    };
    await applySkillInstallBatch([
      {
        plan,
        metadata: {
          repository: "example/collection",
          resolvedCommit: "a".repeat(40),
          reviewed: true,
        },
      },
    ]);
    const before = await readInstallState();

    await expect(
      applySkillLibraryBatch([
        {
          plan,
          metadata: {
            repository: "example/collection",
            resolvedCommit: "b".repeat(40),
            reviewed: true,
          },
        },
      ]),
    ).rejects.toThrow(/reviewed revision differs or is unknown/);
    expect(await readInstallState()).toEqual(before);
    await expect(
      access(activationLibraryPath("collection", "codex")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed when the same active unit moves to a different target root", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-library-target-mismatch-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const source = join(root, "source", "active-skill");
    const activeTarget = join(
      root,
      "old-home",
      ".agents",
      "skills",
      "active-skill",
    );
    const movedTarget = join(
      root,
      "new-home",
      ".agents",
      "skills",
      "active-skill",
    );
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: active-skill\ndescription: Active unit\n---\n",
    );
    const metadata = {
      repository: "example/collection",
      resolvedCommit: "a".repeat(40),
      reviewed: true,
    };
    await applySkillInstallBatch([
      {
        plan: {
          packageId: "collection",
          targetAgents: ["codex"],
          warnings: [],
          files: [
            {
              source,
              target: activeTarget,
              targetAgent: "codex",
              componentType: "skill",
            },
          ],
        },
        metadata,
      },
    ]);
    const before = await readInstallState();

    await expect(
      applySkillLibraryBatch([
        {
          plan: {
            packageId: "collection",
            targetAgents: ["codex"],
            warnings: [],
            files: [
              {
                source,
                target: movedTarget,
                targetAgent: "codex",
                componentType: "skill",
              },
            ],
          },
          metadata,
        },
      ]),
    ).rejects.toThrow(/active-skill.*absent from the prepared library/);
    expect(await readInstallState()).toEqual(before);
    await expect(
      access(activationLibraryPath("collection", "codex")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
