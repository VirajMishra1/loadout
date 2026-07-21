import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { applyRemove, planRemove } from "../src/core/remove.js";
import { recordInstall, readInstallState } from "../src/core/state.js";

describe("safe package removal", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
    delete process.env.LOADOUT_HOME;
  });

  it("removes only managed unchanged files and records a snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-remove-"));
    roots.push(root);
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const target = join(root, "skill");
    await mkdir(target);
    await writeFile(join(target, "SKILL.md"), "managed");
    await writeFile(join(target, "user.txt"), "unrelated");
    await recordInstall(
      {
        packageId: "demo",
        targetAgents: ["codex"],
        warnings: [],
        files: [{ source: root, target }],
      },
      "before",
    );
    const plan = await planRemove("demo");
    expect(plan.blocked).toBe(false);
    const snapshot = await applyRemove(plan);
    expect(snapshot).toBeTruthy();
    await expect(readFile(join(target, "SKILL.md"))).rejects.toThrow();
    await expect(readFile(join(target, "user.txt"))).rejects.toThrow();
    expect((await readInstallState()).installs).toEqual([]);
  });

  it("blocks removal when a managed file drifted", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-remove-drift-"));
    roots.push(root);
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const target = join(root, "skill");
    await mkdir(target);
    await writeFile(join(target, "SKILL.md"), "before");
    await recordInstall(
      {
        packageId: "demo",
        targetAgents: ["codex"],
        warnings: [],
        files: [{ source: root, target }],
      },
      "before",
    );
    await writeFile(join(target, "SKILL.md"), "changed");
    const plan = await planRemove("demo");
    expect(plan.blocked).toBe(true);
    await expect(applyRemove(plan)).rejects.toThrow(/modified/);
  });

  it("forgets adopted ownership without deleting pre-existing files", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-remove-adopted-"));
    roots.push(root);
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const target = join(root, "agent", "existing-skill");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "SKILL.md"), "pre-existing");
    await recordInstall(
      {
        packageId: "adopted-existing-skill",
        targetAgents: ["codex"],
        warnings: [],
        files: [{ source: target, target }],
      },
      "before",
      { ownershipOrigin: "adopted" },
    );
    await writeFile(join(target, "SKILL.md"), "user edit after adoption");

    const plan = await planRemove("adopted-existing-skill");
    expect(plan).toMatchObject({ preserveFiles: true, blocked: false });
    expect(plan.files).toEqual([
      { path: join(target, "SKILL.md"), status: "modified" },
    ]);
    expect(plan.warnings.join(" ")).toContain("preserve those files");
    await applyRemove(plan);

    expect(await readFile(join(target, "SKILL.md"), "utf8")).toBe(
      "user edit after adoption",
    );
    expect((await readInstallState()).installs).toEqual([]);
    expect((await readInstallState()).activations).toEqual([]);
  });

  it("protects legacy adopted package ids without the explicit origin field", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "loadout-remove-legacy-adopted-"),
    );
    roots.push(root);
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const target = join(root, "agent", "existing-skill");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "SKILL.md"), "pre-existing");
    await recordInstall(
      {
        packageId: "adopted-review-existing-12345678",
        targetAgents: ["codex"],
        warnings: [],
        files: [{ source: target, target }],
      },
      "before",
    );

    const plan = await planRemove("adopted-review-existing-12345678");
    expect(plan.preserveFiles).toBe(true);
    await applyRemove(plan);
    expect(await readFile(join(target, "SKILL.md"), "utf8")).toBe(
      "pre-existing",
    );
  });

  it("removes a disabled library copy without touching an unmanaged replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-remove-disabled-"));
    roots.push(root);
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const target = join(root, "agent", "humanizer");
    const library = join(process.env.LOADOUT_HOME, "library", "demo", "codex");
    const libraryTarget = join(library, "humanizer");
    await mkdir(target, { recursive: true });
    await mkdir(libraryTarget, { recursive: true });
    await writeFile(join(target, "SKILL.md"), "managed");
    await writeFile(join(libraryTarget, "SKILL.md"), "managed");
    await recordInstall(
      {
        packageId: "demo",
        targetAgents: ["codex"],
        warnings: [],
        files: [{ source: root, target }],
      },
      "before",
    );
    const state = await readInstallState();
    await writeFile(
      join(process.env.LOADOUT_HOME, "state.json"),
      JSON.stringify({
        ...state,
        activations: [
          {
            packageId: "demo",
            unitId: "humanizer",
            agent: "codex",
            cacheState: "downloaded",
            reviewState: "reviewed",
            installationState: "installed",
            activationState: "disabled",
            libraryPath: library,
            targets: [{ activePath: target, libraryRelativePath: "humanizer" }],
            libraryFiles: [],
            updatedAt: "2026-07-21T00:00:00.000Z",
          },
        ],
      }),
    );
    await writeFile(join(target, "SKILL.md"), "unmanaged replacement");

    const plan = await planRemove("demo");
    expect(plan.blocked).toBe(false);
    expect(plan.files).toEqual([
      { path: join(libraryTarget, "SKILL.md"), status: "unchanged" },
    ]);
    await applyRemove(plan);

    expect(await readFile(join(target, "SKILL.md"), "utf8")).toBe(
      "unmanaged replacement",
    );
    await expect(readFile(join(libraryTarget, "SKILL.md"))).rejects.toThrow();
  });

  it("removes only the owned MCP entry and preserves unrelated configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-remove-mcp-"));
    roots.push(root);
    process.env.LOADOUT_HOME = join(root, ".loadout");
    await mkdir(process.env.LOADOUT_HOME);
    const configPath = join(root, "mcp.json");
    const docs = { command: "npx", args: ["docs"] };
    await writeFile(
      configPath,
      JSON.stringify({
        theme: "dark",
        mcpServers: { existing: { command: "keep" }, docs },
      }),
    );
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(docs))
      .digest("hex");
    await writeFile(
      join(process.env.LOADOUT_HOME, "state.json"),
      JSON.stringify({
        version: 1,
        installs: [
          {
            packageId: "docs",
            targetAgents: ["codex"],
            files: [],
            snapshotId: "s",
            installedAt: "now",
          },
        ],
        mcpInstalls: [
          {
            packageId: "docs",
            configPath,
            serverName: "docs",
            fingerprint,
            snapshotId: "s",
            installedAt: "now",
          },
        ],
      }),
    );
    const plan = await planRemove("docs");
    expect(plan.mcpServers).toEqual([
      {
        configPath,
        serverName: "docs",
        configFormat: "json",
        status: "unchanged",
      },
    ]);
    await applyRemove(plan);
    const config = JSON.parse(await readFile(configPath, "utf8"));
    expect(config.theme).toBe("dark");
    expect(config.mcpServers.existing.command).toBe("keep");
    expect(config.mcpServers.docs).toBeUndefined();
    expect((await readInstallState()).mcpInstalls).toEqual([]);
  });
});
