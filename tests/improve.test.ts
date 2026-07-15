import { afterEach, describe, expect, it } from "vitest";
import {
  buildImprovementCycle,
  improvementPrompt,
  proposeImprovements,
  recordImprovementOutcome,
  writeImprovementCycle,
} from "../src/core/improve.js";
import type { HealthReport } from "../src/shared/types.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("self-improving loop", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    delete process.env.LOADOUT_HOME;
  });
  it("prioritizes drift from health evidence and requires review", () => {
    const report: HealthReport = {
      status: "attention",
      generatedAt: "now",
      agents: [],
      installedPackages: 1,
      updatesChecked: true,
      updatesAvailable: 2,
      driftedFiles: 3,
      driftedMcpServers: 0,
      findings: [],
    };
    const proposals = proposeImprovements(report);
    expect(proposals[0]).toMatchObject({
      priority: 100,
      requiresHumanReview: true,
    });
    expect(proposals[0].evidence[0]).toContain("3 drifted");
  });

  it("persists a reusable prompt and human-reviewed outcome history", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-improve-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const report: HealthReport = {
      status: "healthy",
      generatedAt: "now",
      agents: [],
      installedPackages: 0,
      updatesChecked: true,
      updatesAvailable: 0,
      driftedFiles: 0,
      driftedMcpServers: 0,
      findings: [],
    };
    const cycle = await buildImprovementCycle(async () => report);
    const directory = join(root, "history");
    const paths = await writeImprovementCycle(cycle, directory);
    expect(await readFile(paths.prompt, "utf8")).toContain(
      "Never expose secrets",
    );
    expect(improvementPrompt(cycle)).toContain(cycle.id);
    const updated = await recordImprovementOutcome(
      cycle.id,
      "partial",
      "Needs another compatibility fixture.",
      directory,
    );
    expect(updated.feedback?.at(-1)).toMatchObject({
      outcome: "partial",
      note: "Needs another compatibility fixture.",
    });
    expect(
      JSON.parse(await readFile(paths.json, "utf8")).feedback,
    ).toHaveLength(1);
    await expect(
      recordImprovementOutcome(
        cycle.id,
        "failure",
        "token='ghp_abcdefghijklmnopqrstuvwxyz1234567890'",
        directory,
      ),
    ).rejects.toThrow(/secret material/);
  });
});
