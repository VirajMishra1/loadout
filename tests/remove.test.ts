import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRemove, planRemove } from "../src/core/remove.js";
import { recordInstall, readInstallState } from "../src/core/state.js";

describe("safe package removal", () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); delete process.env.LOADOUT_HOME; });

  it("removes only managed unchanged files and records a snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-remove-")); roots.push(root); process.env.LOADOUT_HOME = join(root, ".loadout");
    const target = join(root, "skill"); await mkdir(target); await writeFile(join(target, "SKILL.md"), "managed"); await writeFile(join(target, "user.txt"), "unrelated");
    await recordInstall({ packageId: "demo", targetAgents: ["codex"], warnings: [], files: [{ source: root, target }] }, "before");
    const plan = await planRemove("demo");
    expect(plan.blocked).toBe(false);
    const snapshot = await applyRemove(plan);
    expect(snapshot).toBeTruthy();
    await expect(readFile(join(target, "SKILL.md"))).rejects.toThrow();
    await expect(readFile(join(target, "user.txt"))).rejects.toThrow();
    expect((await readInstallState()).installs).toEqual([]);
  });

  it("blocks removal when a managed file drifted", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-remove-drift-")); roots.push(root); process.env.LOADOUT_HOME = join(root, ".loadout");
    const target = join(root, "skill"); await mkdir(target); await writeFile(join(target, "SKILL.md"), "before");
    await recordInstall({ packageId: "demo", targetAgents: ["codex"], warnings: [], files: [{ source: root, target }] }, "before");
    await writeFile(join(target, "SKILL.md"), "changed");
    const plan = await planRemove("demo");
    expect(plan.blocked).toBe(true);
    await expect(applyRemove(plan)).rejects.toThrow(/modified/);
  });
});
