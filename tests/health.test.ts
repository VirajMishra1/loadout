import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHealthReport,
  formatHealthReport,
  gradeHealth,
} from "../src/core/reporting/health.js";
import type { DetectedAgent, HealthReport } from "../src/shared/types.js";

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

describe("gradeHealth", () => {
  const base = {
    generatedAt: "2026-01-01T00:00:00Z",
    agents: [],
    installedPackages: 4,
    activeSkills: 12,
    updatesChecked: false,
    updatesAvailable: 0,
    driftedFiles: 0,
    driftedMcpServers: 0,
    findings: [] as HealthReport["findings"],
  };
  it("returns an em-dash when nothing is configured", () => {
    const g = gradeHealth({
      ...base,
      status: "not-configured",
      installedPackages: 0,
    });
    expect(g.letter).toBe("—");
    expect(g.fixes[0]).toMatch(/setup/);
  });
  it("grades a clean managed profile A", () => {
    expect(gradeHealth({ ...base, status: "healthy" }).letter).toBe("A");
  });
  it("grades warnings B with their fixes surfaced", () => {
    const g = gradeHealth({
      ...base,
      status: "attention",
      findings: [
        {
          level: "warning",
          code: "updates-available",
          message: "2 updates",
          fix: "run loadout update",
        },
      ],
    });
    expect(g.letter).toBe("B");
    expect(g.fixes).toContain("run loadout update");
  });
  it("grades library-only C", () => {
    expect(
      gradeHealth({ ...base, status: "library-only", activeSkills: 0 }).letter,
    ).toBe("C");
  });
  it("grades error findings D", () => {
    const g = gradeHealth({
      ...base,
      status: "unhealthy",
      findings: [{ level: "error", code: "x", message: "broken" }],
    });
    expect(g.letter).toBe("D");
  });
  it("grades any drift F regardless of other findings", () => {
    const g = gradeHealth({ ...base, status: "unhealthy", driftedFiles: 1 });
    expect(g.letter).toBe("F");
    expect(g.fixes.some((f) => /rollback/.test(f))).toBe(true);
  });
});
