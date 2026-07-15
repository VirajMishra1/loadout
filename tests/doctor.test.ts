import { describe, expect, it, afterEach } from "vitest";
import { formatDoctorReport, runDoctor } from "../src/core/doctor.js";

describe("doctor", () => {
  const originalHome = process.env.LOADOUT_USER_HOME;
  const originalLoadoutHome = process.env.LOADOUT_HOME;
  afterEach(() => {
    if (originalHome === undefined) delete process.env.LOADOUT_USER_HOME;
    else process.env.LOADOUT_USER_HOME = originalHome;
    if (originalLoadoutHome === undefined) delete process.env.LOADOUT_HOME;
    else process.env.LOADOUT_HOME = originalLoadoutHome;
  });

  it("reports real paths and machine-readable health", async () => {
    process.env.LOADOUT_USER_HOME = "/tmp/loadout-doctor-home";
    process.env.LOADOUT_HOME = "/tmp/loadout-doctor-state";
    const report = await runDoctor();
    expect(report.platform).toBe(process.platform);
    expect(report.userHome).toBe("/tmp/loadout-doctor-home");
    expect(report.agents).toHaveLength(6);
    expect(report.agents[0].inventory.components).toHaveLength(7);
    expect(
      report.agents[0].inventory.components.find(
        (component) => component.type === "mcp",
      ),
    ).toMatchObject({ scanned: false });
    expect(formatDoctorReport(report)).toContain("Loadout doctor");
    expect(formatDoctorReport(report)).toContain("Unsupported by this adapter");
  });
});
