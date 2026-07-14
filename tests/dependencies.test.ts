import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPackage, publishLocalPackage } from "../src/core/registry.js";
import { applySyncPlan, buildSyncPlan } from "../src/core/sync.js";

describe("registry package dependencies", () => {
  let root = "";
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); delete process.env.LOADOUT_HOME; delete process.env.LOADOUT_USER_HOME; });

  async function publish(name: string, version: string, options: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {}): Promise<void> {
    const directory = join(root, `${name}-${version}`);
    const descriptor = await createPackage(directory, { name, version, description: `${name} package` });
    await writeFile(join(directory, "loadout-package.json"), `${JSON.stringify({ ...descriptor, ...options }, null, 2)}\n`);
    await mkdir(join(directory, "skills", name), { recursive: true });
    await writeFile(join(directory, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} dependency\n---\n`);
    await publishLocalPackage(directory);
  }

  async function manifest(packages: unknown[]): Promise<string> {
    const home = join(root, "home"); await mkdir(join(home, ".agents"), { recursive: true });
    process.env.LOADOUT_USER_HOME = home; process.env.LOADOUT_HOME = join(root, ".loadout");
    const path = join(root, "loadout.json");
    await writeFile(path, JSON.stringify({ schemaVersion: 1, name: "dependencies", scope: "global", agents: ["codex"], packages }));
    return path;
  }

  it("installs and locks transitive production plus opted-in development dependencies", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-dependencies-")); process.env.LOADOUT_HOME = join(root, ".loadout");
    await publish("base", "1.0.0"); await publish("devtool", "1.0.0");
    await publish("middle", "1.0.0", { dependencies: { base: "1.0.0" } });
    await publish("app", "1.0.0", { dependencies: { middle: "1.0.0" }, devDependencies: { devtool: "1.0.0" } });
    const path = await manifest([{ id: "app", source: { type: "registry", name: "app", version: "1.0.0" }, includeDevDependencies: true }]);
    const plan = await buildSyncPlan(path);
    expect(plan.packages.map((entry) => entry.plan.packageId)).toEqual(["devtool", "base", "middle", "app"]);
    const lockPath = join(root, "loadout.lock"); await applySyncPlan(plan, lockPath);
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    expect(lock.packages.map((pkg: { id: string }) => pkg.id).sort()).toEqual(["app", "base", "devtool", "middle"]);
    expect(lock.packages.find((pkg: { id: string }) => pkg.id === "app").dependencies.sort()).toEqual(["devtool", "middle"]);
    expect(lock.packages.find((pkg: { id: string }) => pkg.id === "middle").dependencies).toEqual(["base"]);
  });

  it("does not install development dependencies unless requested", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-dev-dependencies-")); process.env.LOADOUT_HOME = join(root, ".loadout");
    await publish("devtool", "1.0.0"); await publish("app", "1.0.0", { devDependencies: { devtool: "1.0.0" } });
    const plan = await buildSyncPlan(await manifest([{ id: "app", source: { type: "registry", name: "app", version: "1.0.0" } }]));
    expect(plan.packages.map((entry) => entry.plan.packageId)).toEqual(["app"]);
  });

  it("rejects dependency cycles and incompatible transitive versions", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-dependency-errors-")); process.env.LOADOUT_HOME = join(root, ".loadout");
    await publish("a", "1.0.0", { dependencies: { b: "1.0.0" } }); await publish("b", "1.0.0", { dependencies: { a: "1.0.0" } });
    await expect(buildSyncPlan(await manifest([{ id: "a", source: { type: "registry", name: "a", version: "1.0.0" } }]))).rejects.toThrow(/dependency cycle/);
    await publish("shared", "1.0.0"); await publish("shared", "2.0.0");
    await publish("left", "1.0.0", { dependencies: { shared: "1.0.0" } }); await publish("right", "1.0.0", { dependencies: { shared: "2.0.0" } });
    await publish("conflict", "1.0.0", { dependencies: { left: "1.0.0", right: "1.0.0" } });
    await expect(buildSyncPlan(await manifest([{ id: "conflict", source: { type: "registry", name: "conflict", version: "1.0.0" } }]))).rejects.toThrow(/version conflict/);
  });
});
