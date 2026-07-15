import { describe, expect, it } from "vitest";
import { buildHealthReport, formatHealthReport } from "../src/core/health.js";

describe("local health checks", () => {
  it("stays network-free by default and labels update state honestly", async () => {
    const report = await buildHealthReport();
    expect(report.updatesChecked).toBe(false);
    expect(formatHealthReport(report)).toContain(
      "updates not checked (use --updates)",
    );
  });

  it("records an explicitly requested update check", async () => {
    const report = await buildHealthReport({ updates: async () => [] });
    expect(report.updatesChecked).toBe(true);
    expect(formatHealthReport(report)).toContain("0 update(s)");
  });
});
