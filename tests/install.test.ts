import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySkillInstall, buildSkillPlan } from "../src/core/install.js";
import { planSkillInstall } from "../src/core/skills.js";
import { restoreSnapshot } from "../src/core/snapshot.js";
import type { DetectedAgent } from "../src/shared/types.js";

const agent = (skillsDirectory: string): DetectedAgent => ({
  id: "codex",
  displayName: "Codex",
  binary: "codex",
  installed: true,
  skillsDirectory
});

describe("skill installation transaction", () => {
  const directories: string[] = [];
  const originalLoadoutHome = process.env.LOADOUT_HOME;
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
    if (originalLoadoutHome === undefined) delete process.env.LOADOUT_HOME;
    else process.env.LOADOUT_HOME = originalLoadoutHome;
  });

  it("plans, installs, and restores a real SKILL.md directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-test-"));
    directories.push(root);
    const source = join(root, "source");
    const home = join(root, "home");
    const target = join(home, ".agents", "skills");
    process.env.LOADOUT_HOME = join(root, ".loadout");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "SKILL.md"), "---\nname: test-skill\ndescription: A test skill\n---\n\nUse it.\n");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "unrelated.txt"), "keep me");

    const plan = await buildSkillPlan(source, "test-skill", [agent(target)]);
    expect(plan.files).toHaveLength(1);
    const snapshotId = await applySkillInstall(plan);
    expect(await readFile(join(target, "test-skill", "SKILL.md"), "utf8")).toContain("test-skill");
    expect(await readFile(join(target, "unrelated.txt"), "utf8")).toBe("keep me");

    const snapshot = JSON.parse(await readFile(join(process.env.LOADOUT_HOME, "snapshots", `${snapshotId}.json`), "utf8"));
    await restoreSnapshot(snapshot);
    await expect(readFile(join(target, "test-skill", "SKILL.md"))).rejects.toThrow();
    expect(await readFile(join(target, "unrelated.txt"), "utf8")).toBe("keep me");
  });

  it("discovers and validates nested skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-nested-"));
    directories.push(root);
    const source = join(root, "repository");
    const target = join(root, "target");
    await mkdir(join(source, "one"), { recursive: true });
    await mkdir(join(source, "two"), { recursive: true });
    await mkdir(target, { recursive: true });
    const frontmatter = (name: string) => `---\nname: ${name}\ndescription: A real skill\n---\n`;
    await writeFile(join(source, "one", "SKILL.md"), frontmatter("one"));
    await writeFile(join(source, "two", "SKILL.md"), frontmatter("two"));
    const plan = await planSkillInstall(source, [target], "nested-package");
    expect(plan.files.map((file) => file.target).sort()).toEqual([
      join(target, "one"),
      join(target, "two")
    ].sort());
  });

  it("restores all changes when a later copy fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-rollback-"));
    directories.push(root);
    const source = join(root, "source");
    const target = join(root, "target");
    process.env.LOADOUT_HOME = join(root, ".loadout");
    await mkdir(source, { recursive: true });
    await mkdir(target, { recursive: true });
    await writeFile(join(source, "SKILL.md"), "---\nname: first\ndescription: First\n---\n");
    const plan = await buildSkillPlan(source, "first", [agent(target)]);
    plan.files.push({ source: join(root, "does-not-exist"), target: join(target, "broken") });
    await expect(applySkillInstall(plan)).rejects.toThrow();
    await expect(readFile(join(target, "first", "SKILL.md"))).rejects.toThrow();
    await expect(readFile(join(target, "broken", "SKILL.md"))).rejects.toThrow();
  });

  it("rejects symlinked package content", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-symlink-"));
    directories.push(root);
    const source = join(root, "source");
    const outside = join(root, "outside");
    const target = join(root, "target");
    await mkdir(source, { recursive: true });
    await mkdir(outside, { recursive: true });
    await mkdir(target, { recursive: true });
    await writeFile(join(outside, "SKILL.md"), "---\nname: outside\ndescription: Outside\n---\n");
    await import("node:fs/promises").then(({ symlink }) => symlink(outside, join(source, "linked"), "dir"));
    await expect(planSkillInstall(source, [target], "unsafe")).rejects.toThrow(/symlink/);
  });
});
