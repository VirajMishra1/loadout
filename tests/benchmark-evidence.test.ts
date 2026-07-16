import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BENCHMARK_PROTOCOL_VERSION,
  buildBenchmarkSchedule,
  type BenchmarkCampaignV1,
} from "../src/core/benchmark-campaign.js";
import {
  appendBenchmarkEvidenceEvent,
  buildInterruptedRecovery,
  createBenchmarkEvidenceEvent,
  readBenchmarkEvidenceLog,
  reduceBenchmarkEvidence,
  type BenchmarkEvidenceEventV1,
} from "../src/core/benchmark-evidence.js";

const temporary: string[] = [];
const sha = (character: string): string => character.repeat(64);
const commit = (character: string): string => character.repeat(40);

function campaign(): BenchmarkCampaignV1 {
  return {
    schemaVersion: 1,
    protocolVersion: BENCHMARK_PROTOCOL_VERSION,
    campaignId: "evidence-test-v1",
    createdAt: "2026-07-16T12:00:00.000Z",
    category: "workflow-adherence",
    fixture: {
      id: "synthetic-fixture",
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
    model: { provider: "synthetic", model: "fake", version: "1" },
    sampling: {
      temperature: 0,
      topP: 1,
      maxInputTokensPerRequest: 100,
      maxOutputTokensPerRequest: 50,
    },
    trials: { pairs: 5, maxRetriesPerRequest: 1, timeoutMsPerRequest: 1_000 },
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
      maxInputTokens: 2_000,
      maxOutputTokens: 1_000,
      maxCostUsd: 1,
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 1,
    },
    decision: {
      minimumSuccessfulPairs: 5,
      minimumPracticalScoreDelta: 1,
      promotionPolicy: "signed-evidence-plus-human-approval",
    },
  };
}

function add(
  events: BenchmarkEvidenceEventV1[],
  payload: Parameters<typeof createBenchmarkEvidenceEvent>[3],
  second: number,
): BenchmarkEvidenceEventV1[] {
  return [
    ...events,
    createBenchmarkEvidenceEvent(
      campaign(),
      "run-1",
      events,
      payload,
      `2026-07-16T12:00:${String(second).padStart(2, "0")}.000Z`,
    ),
  ];
}

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("append-only benchmark evidence", () => {
  it("reduces a strict hash-chained lifecycle without persisting model content", () => {
    const request = buildBenchmarkSchedule(campaign())[0];
    let events: BenchmarkEvidenceEventV1[] = [];
    events = add(
      events,
      {
        type: "run-started",
        providerId: "synthetic",
        sandboxBackend: "injected",
        spendApproved: true,
      },
      0,
    );
    events = add(
      events,
      {
        type: "request-started",
        requestId: request.requestId,
        pairIndex: request.pairIndex,
        position: request.position,
        attempt: 1,
      },
      1,
    );
    events = add(
      events,
      {
        type: "request-completed",
        completion: {
          requestId: request.requestId,
          outcome: "succeeded",
          attempts: 1,
          inputTokens: 10,
          outputTokens: 5,
          durationMs: 20,
          reportedCostUsd: 0.001,
          outputSha256: sha("9"),
        },
      },
      2,
    );
    const state = reduceBenchmarkEvidence(events, campaign());
    expect(state.status).toBe("running");
    expect(state.pending).toHaveLength(9);
    expect(state).toMatchObject({
      attempts: 1,
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(JSON.stringify(events)).not.toMatch(
      /prompt|rawOutput|credential|secret/i,
    );
  });

  it("rejects field, hash-chain, order, and schedule tampering", () => {
    const schedule = buildBenchmarkSchedule(campaign());
    const first = add(
      [],
      {
        type: "run-started",
        providerId: "synthetic",
        sandboxBackend: "injected",
        spendApproved: true,
      },
      0,
    );
    expect(() =>
      createBenchmarkEvidenceEvent(campaign(), "run-1", first, {
        type: "request-started",
        requestId: schedule[1].requestId,
        pairIndex: schedule[1].pairIndex,
        position: schedule[1].position,
        attempt: 1,
      }),
    ).toThrow(/deterministic schedule/);

    const unknown = structuredClone(first[0]) as BenchmarkEvidenceEventV1 & {
      rawOutput: string;
    };
    unknown.rawOutput = "private";
    expect(() => reduceBenchmarkEvidence([unknown], campaign())).toThrow(
      /unknown field.*rawOutput/,
    );

    const changed = structuredClone(first[0]);
    changed.recordedAt = "2026-07-16T12:00:01.000Z";
    expect(() => reduceBenchmarkEvidence([changed], campaign())).toThrow(
      /event hash/,
    );

    const wrongHash = structuredClone(first[0]);
    wrongHash.eventSha256 = sha("0");
    expect(() => reduceBenchmarkEvidence([wrongHash], campaign())).toThrow(
      /event hash/,
    );
  });

  it("requires explicit reconciliation for an interrupted request", () => {
    const request = buildBenchmarkSchedule(campaign())[0];
    let events = add(
      [],
      {
        type: "run-started",
        providerId: "synthetic",
        sandboxBackend: "injected",
        spendApproved: true,
      },
      0,
    );
    events = add(
      events,
      {
        type: "request-started",
        requestId: request.requestId,
        pairIndex: request.pairIndex,
        position: request.position,
        attempt: 1,
      },
      1,
    );
    const state = reduceBenchmarkEvidence(events, campaign());
    const recovery = buildInterruptedRecovery(state, {
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 100,
      reportedCostUsd: 0,
    });
    events = add(events, recovery, 2);
    expect(reduceBenchmarkEvidence(events, campaign())).toMatchObject({
      inFlight: undefined,
      attempts: 1,
    });
    expect(events.at(-1)?.payload).toMatchObject({
      type: "request-recovered",
      resolution: "abandoned-unknown-provider-state",
    });
  });

  it("serializes durable JSONL appends and rejects a torn final record", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-evidence-"));
    temporary.push(root);
    const path = join(root, "run.jsonl");
    let state = await appendBenchmarkEvidenceEvent(
      path,
      campaign(),
      "run-1",
      {
        type: "run-started",
        providerId: "synthetic",
        sandboxBackend: "injected",
        spendApproved: true,
      },
      "2026-07-16T12:00:00.000Z",
    );
    expect(state.events).toHaveLength(1);
    expect((await readFile(path, "utf8")).endsWith("\n")).toBe(true);
    state = await readBenchmarkEvidenceLog(path, campaign());
    expect(state.lastEventSha256).toMatch(/^[a-f0-9]{64}$/);
    await writeFile(path, `${await readFile(path, "utf8")}{"partial":`, "utf8");
    await expect(readBenchmarkEvidenceLog(path, campaign())).rejects.toThrow(
      /incomplete record/,
    );
  });
});
