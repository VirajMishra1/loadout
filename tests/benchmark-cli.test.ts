import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { BENCHMARK_PROTOCOL_VERSION } from "../src/core/benchmark-campaign.js";

const exec = promisify(execFile);
const sha = (character: string) => character.repeat(64);
const commit = (character: string) => character.repeat(40);

describe("benchmark planning CLI", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("writes resumable metadata without executing a provider request", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-benchmark-cli-"));
    const campaignPath = join(root, "campaign.json");
    const runPath = join(root, "run.json");
    await writeFile(
      campaignPath,
      JSON.stringify({
        schemaVersion: 1,
        protocolVersion: BENCHMARK_PROTOCOL_VERSION,
        campaignId: "cli-plan-v1",
        createdAt: "2026-07-16T12:00:00.000Z",
        category: "workflow-adherence",
        fixture: {
          id: "synthetic-workflow",
          version: "1.0.0",
          fixtureSha256: sha("a"),
          rubricSha256: sha("b"),
        },
        candidates: [
          {
            role: "baseline",
            id: "baseline",
            packageId: "baseline-package",
            skillPath: "skills/baseline/SKILL.md",
            reviewedCommit: commit("c"),
            instructionSha256: sha("d"),
          },
          {
            role: "candidate",
            id: "candidate",
            packageId: "candidate-package",
            skillPath: "skills/candidate/SKILL.md",
            reviewedCommit: commit("e"),
            instructionSha256: sha("f"),
          },
        ],
        model: {
          provider: "provider-neutral",
          model: "evaluation-model",
          version: "2026-07-16",
        },
        sampling: {
          temperature: 0,
          topP: 1,
          maxInputTokensPerRequest: 1000,
          maxOutputTokensPerRequest: 500,
        },
        trials: {
          pairs: 5,
          maxRetriesPerRequest: 1,
          timeoutMsPerRequest: 30000,
        },
        randomization: {
          strategy: "paired-balanced-sha256-v1",
          seed: sha("1"),
          concealCandidateLabels: true,
        },
        isolation: {
          toolPolicy: "none",
          networkPolicy: "disabled",
          candidatePolicy: "instructions-as-data",
          fixturePolicy: "synthetic-only",
        },
        budget: {
          maxRequests: 20,
          maxInputTokens: 20000,
          maxOutputTokens: 10000,
          maxCostUsd: 0.1,
          inputUsdPerMillionTokens: 2,
          outputUsdPerMillionTokens: 6,
        },
        decision: {
          minimumSuccessfulPairs: 5,
          minimumPracticalScoreDelta: 1,
          promotionPolicy: "signed-evidence-plus-human-approval",
        },
      }),
    );
    const result = await exec(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "benchmark",
        "plan",
        campaignPath,
        "--run-id",
        "cli-run-v1",
        "--output",
        runPath,
        "--json",
      ],
      { cwd: process.cwd(), env: { ...process.env, NO_COLOR: "1" } },
    );
    const output = JSON.parse(result.stdout) as {
      executed: boolean;
      summary: { withinBudget: boolean };
      safetyBoundary: string;
    };
    expect(output.executed).toBe(false);
    expect(output.summary.withinBudget).toBe(true);
    expect(output.safetyBoundary).toMatch(/no model call/);
    expect(JSON.parse(await readFile(runPath, "utf8"))).toMatchObject({
      runId: "cli-run-v1",
      status: "planned",
      completed: [],
    });

    await rm(runPath);
    const overBudget = JSON.parse(await readFile(campaignPath, "utf8")) as {
      budget: { maxCostUsd: number };
    };
    overBudget.budget.maxCostUsd = 0;
    await writeFile(campaignPath, JSON.stringify(overBudget));
    await expect(
      exec(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "benchmark",
          "plan",
          campaignPath,
          "--run-id",
          "blocked-run",
          "--output",
          runPath,
        ],
        { cwd: process.cwd(), env: { ...process.env, NO_COLOR: "1" } },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("declared ceilings are exceeded"),
    });
    await expect(access(runPath)).rejects.toThrow();
  });
});
