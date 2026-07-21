import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSnapshot,
  recordSnapshotPostMutationState,
} from "../src/core/snapshot.js";

const run = promisify(execFile);
const cli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const entry = join(process.cwd(), "src", "cli.ts");

describe("rollback CLI history", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    delete process.env.LOADOUT_HOME;
  });

  it("explains adjacent snapshots and lets a user select the older mutation", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-cli-rollback-"));
    const loadoutHome = join(root, "state");
    process.env.LOADOUT_HOME = loadoutHome;
    const target = join(root, "skill.txt");
    await writeFile(target, "before");
    const install = await createSnapshot([target], {
      label: "install stable profile",
    });
    await writeFile(target, "after");
    await recordSnapshotPostMutationState(install);

    const noOp = await createSnapshot([target], {
      label: "refresh managed state",
    });
    await recordSnapshotPostMutationState(noOp);

    const env = { ...process.env, LOADOUT_HOME: loadoutHome, NO_COLOR: "1" };
    const history = await run(
      process.execPath,
      [cli, entry, "rollback", "--list"],
      { env },
    );
    expect(history.stdout).toContain("install stable profile");
    expect(history.stdout).toContain("refresh managed state");
    expect(history.stdout).toContain("0 changed filesystem entries");
    expect(history.stdout).toContain("latest");

    const latest = await run(process.execPath, [cli, entry, "rollback"], {
      env,
    });
    expect(latest.stdout).toContain("recorded no effective filesystem change");

    await run(
      process.execPath,
      [cli, entry, "rollback", "--snapshot", install.id],
      { env },
    );
    expect(await readFile(target, "utf8")).toBe("before");
  });
});
