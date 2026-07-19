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

  it("rejects tampered path evidence and repeat adoption", async () => {
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
    const unsafe = await planSkillAdoption("my-skill", agent);
    unsafe.treeEvidence = [{ path: "../outside", type: "file", sha256: "0" }];
    await expect(applySkillAdoption(unsafe)).rejects.toThrow(
      "unsafe tree evidence",
    );
    const plan = await planSkillAdoption("my-skill", agent);
    await applySkillAdoption(plan);
    await expect(planSkillAdoption("my-skill", agent)).rejects.toThrow(
      "already managed",
    );
  });
});
