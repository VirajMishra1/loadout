import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addManifestPackage, applyProfileToManifest, initManifest, orderManifestPackages, parseManifest, readManifest, removeManifestPackage, writeLockfile } from "../src/core/manifest.js";

describe("manifest and lockfile", () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); delete process.env.LOADOUT_HOME; });

  it("creates and validates a shareable manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-manifest-")); roots.push(root);
    const path = join(root, "loadout.json");
    await initManifest(path, { name: "team", agents: ["codex"] });
    expect(await readManifest(path)).toMatchObject({ schemaVersion: 1, name: "team", agents: ["codex"], packages: [] });
    await expect(initManifest(path)).rejects.toThrow();
  });

  it("rejects duplicate packages and unsupported agents", () => {
    expect(() => parseManifest({ schemaVersion: 1, name: "x", scope: "project", agents: ["unknown"], packages: [] })).toThrow(/unsupported agent/);
    expect(() => parseManifest({ schemaVersion: 1, name: "x", scope: "project", agents: ["codex"], packages: [{ id: "a", source: { type: "catalog", id: "a" } }, { id: "a", source: { type: "catalog", id: "a" } }] })).toThrow(/unique/);
  });

  it("writes a lockfile from managed state without secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-lock-")); roots.push(root);
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const manifest = parseManifest({ schemaVersion: 1, name: "team", scope: "project", agents: ["codex"], packages: [{ id: "demo", source: { type: "github", repository: "owner/repo" } }] });
    const output = join(root, "loadout.lock");
    const lock = await writeLockfile(manifest, output);
    expect(lock.packages).toEqual([]);
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({ schemaVersion: 1, manifestName: "team" });
  });

  it("adds, removes, and applies profiles without duplicating packages", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-manifest-edit-")); roots.push(root);
    const path = join(root, "loadout.json");
    await initManifest(path, { name: "team", agents: ["codex"] });
    await addManifestPackage(path, { id: "one", source: { type: "github", repository: "owner/one", ref: "v1.0.0" } });
    await expect(addManifestPackage(path, { id: "one", source: { type: "catalog", id: "one" } })).rejects.toThrow(/already contains/);
    await applyProfileToManifest(path, "stable", [{ id: "one", repository: "owner/one" }, { id: "two", repository: "owner/two" }]);
    expect((await readManifest(path)).packages.map((pkg) => pkg.id)).toEqual(["one", "two"]);
    await removeManifestPackage(path, "one");
    expect((await readManifest(path)).packages.map((pkg) => pkg.id)).toEqual(["two"]);
  });

  it("orders dependencies and rejects missing or cyclic dependency graphs", () => {
    const dependency = { id: "base", source: { type: "catalog" as const, id: "base" } };
    const app = { id: "app", source: { type: "git" as const, url: "https://example.com/app.git" }, dependsOn: ["base"] };
    expect(orderManifestPackages([app, dependency]).map((pkg) => pkg.id)).toEqual(["base", "app"]);
    expect(() => parseManifest({ schemaVersion: 1, name: "x", scope: "project", agents: ["codex"], packages: [{ ...app, dependsOn: ["missing"] }] })).toThrow(/missing package/);
    expect(() => parseManifest({ schemaVersion: 1, name: "x", scope: "project", agents: ["codex"], packages: [{ ...app, dependsOn: ["base"] }, { ...dependency, dependsOn: ["app"] }] })).toThrow(/cycle/);
  });

  it("validates explicit MCP targets without guessing agent config paths", () => {
    const manifest = parseManifest({ schemaVersion: 1, name: "mcp", scope: "project", agents: ["codex"], packages: [{ id: "docs", source: { type: "catalog", id: "context7" }, mcp: { config: ".config/mcp.json", servers: ["docs"] } }] });
    expect(manifest.packages[0].mcp).toEqual({ config: ".config/mcp.json", servers: ["docs"] });
    expect(() => parseManifest({ schemaVersion: 1, name: "mcp", scope: "project", agents: ["codex"], packages: [{ id: "docs", source: { type: "catalog", id: "context7" }, mcp: {} }] })).toThrow(/mcp.config/);
  });
});
