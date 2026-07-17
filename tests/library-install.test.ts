import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
});
