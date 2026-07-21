import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildHealthReport, formatHealthReport } from "../src/core/health.js";

describe("local health checks", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
    delete process.env.LOADOUT_HOME;
  });
  it("stays network-free by default and labels update state honestly", async () => {
    const report = await buildHealthReport();
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
    const report = await buildHealthReport({ updates: async () => [] });
    expect(report.updatesChecked).toBe(true);
    expect(formatHealthReport(report)).toContain("0 update(s)");
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

    const report = await buildHealthReport({ updates: async () => [] });
    expect(report).toMatchObject({
      status: "library-only",
      activeSkills: 0,
      disabledSkills: 1,
    });
    expect(formatHealthReport(report)).toContain(
      "Loadout health: library ready (nothing active)",
    );
    expect(formatHealthReport(report)).toContain(
      "skills: 0 active, 1 disabled",
    );
  });
});
