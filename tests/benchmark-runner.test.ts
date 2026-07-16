import { describe, expect, it, vi } from "vitest";
import {
  BENCHMARK_PROTOCOL_VERSION,
  buildBenchmarkSchedule,
  type BenchmarkCampaignV1,
} from "../src/core/benchmark-campaign.js";
import {
  buildInterruptedRecovery,
  createBenchmarkEvidenceEvent,
  reduceBenchmarkEvidence,
  type BenchmarkEvidenceEventV1,
} from "../src/core/benchmark-evidence.js";
import {
  runPairedBenchmark,
  selectLocalBenchmarkSandbox,
  type BenchmarkIsolationExecutor,
  type BenchmarkProviderAdapter,
} from "../src/core/benchmark-runner.js";

const sha = (character: string): string => character.repeat(64);
const commit = (character: string): string => character.repeat(40);

function campaign(): BenchmarkCampaignV1 {
  return {
    schemaVersion: 1,
    protocolVersion: BENCHMARK_PROTOCOL_VERSION,
    campaignId: "runner-test-v1",
    createdAt: "2026-07-16T12:00:00.000Z",
    category: "code-review-coverage",
    fixture: {
      id: "synthetic-review",
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

function executor(
  teardown = vi.fn(async () => undefined),
): BenchmarkIsolationExecutor {
  return {
    backend: "injected",
    async prepare(request, candidate) {
      return { input: `${request.requestId}:${candidate.role}`, teardown };
    },
  };
}

function provider(
  invoke?: BenchmarkProviderAdapter["invoke"],
): BenchmarkProviderAdapter {
  return {
    id: "synthetic",
    invoke:
      invoke ??
      (async () => ({
        outcome: "succeeded" as const,
        output: "synthetic output",
        inputTokens: 10,
        outputTokens: 5,
        reportedCostUsd: 0.001,
      })),
  };
}

describe("isolated paired benchmark runner", () => {
  it("cannot call a provider by default or without explicit spend approval", async () => {
    const invoke = vi.fn(provider().invoke);
    await expect(
      runPairedBenchmark({
        campaign: campaign(),
        runId: "run-1",
        provider: provider(invoke),
        executor: executor(),
        approveSpend: false,
      }),
    ).rejects.toThrow(/explicit spend approval/);
    await expect(
      runPairedBenchmark({
        campaign: campaign(),
        runId: "run-1",
        executor: executor(),
        approveSpend: true,
      }),
    ).rejects.toThrow(/injected provider/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("runs deterministic paired order and persists only hashes and bounded usage", async () => {
    const inputs: string[] = [];
    const teardown = vi.fn(async () => undefined);
    const result = await runPairedBenchmark({
      campaign: campaign(),
      runId: "run-2",
      provider: provider(async (request) => {
        inputs.push(request.input);
        expect(request.signal).toBeInstanceOf(AbortSignal);
        return {
          outcome: "succeeded",
          output: `private-${request.input}`,
          inputTokens: 10,
          outputTokens: 5,
          reportedCostUsd: 0.001,
        };
      }),
      executor: executor(teardown),
      approveSpend: true,
      now: () => "2026-07-16T12:00:00.000Z",
    });
    expect(inputs).toEqual(
      buildBenchmarkSchedule(campaign()).map(
        (request) => `${request.requestId}:${request.role}`,
      ),
    );
    expect(result.state).toMatchObject({
      status: "completed",
      attempts: 10,
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(teardown).toHaveBeenCalledTimes(10);
    expect(JSON.stringify(result.emitted)).not.toContain("private-");
    expect(result.state.completions.every((item) => item.outputSha256)).toBe(
      true,
    );
  });

  it("retries within the hard request ceiling and records total attempts", async () => {
    let calls = 0;
    const result = await runPairedBenchmark({
      campaign: campaign(),
      runId: "run-3",
      provider: provider(async () => {
        calls += 1;
        if (calls === 1)
          return {
            outcome: "failed",
            failureCode: "synthetic-transient",
            inputTokens: 2,
            outputTokens: 1,
            reportedCostUsd: 0.0001,
          };
        return {
          outcome: "succeeded",
          output: "ok",
          inputTokens: 1,
          outputTokens: 1,
          reportedCostUsd: 0,
        };
      }),
      executor: executor(),
      approveSpend: true,
    });
    expect(result.state.status).toBe("completed");
    expect(result.state.attempts).toBe(11);
    expect(result.state.completions[0].attempts).toBe(2);
    expect(result.state.inputTokens).toBe(12);
  });

  it("pauses on abort and teardown failure without advancing uncertain work", async () => {
    const aborted = new AbortController();
    aborted.abort();
    const invoke = vi.fn(provider().invoke);
    const before = await runPairedBenchmark({
      campaign: campaign(),
      runId: "run-4",
      provider: provider(invoke),
      executor: executor(),
      approveSpend: true,
      signal: aborted.signal,
    });
    expect(before.state.status).toBe("paused");
    expect(invoke).not.toHaveBeenCalled();

    const teardownFailure = await runPairedBenchmark({
      campaign: campaign(),
      runId: "run-5",
      provider: provider(),
      executor: executor(
        vi.fn(async () => Promise.reject(new Error("cleanup secret"))),
      ),
      approveSpend: true,
    });
    expect(teardownFailure.state.status).toBe("paused");
    expect(teardownFailure.state.inFlight).toBeDefined();
    expect(JSON.stringify(teardownFailure.emitted)).not.toContain(
      "cleanup secret",
    );
  });

  it("refuses automatic replay of interrupted paid work and resumes after reconciliation", async () => {
    const request = buildBenchmarkSchedule(campaign())[0];
    let events: BenchmarkEvidenceEventV1[] = [];
    for (const payload of [
      {
        type: "run-started" as const,
        providerId: "synthetic",
        sandboxBackend: "injected" as const,
        spendApproved: true as const,
      },
      {
        type: "request-started" as const,
        requestId: request.requestId,
        pairIndex: request.pairIndex,
        position: request.position,
        attempt: 1,
      },
    ]) {
      events = [
        ...events,
        createBenchmarkEvidenceEvent(campaign(), "run-6", events, payload),
      ];
    }
    await expect(
      runPairedBenchmark({
        campaign: campaign(),
        runId: "run-6",
        provider: provider(),
        executor: executor(),
        approveSpend: true,
        existingEvents: events,
      }),
    ).rejects.toThrow(/explicit recovery/);
    const recovery = buildInterruptedRecovery(
      reduceBenchmarkEvidence(events, campaign()),
      { inputTokens: 0, outputTokens: 0, durationMs: 10, reportedCostUsd: 0 },
    );
    events = [
      ...events,
      createBenchmarkEvidenceEvent(campaign(), "run-6", events, recovery),
    ];
    const resumed = await runPairedBenchmark({
      campaign: campaign(),
      runId: "run-6",
      provider: provider(),
      executor: executor(),
      approveSpend: true,
      existingEvents: events,
    });
    expect(resumed.state.status).toBe("completed");
    expect(resumed.state.completions).toHaveLength(10);
  });

  it("pauses instead of retrying when provider usage is unknown or invalid", async () => {
    const invoke = vi.fn(async () => ({
      outcome: "succeeded" as const,
      output: "x".repeat(10_000),
      inputTokens: 101,
      outputTokens: 51,
      reportedCostUsd: 2,
    }));
    const result = await runPairedBenchmark({
      campaign: campaign(),
      runId: "run-7",
      provider: provider(invoke),
      executor: executor(),
      approveSpend: true,
    });
    expect(result.state.status).toBe("paused");
    expect(result.state.inFlight).toBeDefined();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("selects Docker, falls back to Podman, and never falls back to the host", async () => {
    const calls: string[] = [];
    const podman = await selectLocalBenchmarkSandbox({
      probe: async (binary, args) => {
        calls.push(`${binary}:${args.join(" ")}`);
        return binary === "podman";
      },
    });
    expect(podman).toEqual({
      backend: "podman",
      binary: "podman",
      reasonCode: "available",
    });
    expect(calls.map((item) => item.split(":")[0])).toEqual([
      "docker",
      "podman",
    ]);
    const unavailable = await selectLocalBenchmarkSandbox({
      probe: async () => false,
    });
    expect(unavailable).toEqual({
      backend: "unavailable",
      reasonCode: "no-supported-container-runtime",
    });
  });
});
