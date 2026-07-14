import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySyncPlan, buildSyncPlan } from "../src/core/sync.js";
import { readInstallState } from "../src/core/state.js";

describe("manifest synchronization", () => {
  let root = "";
  const originalPath = process.env.PATH;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    process.env.PATH = originalPath; delete process.env.LOADOUT_HOME; delete process.env.LOADOUT_USER_HOME;
  });

  it("plans and applies mixed components as one locked transaction", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-sync-"));
    const bin = join(root, "bin"); const source = join(root, "package"); const home = join(root, "home");
    await mkdir(bin); await mkdir(join(source, "skills", "demo"), { recursive: true }); await mkdir(join(source, "commands"));
    for (const name of ["codex", "claude"]) { const path = join(bin, name); await writeFile(path, "#!/bin/sh\nexit 0\n"); await chmod(path, 0o755); }
    await writeFile(join(source, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Demo skill\n---\n");
    await writeFile(join(source, "commands", "review.md"), "Review carefully.\n");
    const manifestPath = join(root, "loadout.json"); const lockPath = join(root, "loadout.lock");
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, name: "test", scope: "global", agents: ["codex", "claude-code"], packages: [{ id: "demo", source: { type: "local", path: source } }] }));
    process.env.PATH = `${bin}:${originalPath ?? ""}`; process.env.LOADOUT_HOME = join(root, ".loadout"); process.env.LOADOUT_USER_HOME = home;
    const plan = await buildSyncPlan(manifestPath);
    expect(plan.packages[0].plan.files.map((file) => file.componentType)).toEqual(expect.arrayContaining(["skill", "command"]));
    const result = await applySyncPlan(plan, lockPath);
    expect(result.snapshotId).toBeTruthy();
    expect((await readInstallState()).installs[0].targetAgents).toEqual(expect.arrayContaining(["codex", "claude-code"]));
    expect(JSON.parse(await readFile(lockPath, "utf8")).packages[0].id).toBe("demo");
    expect(await readFile(join(home, ".codex", "prompts", "demo", "review.md"), "utf8")).toContain("Review");
    expect(await readFile(join(home, ".claude", "commands", "demo", "review.md"), "utf8")).toContain("Review");
  });
});
