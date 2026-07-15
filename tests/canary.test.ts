import { describe, expect, it } from "vitest";
import { runCanary } from "../src/core/canary.js";
import type { PackageEvaluation } from "../src/core/evaluate.js";

const ready: PackageEvaluation = {
  evaluatorVersion: 1,
  root: "/tmp/candidate",
  categories: [
    { category: "skills", status: "ready", findings: [] },
    { category: "mcp", status: "ready", findings: [] },
  ],
  uncertainty: "static",
};

describe("policy-gated canary pipeline", () => {
  it("stops before promotion until explicit approval", async () => {
    let promoted = false;
    const result = await runCanary(
      { packageId: "demo", root: "/tmp/candidate" },
      { enabled: true },
      {},
      {
        evaluate: async () => ready,
        verify: async () => ({ ok: true }),
        promote: async () => {
          promoted = true;
          return { snapshotId: "snap" };
        },
      },
    );
    expect(result.status).toBe("verified");
    expect(promoted).toBe(false);
  });

  it("promotes only after verification and approval", async () => {
    const result = await runCanary(
      { packageId: "demo", root: "/tmp/candidate", commit: "abc" },
      { enabled: true },
      { approve: true },
      {
        evaluate: async () => ready,
        verify: async () => ({ ok: true, findings: ["isolated"] }),
        promote: async () => ({ snapshotId: "snap" }),
      },
    );
    expect(result.status).toBe("promoted");
    expect(result.snapshotId).toBe("snap");
  });

  it("blocks unsafe static evidence", async () => {
    const result = await runCanary(
      { packageId: "unsafe", root: "/tmp/candidate" },
      { enabled: true },
      { approve: true },
      {
        evaluate: async () => ({
          ...ready,
          categories: [{ ...ready.categories[0], status: "blocked" }],
        }),
        promote: async () => ({ snapshotId: "must-not-run" }),
      },
    );
    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("Static evaluation");
  });

  it("ignores component categories that do not apply to the candidate", async () => {
    const result = await runCanary(
      { packageId: "skill-only", root: "/tmp/candidate" },
      { enabled: true },
      {},
      {
        evaluate: async () => ({
          ...ready,
          categories: [
            ready.categories[0],
            { category: "mcp", status: "not-applicable", findings: [] },
          ],
        }),
      },
    );
    expect(result.status).toBe("verified");
  });

  it("blocks candidates with no supported component evidence", async () => {
    const result = await runCanary(
      { packageId: "empty", root: "/tmp/candidate" },
      { enabled: true },
      {},
      {
        evaluate: async () => ({
          ...ready,
          categories: ready.categories.map((category) => ({
            ...category,
            status: "not-applicable" as const,
          })),
        }),
      },
    );
    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("no supported component");
  });
});
