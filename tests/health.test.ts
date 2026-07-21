import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildHealthReport, formatHealthReport } from "../src/core/health.js";
import type { DetectedAgent } from "../src/shared/types.js";

const ORIGINAL_LOADOUT_HOME = process.env.LOADOUT_HOME;
const ORIGINAL_USER_HOME = process.env.LOADOUT_USER_HOME;
const TEST_AGENTS: DetectedAgent[] = [
  {
    id: "codex",
    displayName: "Codex",
    installed: true,
    skillsDirectory: join(ORIGINAL_USER_HOME ?? "", ".agents", "skills"),
  },
];
const agents = async () => TEST_AGENTS;

describe("local health checks", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
    if (ORIGINAL_LOADOUT_HOME === undefined) delete process.env.LOADOUT_HOME;
    else process.env.LOADOUT_HOME = ORIGINAL_LOADOUT_HOME;
    if (ORIGINAL_USER_HOME === undefined) delete process.env.LOADOUT_USER_HOME;
    else process.env.LOADOUT_USER_HOME = ORIGINAL_USER_HOME;
  });
  it("stays network-free by default and labels update state honestly", async () => {
    const report = await buildHealthReport({ agents });
    expect(report.updatesChecked).toBe(false);
    expect(report.status).toBe("not-configured");
    expect(formatHealthReport(report)).toContain(
      "Loadout health: not configured",
    );
    expect(formatHealthReport(report)).toContain(
      "updates not checked (use --updates)",
    );
  });

  it("records an explicitly requested update check", async () => {
    const report = await buildHealthReport({ updates: async () => [], agents });
    expect(report.updatesChecked).toBe(true);
    expect(formatHealthReport(report)).toContain("0 active update(s)");
    expect(formatHealthReport(report)).toContain(
      "0 disabled-library update(s)",
    );
  });

  it("describes a disabled Maximum library without claiming skills are active", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-health-library-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    await mkdir(process.env.LOADOUT_HOME, { recursive: true });
    await writeFile(
      join(process.env.LOADOUT_HOME, "state.json"),
      JSON.stringify({
        version: 1,
        installs: [
          {
            packageId: "demo",
            targetAgents: ["codex"],
            files: [],
            snapshotId: "snapshot",
            installedAt: "2026-07-21T00:00:00.000Z",
          },
        ],
        mcpInstalls: [],
        activations: [
          {
            packageId: "demo",
            unitId: "review",
            agent: "codex",
            cacheState: "downloaded",
            reviewState: "reviewed",
            installationState: "installed",
            activationState: "disabled",
            libraryPath: join(process.env.LOADOUT_HOME, "library", "demo"),
            targets: [],
            libraryFiles: [],
            updatedAt: "2026-07-21T00:00:00.000Z",
          },
        ],
      }),
    );

    const report = await buildHealthReport({
      updates: async () => [
        {
          packageId: "demo",
          status: "update-available",
          targetAgents: ["codex"],
          disabledAgents: ["codex"],
          disabledUnits: 1,
          action: "held",
        },
      ],
      agents,
    });
    expect(report).toMatchObject({
      status: "library-only",
      activeSkills: 0,
      disabledSkills: 1,
      updatesAvailable: 1,
      activeUpdatesAvailable: 0,
      disabledUpdatesAvailable: 1,
    });
    expect(formatHealthReport(report)).toContain(
      "Loadout health: library ready (nothing active)",
    );
    expect(formatHealthReport(report)).toContain(
      "skills: 0 active, 1 disabled",
    );
    expect(formatHealthReport(report)).toContain(
      "0 active update(s), 1 disabled-library update(s)",
    );
  });

  it("reports installed runtime tools and their agent skill targets", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-health-runtime-"));
    const stateHome = join(root, "state");
    const home = join(root, "home");
    process.env.LOADOUT_HOME = stateHome;
    process.env.LOADOUT_USER_HOME = home;
    for (const target of [
      join(home, ".claude", "skills", "graphify"),
      join(home, ".codex", "skills", "graphify"),
    ]) {
      await mkdir(target, { recursive: true });
      await writeFile(join(target, "SKILL.md"), "# Graphify\n");
    }
    await mkdir(stateHome, { recursive: true });
    await writeFile(
      join(stateHome, "runtime-tools.json"),
      JSON.stringify({
        schemaVersion: 1,
        tools: {
          graphify: {
            version: "0.9.17",
            installedAt: "2026-07-21T00:00:00.000Z",
            snapshotId: "snapshot",
            agents: ["claude-code", "codex"],
            runtimeRoot: join(stateHome, "runtime", "graphify"),
          },
        },
      }),
    );

    const report = await buildHealthReport({ updates: async () => [], agents });
    expect(report).toMatchObject({
      status: "healthy",
      activeSkills: 2,
      managedMcpServers: 0,
      managedRuntimeTools: 1,
    });
    expect(formatHealthReport(report)).toContain("skills: 2 active");
    expect(formatHealthReport(report)).toContain("runtime tools: 1");
  });
});
