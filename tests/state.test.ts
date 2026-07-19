import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  readFile,
  rm,
  mkdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hashDirectory,
  recordInstall,
  readInstallState,
} from "../src/core/state.js";
import type { InstallPlan } from "../src/shared/types.js";

describe("install state", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    delete process.env.LOADOUT_HOME;
  });
  it("records commit, agents, snapshot and real file hashes", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-state-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const target = join(root, "skills", "demo");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "SKILL.md"), "real content");
    const plan: InstallPlan = {
      packageId: "demo",
      targetAgents: ["codex"],
      warnings: [],
      files: [{ source: "source", target }],
    };
    await recordInstall(plan, "snap-1", {
      repository: "owner/repo",
      resolvedCommit: "abc123",
    });
    const state = await readInstallState();
    expect(state.installs[0]).toMatchObject({
      packageId: "demo",
      repository: "owner/repo",
      resolvedCommit: "abc123",
      snapshotId: "snap-1",
      targetAgents: ["codex"],
    });
    expect(state.installs[0].files[0].sha256).toBe(
      "359b365773dbfb3e21cc1196062f477ad27f83bc04aa9dcd4178d924127a5f17",
    );
    expect(state.activations?.[0]).toMatchObject({
      packageId: "demo",
      agent: "codex",
      cacheState: "missing",
      reviewState: "unreviewed",
      installationState: "installed",
      activationState: "active",
      targets: [{ activePath: target, libraryRelativePath: "demo" }],
    });
    expect(
      JSON.parse(
        await readFile(join(process.env.LOADOUT_HOME, "state.json"), "utf8"),
      ).version,
    ).toBe(1);
  });

  it("rejects symlinks instead of treating traversal failures as an empty tree", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-state-symlink-"));
    const target = join(root, "skills", "demo");
    const outside = join(root, "outside.md");
    await mkdir(target, { recursive: true });
    await writeFile(outside, "outside content");
    await symlink(outside, join(target, "linked.md"));

    await expect(hashDirectory(target)).rejects.toThrow(
      /Refusing symlink while hashing installed files/,
    );
  });

  it("does not expose the mutable install record to the final verifier", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-state-verifier-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const target = join(root, "skills", "demo");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "SKILL.md"), "real content");
    const plan: InstallPlan = {
      packageId: "demo",
      targetAgents: ["codex"],
      warnings: [],
      files: [{ source: "source", target }],
    };
    let verifierArguments: unknown[] = [];
    await recordInstall(
      plan,
      "snap",
      {},
      {
        verifyBeforeWrite: async (...args: unknown[]) => {
          verifierArguments = args;
        },
      },
    );
    expect(verifierArguments).toEqual([]);
    expect((await readInstallState()).installs[0].packageId).toBe("demo");
  });
});
