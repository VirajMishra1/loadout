import { afterEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSnapshot,
  readSnapshot,
  restoreSnapshot,
} from "../src/core/snapshot.js";

describe("rollback snapshots", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    delete process.env.LOADOUT_HOME;
  });

  it("restores binary bytes and existing empty directories exactly", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-snapshot-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const target = join(root, "target");
    const empty = join(target, "empty");
    const binary = join(target, "asset.bin");
    await mkdir(empty, { recursive: true });
    const original = Buffer.from([0, 255, 1, 128, 10]);
    await writeFile(binary, original);
    const snapshot = await createSnapshot([target]);
    expect(
      (await readSnapshot(snapshot.id)).files.some(
        (file) => file.encoding === "base64",
      ),
    ).toBe(true);
    await rm(empty, { recursive: true });
    await writeFile(binary, Buffer.from([9, 9]));
    await writeFile(join(target, "new.txt"), "new");
    await restoreSnapshot(snapshot);
    expect(await readFile(binary)).toEqual(original);
    expect(await readdir(empty)).toEqual([]);
    await expect(readFile(join(target, "new.txt"))).rejects.toThrow();
  });
});
