import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPortableImport, exportPortableLoadout, parsePortableLoadout, planPortableImport } from "../src/core/portable.js";
import { readSnapshot, restoreSnapshot } from "../src/core/snapshot.js";

describe("portable Loadout import and export", () => {
  let root = "";
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); delete process.env.LOADOUT_HOME; });

  it("exports, previews, imports, and restores a manifest plus exact lockfile", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-portable-")); process.env.LOADOUT_HOME = join(root, ".state");
    const manifest = { schemaVersion: 1, name: "team", scope: "project", agents: ["codex"], packages: [{ id: "demo", source: { type: "registry", name: "demo", version: "1.0.0" } }] };
    const lock = { schemaVersion: 1, manifestName: "team", generatedAt: "2026-01-01T00:00:00.000Z", packages: [] };
    const manifestSource = join(root, "source.json"); const lockSource = join(root, "source.lock"); const portable = join(root, "team.loadout.json");
    await writeFile(manifestSource, JSON.stringify(manifest)); await writeFile(lockSource, JSON.stringify(lock));
    await exportPortableLoadout(manifestSource, portable, lockSource);
    const manifestTarget = join(root, "project", "loadout.json"); const lockTarget = join(root, "project", "loadout.lock");
    const preview = await planPortableImport(portable, manifestTarget, lockTarget);
    expect(preview.plan).toMatchObject({ packageCount: 1, includesLockfile: true, manifestPath: manifestTarget, lockPath: lockTarget });
    const result = await applyPortableImport(portable, manifestTarget, lockTarget);
    expect(JSON.parse(await readFile(manifestTarget, "utf8"))).toMatchObject({ name: "team" });
    expect(JSON.parse(await readFile(lockTarget, "utf8"))).toMatchObject({ manifestName: "team" });
    await restoreSnapshot(await readSnapshot(result.snapshotId));
    await expect(readFile(manifestTarget)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(lockTarget)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses silent overwrite, secret material, and absolute local paths", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-portable-safety-")); process.env.LOADOUT_HOME = join(root, ".state");
    const portable = join(root, "team.loadout.json"); const manifestTarget = join(root, "loadout.json");
    const manifest = { schemaVersion: 1, name: "team", scope: "project", agents: ["codex"], packages: [] };
    await writeFile(join(root, "source.json"), JSON.stringify(manifest)); await exportPortableLoadout(join(root, "source.json"), portable);
    await writeFile(manifestTarget, "existing\n");
    await expect(applyPortableImport(portable, manifestTarget)).rejects.toThrow(/Refusing to overwrite/);
    await expect(applyPortableImport(portable, manifestTarget, join(root, "lock"), { overwrite: true })).resolves.toBeTruthy();
    expect(() => parsePortableLoadout({ schemaVersion: 1, kind: "loadout-portable", exportedAt: "now", manifest: { ...manifest, policy: { token: "abcdefghijklmnopqrstuvwxyz123456" } } })).toThrow(/secret material/);
    await writeFile(join(root, "absolute.json"), JSON.stringify({ ...manifest, packages: [{ id: "local", source: { type: "local", path: "/private/package" } }] }));
    await expect(exportPortableLoadout(join(root, "absolute.json"), join(root, "absolute.bundle"))).rejects.toThrow(/cannot be exported portably/);
  });

  it("rejects a lockfile belonging to a different manifest", () => {
    expect(() => parsePortableLoadout({ schemaVersion: 1, kind: "loadout-portable", exportedAt: "now", manifest: { schemaVersion: 1, name: "one", scope: "project", agents: [], packages: [] }, lockfile: { schemaVersion: 1, manifestName: "two", packages: [] } })).toThrow(/does not belong/);
  });
});
