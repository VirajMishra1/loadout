import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    const agent: DetectedAgent = {
      id: "codex",
      displayName: "Codex",
      installed: true,
      skillsDirectory,
    };

    const plan = await planSkillAdoption("my-skill", agent);
    expect(plan.reviewed).toBe(false);
    const snapshot = await applySkillAdoption(plan);
    expect(snapshot).toBeTruthy();
    expect(await readFile(join(skillPath, "SKILL.md"), "utf8")).toBe(content);
    const state = await readInstallState();
    expect(state.installs[0].packageId).toBe("adopted-codex-my-skill");
    expect(state.activations?.[0]).toMatchObject({
      unitId: "my-skill",
      activationState: "active",
      reviewState: "unreviewed",
    });
  });
});
