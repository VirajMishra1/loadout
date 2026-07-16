import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildBenchmarkSchedule,
  parseBenchmarkCampaign,
  previewBenchmarkBudget,
  type BenchmarkCampaignV1,
  type BenchmarkRunCompletion,
  type BenchmarkScheduledRequest,
} from "./benchmark-campaign.js";
import {
  createBenchmarkEvidenceEvent,
  reduceBenchmarkEvidence,
  type BenchmarkEvidenceEventV1,
  type BenchmarkEvidencePayload,
  type BenchmarkEvidenceState,
} from "./benchmark-evidence.js";

const execFileAsync = promisify(execFile);

export interface BenchmarkProviderRequest {
  provider: string;
  model: string;
  modelVersion: string;
  input: string;
  temperature: number;
  topP: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  signal: AbortSignal;
}

interface BenchmarkProviderUsage {
  inputTokens: number;
  outputTokens: number;
  reportedCostUsd: number;
}

export type BenchmarkProviderResult = BenchmarkProviderUsage &
  (
    | { outcome: "succeeded"; output: string }
    | { outcome: "failed"; failureCode: string }
  );

export interface BenchmarkProviderAdapter {
  /** Must match campaign.model.provider. Never include an endpoint or credential. */
  id: string;
  invoke(request: BenchmarkProviderRequest): Promise<BenchmarkProviderResult>;
}

export interface PreparedBenchmarkRequest {
  /** Ephemeral provider input. The evidence log never persists this value. */
  input: string;
  teardown(): Promise<void>;
}

export interface BenchmarkIsolationExecutor {
  backend: "docker" | "podman" | "injected";
  prepare(
    request: BenchmarkScheduledRequest,
    candidate: BenchmarkCampaignV1["candidates"][number],
    signal: AbortSignal,
  ): Promise<PreparedBenchmarkRequest>;
}

export interface LocalSandboxSelection {
  backend: "docker" | "podman" | "unavailable";
  binary?: "docker" | "podman";
  reasonCode: "available" | "no-supported-container-runtime";
}

export interface BenchmarkRunnerOptions {
  campaign: BenchmarkCampaignV1;
  runId: string;
  /** No provider exists by default; callers must explicitly inject one. */
  provider?: BenchmarkProviderAdapter;
  executor?: BenchmarkIsolationExecutor;
  approveSpend: boolean;
  existingEvents?: readonly BenchmarkEvidenceEventV1[];
  maxTotalDurationMs?: number;
  signal?: AbortSignal;
  now?: () => string;
  onEvent?: (event: BenchmarkEvidenceEventV1) => Promise<void> | void;
}

export interface BenchmarkRunnerResult {
  state: BenchmarkEvidenceState;
  emitted: BenchmarkEvidenceEventV1[];
}

type Probe = (binary: "docker" | "podman", args: string[]) => Promise<boolean>;

function safeId(value: string, context: string): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value) ||
    value.includes("..") ||
    /(?:sk-|bearer\s|api[_-]?key|token=|password=|https?:\/\/)/i.test(value)
  )
    throw new Error(`${context} is invalid or contains sensitive material`);
}

/** Select Docker first, then Podman. There is intentionally no host-process fallback. */
export async function selectLocalBenchmarkSandbox(
  options: { probe?: Probe } = {},
): Promise<LocalSandboxSelection> {
  const probe =
    options.probe ??
    (async (binary: "docker" | "podman", args: string[]) => {
      try {
        await execFileAsync(binary, args, {
          timeout: 2_000,
          windowsHide: true,
          env: { PATH: process.env.PATH ?? "" },
          maxBuffer: 64 * 1024,
        });
        return true;
      } catch {
        return false;
      }
    });
  for (const binary of ["docker", "podman"] as const) {
    if (await probe(binary, ["version", "--format", "{{.Server.Version}}"]))
      return { backend: binary, binary, reasonCode: "available" };
  }
  return {
    backend: "unavailable",
    reasonCode: "no-supported-container-runtime",
  };
}

function timeoutSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const abort = (): void => controller.abort(parent?.reason);
  parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("benchmark-timeout")),
    timeoutMs,
  );
  timer.unref();
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}

async function withinTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parent: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  const bounded = timeoutSignal(parent, timeoutMs);
  let listener: (() => void) | undefined;
  try {
    return await Promise.race([
      operation(bounded.signal),
      new Promise<never>((_resolve, reject) => {
        listener = () => reject(new Error("benchmark-timeout-or-abort"));
        bounded.signal.addEventListener("abort", listener, { once: true });
      }),
    ]);
  } finally {
    if (listener) bounded.signal.removeEventListener("abort", listener);
    bounded.dispose();
  }
}

function validateProviderResult(
  result: BenchmarkProviderResult,
  campaign: BenchmarkCampaignV1,
): BenchmarkProviderResult {
  if (result.outcome !== "succeeded" && result.outcome !== "failed")
    throw new Error("provider-invalid-result");
  if (result.outcome === "succeeded") {
    if (
      typeof result.output !== "string" ||
      Buffer.byteLength(result.output, "utf8") >
        Math.max(1_024, campaign.sampling.maxOutputTokensPerRequest * 16)
    )
      throw new Error("provider-invalid-result");
  } else safeId(result.failureCode, "Benchmark provider failure code");
  const values: Array<[number, number]> = [
    [result.inputTokens, campaign.sampling.maxInputTokensPerRequest],
    [result.outputTokens, campaign.sampling.maxOutputTokensPerRequest],
  ];
  if (
    values.some(
      ([value, cap]) => !Number.isInteger(value) || value < 0 || value > cap,
    ) ||
    !Number.isFinite(result.reportedCostUsd) ||
    result.reportedCostUsd < 0 ||
    result.reportedCostUsd > campaign.budget.maxCostUsd
  )
    throw new Error("provider-usage-out-of-bounds");
  return result;
}

function remainingCanReserveAttempt(
  state: BenchmarkEvidenceState,
  campaign: BenchmarkCampaignV1,
): boolean {
  const worstCost =
    (campaign.sampling.maxInputTokensPerRequest / 1_000_000) *
      campaign.budget.inputUsdPerMillionTokens +
    (campaign.sampling.maxOutputTokensPerRequest / 1_000_000) *
      campaign.budget.outputUsdPerMillionTokens;
  return (
    state.attempts + 1 <= campaign.budget.maxRequests &&
    state.inputTokens + campaign.sampling.maxInputTokensPerRequest <=
      campaign.budget.maxInputTokens &&
    state.outputTokens + campaign.sampling.maxOutputTokensPerRequest <=
      campaign.budget.maxOutputTokens &&
    state.reportedCostUsd + worstCost <=
      campaign.budget.maxCostUsd + Number.EPSILON
  );
}

function completionForFailure(
  requestId: string,
  attempts: number,
  usage: BenchmarkProviderUsage & { durationMs: number },
  failureCode: string,
): BenchmarkRunCompletion {
  return {
    requestId,
    outcome: "exhausted",
    attempts,
    ...usage,
    failureCode,
  };
}

/**
 * Execute a deterministic paired campaign through injected boundaries.
 * This module contains no SDK, endpoint, credential, or default provider and
 * therefore cannot make a real provider call unless the caller supplies one.
 */
export async function runPairedBenchmark(
  options: BenchmarkRunnerOptions,
): Promise<BenchmarkRunnerResult> {
  const campaign = parseBenchmarkCampaign(options.campaign);
  safeId(options.runId, "Benchmark run id");
  if (!options.approveSpend)
    throw new Error("Benchmark execution requires explicit spend approval");
  if (!options.provider)
    throw new Error(
      "Benchmark execution requires an injected provider adapter",
    );
  if (!options.executor)
    throw new Error(
      "Benchmark execution requires an injected isolation executor",
    );
  safeId(options.provider.id, "Benchmark provider id");
  if (options.provider.id !== campaign.model.provider)
    throw new Error("Benchmark provider does not match the immutable campaign");
  const preview = previewBenchmarkBudget(campaign);
  if (!preview.withinBudget)
    throw new Error(
      `Benchmark campaign exceeds declared budget: ${preview.blockers.join("; ")}`,
    );
  const maximumPossibleDuration =
    campaign.trials.pairs *
    2 *
    (campaign.trials.maxRetriesPerRequest + 1) *
    campaign.trials.timeoutMsPerRequest;
  const maxTotalDurationMs =
    options.maxTotalDurationMs ?? maximumPossibleDuration;
  if (
    !Number.isInteger(maxTotalDurationMs) ||
    maxTotalDurationMs < campaign.trials.timeoutMsPerRequest ||
    maxTotalDurationMs > maximumPossibleDuration
  )
    throw new Error("Benchmark total-time ceiling is invalid");

  let events = [...(options.existingEvents ?? [])];
  let state = reduceBenchmarkEvidence(events, campaign);
  if (state.inFlight)
    throw new Error(
      "Benchmark has an interrupted in-flight request; append an explicit recovery before resuming",
    );
  if (state.status === "completed" || state.status === "cancelled")
    return { state, emitted: [] };
  const emitted: BenchmarkEvidenceEventV1[] = [];
  const now = options.now ?? (() => new Date().toISOString());
  const emit = async (payload: BenchmarkEvidencePayload): Promise<void> => {
    const event = createBenchmarkEvidenceEvent(
      campaign,
      options.runId,
      events,
      payload,
      now(),
    );
    await options.onEvent?.(event);
    events = [...events, event];
    emitted.push(event);
    state = reduceBenchmarkEvidence(events, campaign);
  };
  if (state.status === "empty")
    await emit({
      type: "run-started",
      providerId: options.provider.id,
      sandboxBackend: options.executor.backend,
      spendApproved: true,
    });

  const byRole = new Map(
    campaign.candidates.map((candidate) => [candidate.role, candidate]),
  );
  const schedule = buildBenchmarkSchedule(campaign);
  const startedAt = Date.now();
  for (const request of schedule.filter((item) =>
    state.pending.some((pending) => pending.requestId === item.requestId),
  )) {
    if (options.signal?.aborted) {
      await emit({ type: "run-paused", reasonCode: "caller-aborted" });
      return { state, emitted };
    }
    if (state.durationMs + Date.now() - startedAt >= maxTotalDurationMs) {
      await emit({ type: "run-paused", reasonCode: "overall-time-ceiling" });
      return { state, emitted };
    }
    let durationMs = state.currentRequestUsage.durationMs;
    let inputTokens = state.currentRequestUsage.inputTokens;
    let outputTokens = state.currentRequestUsage.outputTokens;
    let reportedCostUsd = state.currentRequestUsage.reportedCostUsd;
    const priorAttempts = events.filter(
      (event) =>
        event.payload.type === "request-started" &&
        event.payload.requestId === request.requestId,
    ).length;
    for (
      let attempt = priorAttempts + 1;
      attempt <= campaign.trials.maxRetriesPerRequest + 1;
      attempt++
    ) {
      if (!remainingCanReserveAttempt(state, campaign)) {
        await emit({ type: "run-paused", reasonCode: "budget-ceiling" });
        return { state, emitted };
      }
      await emit({
        type: "request-started",
        requestId: request.requestId,
        pairIndex: request.pairIndex,
        position: request.position,
        attempt,
      });
      const attemptStarted = Date.now();
      let prepared: PreparedBenchmarkRequest | undefined;
      let teardownFailed = false;
      let providerInvoked = false;
      let providerResult: BenchmarkProviderResult | undefined;
      let knownFailureCode = "executor-failed-or-timed-out";
      try {
        const candidate = byRole.get(request.role)!;
        prepared = await withinTimeout(
          (signal) => options.executor!.prepare(request, candidate, signal),
          options.signal,
          campaign.trials.timeoutMsPerRequest,
        );
        if (
          !prepared ||
          typeof prepared.input !== "string" ||
          typeof prepared.teardown !== "function"
        )
          throw new Error("executor-invalid-result");
        if (
          Buffer.byteLength(prepared.input, "utf8") >
          Math.max(1_024, campaign.sampling.maxInputTokensPerRequest * 16)
        )
          throw new Error("executor-input-out-of-bounds");
        providerInvoked = true;
        providerResult = validateProviderResult(
          await withinTimeout(
            (signal) =>
              options.provider!.invoke({
                provider: campaign.model.provider,
                model: campaign.model.model,
                modelVersion: campaign.model.version,
                input: prepared!.input,
                temperature: campaign.sampling.temperature,
                topP: campaign.sampling.topP,
                maxInputTokens: campaign.sampling.maxInputTokensPerRequest,
                maxOutputTokens: campaign.sampling.maxOutputTokensPerRequest,
                signal,
              }),
            options.signal,
            campaign.trials.timeoutMsPerRequest,
          ),
          campaign,
        );
        inputTokens += providerResult.inputTokens;
        outputTokens += providerResult.outputTokens;
        reportedCostUsd += providerResult.reportedCostUsd;
        if (providerResult.outcome === "failed")
          knownFailureCode = providerResult.failureCode;
      } catch {
        // Once a provider invocation starts, an exception or timeout can hide
        // billable usage. Never retry that request automatically.
        if (providerInvoked) knownFailureCode = "provider-state-unknown";
      } finally {
        durationMs += Math.min(
          Date.now() - attemptStarted,
          campaign.trials.timeoutMsPerRequest,
        );
        if (prepared) {
          try {
            await withinTimeout(
              () => prepared!.teardown(),
              undefined,
              Math.min(5_000, campaign.trials.timeoutMsPerRequest),
            );
          } catch {
            teardownFailed = true;
          }
        }
      }
      if (teardownFailed || (providerInvoked && !providerResult)) {
        await emit({
          type: "run-paused",
          reasonCode: teardownFailed
            ? "teardown-failed"
            : "interrupted-attempt",
        });
        return { state, emitted };
      }
      if (options.signal?.aborted) {
        await emit({ type: "run-paused", reasonCode: "caller-aborted" });
        return { state, emitted };
      }
      if (providerResult?.outcome === "succeeded") {
        await emit({
          type: "request-completed",
          completion: {
            requestId: request.requestId,
            outcome: "succeeded",
            attempts: attempt,
            inputTokens,
            outputTokens,
            durationMs,
            reportedCostUsd,
            outputSha256: createHash("sha256")
              .update(providerResult.output)
              .digest("hex"),
          },
        });
        break;
      }
      if (attempt === campaign.trials.maxRetriesPerRequest + 1) {
        await emit({
          type: "request-completed",
          completion: completionForFailure(
            request.requestId,
            attempt,
            { inputTokens, outputTokens, durationMs, reportedCostUsd },
            knownFailureCode,
          ),
        });
      } else {
        const prior = state.currentRequestUsage;
        await emit({
          type: "request-attempt-failed",
          requestId: request.requestId,
          attempt,
          inputTokens: inputTokens - prior.inputTokens,
          outputTokens: outputTokens - prior.outputTokens,
          durationMs: durationMs - prior.durationMs,
          reportedCostUsd: reportedCostUsd - prior.reportedCostUsd,
          failureCode: knownFailureCode,
        });
      }
    }
  }
  await emit({ type: "run-completed" });
  return { state, emitted };
}
