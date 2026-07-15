import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyActivationChange,
  buildLibraryStateReport,
  planActivationChange,
} from "../src/core/active-set.js";
import { applySkillInstall, buildSkillPlan } from "../src/core/install.js";
import { buildHealthReport } from "../src/core/health.js";
import { readSnapshot, restoreSnapshot } from "../src/core/snapshot.js";
import { readInstallState, writeInstallState } from "../src/core/state.js";
import type { DetectedAgent } from "../src/shared/types.js";

describe("reviewed library and active-set transactions", () => {
  let root = "";
  const originalLoadoutHome = process.env.LOADOUT_HOME;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    if (originalLoadoutHome === undefined) delete process.env.LOADOUT_HOME;
    else process.env.LOADOUT_HOME = originalLoadoutHome;
  });

  async function installSkill(
    packageId: string,
    target: string,
  ): Promise<string> {
    const source = join(root, "sources", packageId);
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, "SKILL.md"),
      `---\nname: ${packageId}\ndescription: Managed ${packageId}\n---\n\nExact instructions.\n`,
    );
    const agent: DetectedAgent = {
      id: "codex",
      displayName: "Codex",
      installed: true,
      skillsDirectory: target,
    };
    const plan = await buildSkillPlan(source, packageId, [agent]);
    return applySkillInstall(plan, {
      repository: `example/${packageId}`,
      resolvedCommit: "a".repeat(40),
      reviewed: true,
    });
  }

  it("disables to the library, enables byte-identically, and rolls back", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-active-set-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const target = join(root, "home", ".agents", "skills");
    await installSkill("review", target);

    const initial = await buildLibraryStateReport();
    expect(initial.records[0]).toMatchObject({
      packageId: "review",
      agent: "codex",
      cacheState: "missing",
      reviewState: "reviewed",
      installationState: "installed",
      activationState: "active",
    });

    const disable = await planActivationChange("disable", ["review"]);
    expect(disable).toMatchObject({ blocked: false });
    const disableSnapshot = await applyActivationChange(disable);
    const disabled = (await readInstallState()).activations![0];
    expect(disabled).toMatchObject({
      cacheState: "downloaded",
      activationState: "disabled",
      snapshotId: disableSnapshot,
    });
    await expect(
      readFile(join(target, "review", "SKILL.md")),
    ).rejects.toThrow();
    expect(
      await readFile(join(disabled.libraryPath, "review", "SKILL.md"), "utf8"),
    ).toContain("Exact instructions.");
    expect(
      (await buildHealthReport({ updates: async () => [] })).driftedFiles,
    ).toBe(0);

    const enable = await planActivationChange("enable", ["review"]);
    expect(enable.blocked).toBe(false);
    const enableSnapshot = await applyActivationChange(enable);
    expect(
      await readFile(join(target, "review", "SKILL.md"), "utf8"),
    ).toContain("Exact instructions.");
    expect((await readInstallState()).activations![0].activationState).toBe(
      "active",
    );

    await restoreSnapshot(await readSnapshot(enableSnapshot));
    await expect(
      readFile(join(target, "review", "SKILL.md")),
    ).rejects.toThrow();
    expect((await readInstallState()).activations![0].activationState).toBe(
      "disabled",
    );

    await restoreSnapshot(await readSnapshot(disableSnapshot));
    expect(
      await readFile(join(target, "review", "SKILL.md"), "utf8"),
    ).toContain("Exact instructions.");
    expect((await readInstallState()).activations![0]).toMatchObject({
      cacheState: "missing",
      activationState: "active",
    });
  });

  it("blocks disabling drifted or untracked content", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-active-drift-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const target = join(root, "home", ".agents", "skills");
    await installSkill("review", target);
    await writeFile(join(target, "review", "notes.txt"), "user content");
    const plan = await planActivationChange("disable", ["review"]);
    expect(plan.blocked).toBe(true);
    expect(plan.warnings.join(" ")).toMatch(/untracked file/);
    await expect(applyActivationChange(plan)).rejects.toThrow(/untracked file/);
    expect(await readFile(join(target, "review", "notes.txt"), "utf8")).toBe(
      "user content",
    );
  });

  it("changes several packages in one snapshot-backed batch", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-active-batch-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const target = join(root, "home", ".agents", "skills");
    await installSkill("first", target);
    await installSkill("second", target);
    const plan = await planActivationChange("disable", ["first", "second"]);
    expect(plan.changes).toHaveLength(2);
    const snapshotId = await applyActivationChange(plan);
    const activations = (await readInstallState()).activations!;
    expect(activations).toHaveLength(2);
    expect(activations.every((entry) => entry.snapshotId === snapshotId)).toBe(
      true,
    );
    expect(
      activations.every((entry) => entry.activationState === "disabled"),
    ).toBe(true);
  });

  it("blocks activation when persisted managed paths were tampered with", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-active-tamper-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const target = join(root, "home", ".agents", "skills");
    await installSkill("review", target);
    await applyActivationChange(
      await planActivationChange("disable", ["review"]),
    );
    const state = await readInstallState();
    state.activations![0].libraryPath = join(root, "outside-managed-library");
    await writeInstallState(state);
    const plan = await planActivationChange("enable", ["review"]);
    expect(plan.blocked).toBe(true);
    expect(plan.warnings.join(" ")).toMatch(/library path does not match/);
  });
});
