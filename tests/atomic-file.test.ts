import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomically } from "../src/core/atomic-file.js";
import { writeLockfile } from "../src/core/manifest.js";

describe("atomic persisted metadata", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    delete process.env.LOADOUT_HOME;
  });

  it("replaces an existing file without leaving a temporary sibling", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-atomic-"));
    const path = join(root, "state.json");
    await writeFile(path, '{"version":0}\n');
    await writeFileAtomically(path, '{"version":1}\n');
    expect(await readFile(path, "utf8")).toBe('{"version":1}\n');
    expect((await readdir(root)).filter((name) => name.includes(".loadout-") && name.endsWith(".tmp"))).toEqual([]);
  });

  it("writes lockfiles through the replacement path", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-lock-"));
    process.env.LOADOUT_HOME = join(root, "state");
    const lock = join(root, "loadout.lock");
    await writeFile(lock, "not-json\n");
    await writeLockfile({ schemaVersion: 1, name: "atomic", scope: "project", agents: ["codex"], packages: [] }, lock);
    expect(JSON.parse(await readFile(lock, "utf8"))).toMatchObject({ schemaVersion: 1, manifestName: "atomic" });
    expect((await readdir(root)).filter((name) => name.includes(".loadout-") && name.endsWith(".tmp"))).toEqual([]);
  });
});
