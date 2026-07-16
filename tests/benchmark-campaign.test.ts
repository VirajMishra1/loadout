import { describe, expect, it } from "vitest";
import {
  BENCHMARK_PROTOCOL_VERSION,
  benchmarkCampaignSha256,
  benchmarkScheduleSha256,
  buildBenchmarkSchedule,
  createBenchmarkRun,
  formatBenchmarkCampaignSummary,
  parseBenchmarkCampaign,
  parseBenchmarkRun,
  pendingBenchmarkRequests,
  previewBenchmarkBudget,
  summarizeBenchmarkCampaign,
  type BenchmarkCampaignV1,
  type BenchmarkRunCompletion,
} from "../src/core/benchmark-campaign.js";

const sha = (character: string): string => character.repeat(64);
const commit = (character: string): string => character.repeat(40);

function campaign(): BenchmarkCampaignV1 {
  return {
    schemaVersion: 1,
    protocolVersion: BENCHMARK_PROTOCOL_VERSION,
    campaignId: "workflow-paired-v1",
    createdAt: "2026-07-16T12:00:00.000Z",
    category: "workflow-adherence",
    fixture: {
      id: "workflow-fixture",
      version: "1.0.0",
      fixtureSha256: sha("a"),
      rubricSha256: sha("b"),
    },
    candidates: [
      {
        role: "baseline",
        id: "baseline-skill",
        packageId: "baseline-package",
        skillPath: "skills/baseline/SKILL.md",
        reviewedCommit: commit("c"),
        instructionSha256: sha("d"),
      },
      {
        role: "candidate",
        id: "candidate-skill",
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
      maxInputTokensPerRequest: 1_000,
      maxOutputTokensPerRequest: 500,
    },
    trials: {
      pairs: 5,
      maxRetriesPerRequest: 1,
      timeoutMsPerRequest: 30_000,
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
      maxInputTokens: 20_000,
      maxOutputTokens: 10_000,
      maxCostUsd: 0.1,
      inputUsdPerMillionTokens: 2,
      outputUsdPerMillionTokens: 6,
    },
    decision: {
      minimumSuccessfulPairs: 5,
      minimumPracticalScoreDelta: 1,
      promotionPolicy: "signed-evidence-plus-human-approval",
    },
  };
}

function success(
  requestId: string,
  overrides: Partial<BenchmarkRunCompletion> = {},
): BenchmarkRunCompletion {
  return {
    requestId,
    outcome: "succeeded",
    attempts: 1,
    inputTokens: 100,
    outputTokens: 50,
    durationMs: 250,
    reportedCostUsd: 0.0005,
    outputSha256: sha("9"),
    ...overrides,
  };
}

describe("provider-neutral benchmark campaign foundation", () => {
  it("strictly validates a paired immutable campaign without execution data", () => {
    const parsed = parseBenchmarkCampaign(campaign());
    expect(parsed.candidates.map((item) => item.role)).toEqual([
      "baseline",
      "candidate",
    ]);
    expect(JSON.stringify(parsed)).not.toMatch(
      /credential|authorization|prompt|projectSource|endpoint/i,
    );

    expect(() =>
      parseBenchmarkCampaign({ ...campaign(), prompt: "hidden prompt" }),
    ).toThrow(/unknown field.*prompt/i);
    expect(() =>
      parseBenchmarkCampaign({
        ...campaign(),
        model: { ...campaign().model, credential: "secret" },
      }),
    ).toThrow(/unknown field.*credential/i);
    expect(() =>
      parseBenchmarkCampaign({
        ...campaign(),
        candidates: [
          campaign().candidates[0],
          { ...campaign().candidates[1], role: "baseline" },
        ],
      }),
    ).toThrow(/baseline and candidate roles/);
  });

  it("rejects unsafe references, unpaired trials, and relaxed isolation", () => {
    expect(() =>
      parseBenchmarkCampaign({
        ...campaign(),
        candidates: [
          { ...campaign().candidates[0], skillPath: "../private/SKILL.md" },
          campaign().candidates[1],
        ],
      }),
    ).toThrow(/portable relative path/);
    expect(() =>
      parseBenchmarkCampaign({
        ...campaign(),
        trials: { ...campaign().trials, pairs: 4 },
      }),
    ).toThrow(/5 to 100/);
    expect(() =>
      parseBenchmarkCampaign({
        ...campaign(),
        isolation: { ...campaign().isolation, networkPolicy: "enabled" },
      }),
    ).toThrow(/safety boundary/);
    expect(() =>
      parseBenchmarkCampaign({
        ...campaign(),
        model: { ...campaign().model, model: "sk-secretvalue123" },
      }),
    ).toThrow(/credential value/);
  });

  it("produces a deterministic, retry-inclusive worst-case budget preview", () => {
    const first = previewBenchmarkBudget(campaign());
    const second = previewBenchmarkBudget(structuredClone(campaign()));
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      scheduledPairs: 5,
      scheduledRequests: 10,
      worstCaseRequests: 20,
      worstCaseInputTokens: 20_000,
      worstCaseOutputTokens: 10_000,
      worstCaseCostUsd: 0.1,
      withinBudget: true,
      blockers: [],
    });
    expect(first.safetyBoundary).toMatch(/no prompt.*provider request/i);
  });

  it("exposes deterministic content-free summaries for future CLI integration", () => {
    const value = campaign();
    const first = summarizeBenchmarkCampaign(value);
    const second = summarizeBenchmarkCampaign(structuredClone(value));
    expect(first).toEqual(second);
    expect(first.scheduleSha256).toBe(benchmarkScheduleSha256(value));
    expect(first.baselineFirstPairs + first.candidateFirstPairs).toBe(5);
    expect(first).toMatchObject({
      campaignId: "workflow-paired-v1",
      category: "workflow-adherence",
      providerModel: "provider-neutral/evaluation-model@2026-07-16",
      baselineId: "baseline-skill",
      candidateId: "candidate-skill",
      pairs: 5,
      scheduledRequests: 10,
      worstCaseRequests: 20,
      withinBudget: true,
      blockers: [],
    });
    const formatted = formatBenchmarkCampaignSummary(value);
    expect(formatted).toContain("Campaign: workflow-paired-v1");
    expect(formatted).toContain("Budget: within declared ceilings");
    expect(formatted).toContain(`Schedule SHA-256: ${first.scheduleSha256}`);
    expect(formatted).not.toMatch(/prompt|credential|project source/i);
  });

  it("reports every exceeded ceiling without making a provider request", () => {
    const value = campaign();
    value.budget = {
      ...value.budget,
      maxRequests: 10,
      maxInputTokens: 10_000,
      maxOutputTokens: 5_000,
      maxCostUsd: 0.05,
    };
    const preview = previewBenchmarkBudget(value);
    expect(preview.withinBudget).toBe(false);
    expect(preview.blockers).toHaveLength(4);
    expect(preview.blockers.join(" ")).toMatch(
      /request ceiling.*input-token ceiling.*output-token ceiling.*cost ceiling/,
    );
  });

  it("derives a reproducible paired schedule and campaign hash", () => {
    const value = campaign();
    const first = buildBenchmarkSchedule(value);
    const second = buildBenchmarkSchedule(structuredClone(value));
    expect(first).toEqual(second);
    expect(first).toHaveLength(10);
    for (let pairIndex = 0; pairIndex < 5; pairIndex++) {
      const pair = first.filter((item) => item.pairIndex === pairIndex);
      expect(pair.map((item) => item.position).sort()).toEqual([1, 2]);
      expect(pair.map((item) => item.role).sort()).toEqual([
        "baseline",
        "candidate",
      ]);
    }
    expect(new Set(first.map((item) => item.requestId))).toHaveLength(10);
    const changed = campaign();
    changed.fixture.rubricSha256 = sha("8");
    expect(benchmarkCampaignSha256(changed)).not.toBe(
      benchmarkCampaignSha256(value),
    );
  });

  it("creates a resumable run and returns only deterministic pending requests", () => {
    const value = campaign();
    const schedule = buildBenchmarkSchedule(value);
    const run = createBenchmarkRun(
      value,
      "run-001",
      "2026-07-16T12:01:00.000Z",
    );
    expect(parseBenchmarkRun(run, value)).toEqual(run);
    expect(pendingBenchmarkRequests(run, value)).toEqual(schedule);

    const paused = {
      ...run,
      status: "paused" as const,
      updatedAt: "2026-07-16T12:02:00.000Z",
      completed: [success(schedule[0].requestId)],
    };
    expect(parseBenchmarkRun(paused, value)).toEqual(paused);
    expect(pendingBenchmarkRequests(paused, value)).toEqual(schedule.slice(1));
    expect(
      pendingBenchmarkRequests({ ...paused, status: "cancelled" }, value),
    ).toEqual([]);
  });

  it("rejects campaign, schedule, completion, and retry tampering", () => {
    const value = campaign();
    const schedule = buildBenchmarkSchedule(value);
    const run = createBenchmarkRun(
      value,
      "run-002",
      "2026-07-16T12:01:00.000Z",
    );
    expect(() =>
      parseBenchmarkRun({ ...run, campaignSha256: sha("0") }, value),
    ).toThrow(/campaign hash/);
    expect(() =>
      parseBenchmarkRun({ ...run, scheduleSha256: sha("0") }, value),
    ).toThrow(/schedule hash/);
    expect(() =>
      parseBenchmarkRun(
        {
          ...run,
          status: "paused",
          completed: [
            success(schedule[0].requestId),
            success(schedule[0].requestId),
          ],
        },
        value,
      ),
    ).toThrow(/duplicate completed request/);
    expect(() =>
      parseBenchmarkRun(
        {
          ...run,
          status: "paused",
          completed: [
            {
              requestId: schedule[0].requestId,
              outcome: "exhausted",
              attempts: 1,
              inputTokens: 100,
              outputTokens: 50,
              durationMs: 250,
              reportedCostUsd: 0.0005,
              failureCode: "timeout",
            },
          ],
        },
        value,
      ),
    ).toThrow(/retry ceiling/);
    expect(() =>
      parseBenchmarkRun(
        {
          ...run,
          status: "paused",
          completed: [
            { ...success(schedule[0].requestId), rawOutput: "private" },
          ],
        },
        value,
      ),
    ).toThrow(/unknown field.*rawOutput/);
  });

  it("requires terminal completeness and enforces actual usage ceilings", () => {
    const value = campaign();
    const schedule = buildBenchmarkSchedule(value);
    const run = createBenchmarkRun(
      value,
      "run-003",
      "2026-07-16T12:01:00.000Z",
    );
    expect(() =>
      parseBenchmarkRun(
        {
          ...run,
          status: "completed",
          completed: [success(schedule[0].requestId)],
        },
        value,
      ),
    ).toThrow(/account for every request/);
    expect(() =>
      parseBenchmarkRun(
        {
          ...run,
          status: "paused",
          completed: [
            success(schedule[0].requestId, {
              attempts: 2,
              inputTokens: 2_001,
            }),
          ],
        },
        value,
      ),
    ).toThrow(/integer from 0 to 2000/);

    const completed = {
      ...run,
      status: "completed" as const,
      updatedAt: "2026-07-16T12:10:00.000Z",
      completed: schedule.map((item) => success(item.requestId)),
    };
    expect(parseBenchmarkRun(completed, value).status).toBe("completed");
    expect(pendingBenchmarkRequests(completed, value)).toEqual([]);
  });
});
