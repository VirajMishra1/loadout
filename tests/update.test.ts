import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildUpdatePlan, formatUpdatePlan } from "../src/core/update.js";

describe("update planning", () => {
  const roots: string[] = [];
  const original = process.env.LOADOUT_HOME;
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
    if (original === undefined) delete process.env.LOADOUT_HOME;
    else process.env.LOADOUT_HOME = original;
  });

  it("compares recorded commits without mutating installs", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-update-")); roots.push(root);
    process.env.LOADOUT_HOME = join(root, ".loadout");
    await mkdir(process.env.LOADOUT_HOME, { recursive: true });
    await writeFile(join(process.env.LOADOUT_HOME, "state.json"), JSON.stringify({ version: 1, installs: [
      { packageId: "demo", repository: "owner/repo", resolvedCommit: "aaa", targetAgents: ["codex"], files: [], snapshotId: "s", installedAt: new Date().toISOString() }
    ] }));
    const plans = await buildUpdatePlan(async () => ({ commit: "bbb" }));
    expect(plans[0].status).toBe("update-available");
    expect(plans[0].availableCommit).toBe("bbb");
    expect(formatUpdatePlan(plans)).toContain("UPDATE-AVAILABLE demo");
  });

  it("marks local and network-failed installs clearly", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-update-")); roots.push(root);
    process.env.LOADOUT_HOME = join(root, ".loadout");
    await mkdir(process.env.LOADOUT_HOME, { recursive: true });
    await writeFile(join(process.env.LOADOUT_HOME, "state.json"), JSON.stringify({ version: 1, installs: [
      { packageId: "local", targetAgents: ["codex"], files: [], snapshotId: "s", installedAt: new Date().toISOString() },
      { packageId: "remote", repository: "owner/repo", resolvedCommit: "aaa", targetAgents: ["codex"], files: [], snapshotId: "s", installedAt: new Date().toISOString() }
    ] }));
    const plans = await buildUpdatePlan(async () => { throw new Error("offline"); });
    expect(plans.map((p) => p.status)).toEqual(["untracked", "error"]);
    expect(formatUpdatePlan(plans)).toContain("offline");
  });

  it("rejects malformed persisted state", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-update-")); roots.push(root);
    process.env.LOADOUT_HOME = join(root, ".loadout");
    await mkdir(process.env.LOADOUT_HOME, { recursive: true });
    await writeFile(join(process.env.LOADOUT_HOME, "state.json"), "not json");
    await expect(buildUpdatePlan(async () => ({ commit: "x" }))).rejects.toThrow(/state is invalid/);
  });
});
