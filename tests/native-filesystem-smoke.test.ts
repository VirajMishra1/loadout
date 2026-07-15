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
import { ADAPTER_CAPABILITIES } from "../src/core/adapters.js";
import {
  applyActivationChange,
  planActivationChange,
} from "../src/core/active-set.js";
import { applySkillInstall, buildSkillPlan } from "../src/core/install.js";
import { agentSkillsDirectory } from "../src/core/paths.js";
import { applyRemove, planRemove } from "../src/core/remove.js";
import { readInstallState } from "../src/core/state.js";
import type { DetectedAgent } from "../src/shared/types.js";

const originalLoadoutHome = process.env.LOADOUT_HOME;
const originalUserHome = process.env.LOADOUT_USER_HOME;

describe("native filesystem skill install smoke test", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    if (originalLoadoutHome === undefined) delete process.env.LOADOUT_HOME;
    else process.env.LOADOUT_HOME = originalLoadoutHome;
    if (originalUserHome === undefined) delete process.env.LOADOUT_USER_HOME;
    else process.env.LOADOUT_USER_HOME = originalUserHome;
  });

  it(`plans, installs, and removes skills using ${process.platform} filesystem paths`, async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-native-filesystem-"));
    const home = join(root, "agent-home");
    const source = join(root, "source");
    const packageId = "native-filesystem-smoke";
    process.env.LOADOUT_USER_HOME = home;
    process.env.LOADOUT_HOME = join(root, "loadout-state");
    await mkdir(source, { recursive: true });

    const skill = Buffer.from(
      "---\nname: native-filesystem-smoke\ndescription: A real native filesystem smoke test\n---\n\nUse the tested adapter layout.\n",
      "utf8",
    );
    await writeFile(join(source, "SKILL.md"), skill);

    // Do not pass a simulated platform or a hand-written target. These paths
    // are computed by the host OS's path implementation and are exercised by
    // the Windows, macOS, and Linux CI matrix.
    const agents: DetectedAgent[] = ADAPTER_CAPABILITIES.map((adapter) => ({
      id: adapter.agent,
      displayName: adapter.displayName,
      installed: true,
      skillsDirectory: agentSkillsDirectory(adapter.agent),
    }));
    const plan = await buildSkillPlan(source, packageId, agents);
    expect(plan.targetAgents).toEqual(agents.map((agent) => agent.id));
    expect(plan.files).toHaveLength(agents.length);
    for (const agent of agents) {
      const target = join(agent.skillsDirectory, packageId);
      expect(plan.files).toContainEqual(
        expect.objectContaining({
          source,
          target,
          componentType: "skill",
          compatibility: "native",
        }),
      );
    }

    await applySkillInstall(plan);
    for (const agent of agents)
      expect(
        await readFile(join(agent.skillsDirectory, packageId, "SKILL.md")),
      ).toEqual(skill);
    expect(await readFile(join(source, "SKILL.md"))).toEqual(skill);
    expect((await readInstallState()).installs).toHaveLength(1);

    const disable = await planActivationChange("disable", [packageId]);
    expect(disable.blocked).toBe(false);
    expect(disable.changes).toHaveLength(agents.length);
    await applyActivationChange(disable);
    for (const agent of agents)
      await expect(
        access(join(agent.skillsDirectory, packageId, "SKILL.md")),
      ).rejects.toThrow();
    expect(
      (await readInstallState()).activations?.every(
        (activation) => activation.activationState === "disabled",
      ),
    ).toBe(true);

    const enable = await planActivationChange("enable", [packageId]);
    expect(enable.blocked).toBe(false);
    await applyActivationChange(enable);
    for (const agent of agents)
      expect(
        await readFile(join(agent.skillsDirectory, packageId, "SKILL.md")),
      ).toEqual(skill);

    const removal = await planRemove(packageId);
    expect(removal.blocked).toBe(false);
    expect(removal.files).toHaveLength(agents.length);
    await applyRemove(removal);
    for (const agent of agents)
      await expect(
        access(join(agent.skillsDirectory, packageId, "SKILL.md")),
      ).rejects.toThrow();
    expect((await readInstallState()).installs).toEqual([]);
  });
});
