import { afterEach, describe, expect, it } from "vitest";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildUninstallPlan,
  applyUninstall,
  formatUninstallPlan,
} from "../src/core/uninstall.js";
import { recordInstall } from "../src/core/state.js";

describe("complete Loadout uninstall", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    delete process.env.LOADOUT_HOME;
  });

  it("previews managed packages, disabled library records, schedules, and state deletion", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-uninstall-plan-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    await mkdir(process.env.LOADOUT_HOME, { recursive: true });
    await writeFile(
      join(process.env.LOADOUT_HOME, "state.json"),
      JSON.stringify({
        version: 1,
        installs: [],
        mcpInstalls: [],
        activations: [
          {
            packageId: "library-only",
            unitId: "review",
            agent: "codex",
            cacheState: "downloaded",
            reviewState: "reviewed",
            installationState: "removed",
            activationState: "disabled",
            libraryPath: join(process.env.LOADOUT_HOME, "library", "review"),
            targets: [],
            libraryFiles: [],
            updatedAt: "2026-07-18T00:00:00Z",
          },
        ],
      }),
    );

    const plan = await buildUninstallPlan({
      runtimeTools: async () => ["graphify"],
      schedulerPlans: () => [
        { action: "unschedule", job: "updates" },
        { action: "unschedule", job: "discovery" },
      ],
    });

    expect(plan).toMatchObject({
      stateHome: process.env.LOADOUT_HOME,
      runtimeTools: ["graphify"],
      disabledLibraryRecords: 1,
      blocked: false,
    });
    expect(plan.schedulers).toHaveLength(2);
    expect(formatUninstallPlan(plan)).toContain("loadout uninstall --yes");
  });

  it("removes managed files and Loadout state while preserving unrelated files", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-uninstall-apply-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const source = join(root, "source");
    const target = join(root, "agent", "managed-skill");
    const unrelated = join(root, "agent", "my-own-skill.txt");
    await mkdir(source, { recursive: true });
    await mkdir(target, { recursive: true });
    await mkdir(join(target, "empty", "nested"), { recursive: true });
    await writeFile(join(source, "SKILL.md"), "managed");
    await writeFile(join(target, "SKILL.md"), "managed");
    await writeFile(unrelated, "keep me");
    await recordInstall(
      {
        packageId: "demo",
        targetAgents: ["codex"],
        warnings: [],
        files: [{ source, target }],
      },
      "before",
    );
    await mkdir(join(process.env.LOADOUT_HOME, "library"), { recursive: true });
    await writeFile(
      join(process.env.LOADOUT_HOME, "library", "cached"),
      "copy",
    );

    const plan = await buildUninstallPlan({
      runtimeTools: async () => [],
      schedulerPlans: () => [],
    });
    const result = await applyUninstall(plan, {
      runtimeTools: async () => [],
      schedulerPlans: () => [],
      unschedule: async () => undefined,
    });

    expect(result.removedPackages).toBe(1);
    await expect(access(target)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(unrelated, "utf8")).toBe("keep me");
    await expect(access(process.env.LOADOUT_HOME)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("blocks complete removal when a managed file was modified", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-uninstall-blocked-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const source = join(root, "source");
    const target = join(root, "agent", "managed-skill");
    await mkdir(source, { recursive: true });
    await mkdir(target, { recursive: true });
    await writeFile(join(source, "SKILL.md"), "before");
    await writeFile(join(target, "SKILL.md"), "before");
    await recordInstall(
      {
        packageId: "demo",
        targetAgents: ["codex"],
        warnings: [],
        files: [{ source, target }],
      },
      "before",
    );
    await writeFile(join(target, "SKILL.md"), "my edit");

    const plan = await buildUninstallPlan({
      runtimeTools: async () => [],
      schedulerPlans: () => [],
    });
    expect(plan.blocked).toBe(true);
    await expect(
      applyUninstall(plan, {
        runtimeTools: async () => [],
        schedulerPlans: () => [],
        unschedule: async () => undefined,
      }),
    ).rejects.toThrow(/modified/);
  });

  it("removes a tracked MCP-only recipe while preserving unrelated config", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-uninstall-mcp-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const config = join(root, "mcp.json");
    const server = { command: "npx", args: ["demo@1.0.0"] };
    await writeFile(
      config,
      JSON.stringify({ untouched: true, mcpServers: { demo: server } }),
    );
    const { createHash } = await import("node:crypto");
    await mkdir(process.env.LOADOUT_HOME, { recursive: true });
    await writeFile(
      join(process.env.LOADOUT_HOME, "state.json"),
      JSON.stringify({
        version: 1,
        installs: [],
        mcpInstalls: [
          {
            packageId: "mcp-recipe:demo",
            configPath: config,
            serverName: "demo",
            fingerprint: createHash("sha256")
              .update(JSON.stringify(server))
              .digest("hex"),
            snapshotId: "snapshot",
            installedAt: "2026-07-18T00:00:00Z",
          },
        ],
        activations: [],
      }),
    );
    const plan = await buildUninstallPlan({
      runtimeTools: async () => [],
      schedulerPlans: () => [],
    });
    expect(plan.packages.map((item) => item.packageId)).toEqual([
      "mcp-recipe:demo",
    ]);
    await applyUninstall(plan, {
      runtimeTools: async () => [],
      schedulerPlans: () => [],
      unschedule: async () => undefined,
    });
    expect(JSON.parse(await readFile(config, "utf8"))).toEqual({
      untouched: true,
      mcpServers: {},
    });
  });
});
