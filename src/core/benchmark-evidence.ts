import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  benchmarkCampaignSha256,
  benchmarkScheduleSha256,
  buildBenchmarkSchedule,
  parseBenchmarkCampaign,
  type BenchmarkCampaignV1,
  type BenchmarkRunCompletion,
  type BenchmarkScheduledRequest,
} from "./benchmark-campaign.js";
import { withFileLock } from "./file-lock.js";

export const BENCHMARK_EVIDENCE_VERSION =
  "loadout-benchmark-evidence-v1" as const;

export type BenchmarkEvidenceEventType =
  | "run-started"
  | "request-started"
  | "request-attempt-failed"
  | "request-completed"
  | "request-recovered"
  | "run-paused"
  | "run-completed"
  | "run-cancelled";

export type BenchmarkEvidencePayload =
  | {
      type: "run-started";
      providerId: string;
      sandboxBackend: "docker" | "podman" | "injected";
      spendApproved: true;
    }
  | {
      type: "request-started";
      requestId: string;
      pairIndex: number;
      position: 1 | 2;
      attempt: number;
    }
  | {
      type: "request-attempt-failed";
      requestId: string;
      attempt: number;
      inputTokens: number;
      outputTokens: number;
      durationMs: number;
      reportedCostUsd: number;
      failureCode: string;
    }
  | {
      type: "request-completed";
      completion: BenchmarkRunCompletion;
    }
  | {
      type: "request-recovered";
      completion: BenchmarkRunCompletion;
      resolution: "abandoned-unknown-provider-state";
    }
  | { type: "run-paused"; reasonCode: BenchmarkPauseReason }
  | { type: "run-completed" }
  | { type: "run-cancelled"; reasonCode: string };

export type BenchmarkPauseReason =
  | "caller-aborted"
  | "overall-time-ceiling"
  | "teardown-failed"
  | "interrupted-attempt"
  | "budget-ceiling";

export interface BenchmarkEvidenceEventV1 {
  schemaVersion: 1;
  evidenceVersion: typeof BENCHMARK_EVIDENCE_VERSION;
  runId: string;
  campaignId: string;
  campaignSha256: string;
  scheduleSha256: string;
  sequence: number;
  recordedAt: string;
  previousEventSha256: string | null;
  payload: BenchmarkEvidencePayload;
  eventSha256: string;
}

export interface BenchmarkEvidenceState {
  runId?: string;
  status: "empty" | "running" | "paused" | "completed" | "cancelled";
  events: BenchmarkEvidenceEventV1[];
  completions: BenchmarkRunCompletion[];
  pending: BenchmarkScheduledRequest[];
  inFlight?: {
    request: BenchmarkScheduledRequest;
    attempt: number;
  };
  currentRequestUsage: {
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    reportedCostUsd: number;
  };
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  reportedCostUsd: number;
  durationMs: number;
  lastEventSha256?: string;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PAUSE_REASONS = new Set<BenchmarkPauseReason>([
  "caller-aborted",
  "overall-time-ceiling",
  "teardown-failed",
  "interrupted-attempt",
  "budget-ceiling",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  context: string,
): void {
  const expectedSet = new Set(expected);
  const unknown = Object.keys(value).filter((key) => !expectedSet.has(key));
  if (unknown.length)
    throw new Error(`${context} has unknown field(s): ${unknown.join(", ")}`);
  const missing = expected.filter((key) => !(key in value));
  if (missing.length)
    throw new Error(`${context} is missing field(s): ${missing.join(", ")}`);
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Cannot hash a non-finite value");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value))
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  throw new Error(`Cannot hash value of type ${typeof value}`);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function assertIdentifier(
  value: unknown,
  context: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !ID.test(value) ||
    value.includes("..") ||
    value.includes("//") ||
    /(?:sk-|bearer\s|api[_-]?key|token=|password=)/i.test(value)
  )
    throw new Error(`${context} is invalid or contains sensitive material`);
}

function assertTimestamp(
  value: unknown,
  context: string,
): asserts value is string {
  if (typeof value !== "string" || new Date(value).toISOString() !== value)
    throw new Error(`${context} must be an ISO-8601 UTC timestamp`);
}

function assertInteger(
  value: unknown,
  context: string,
  minimum: number,
  maximum: number,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw new Error(
      `${context} must be an integer from ${minimum} to ${maximum}`,
    );
}

function assertFinite(
  value: unknown,
  context: string,
  maximum: number,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > maximum
  )
    throw new Error(`${context} must be a finite number from 0 to ${maximum}`);
}

function parseCompletion(
  value: unknown,
  campaign: BenchmarkCampaignV1,
  scheduleIds: Set<string>,
): BenchmarkRunCompletion {
  if (!isRecord(value))
    throw new Error("Benchmark completion must be an object");
  const common = [
    "requestId",
    "outcome",
    "attempts",
    "inputTokens",
    "outputTokens",
    "durationMs",
    "reportedCostUsd",
  ];
  exactKeys(
    value,
    value.outcome === "succeeded"
      ? [...common, "outputSha256"]
      : value.outcome === "exhausted"
        ? [...common, "failureCode"]
        : common,
    "Benchmark completion",
  );
  if (typeof value.requestId !== "string" || !scheduleIds.has(value.requestId))
    throw new Error("Benchmark completion request is outside the schedule");
  if (value.outcome !== "succeeded" && value.outcome !== "exhausted")
    throw new Error("Benchmark completion outcome is invalid");
  assertInteger(
    value.attempts,
    "Benchmark completion attempts",
    1,
    campaign.trials.maxRetriesPerRequest + 1,
  );
  assertInteger(
    value.inputTokens,
    "Benchmark completion input tokens",
    0,
    value.attempts * campaign.sampling.maxInputTokensPerRequest,
  );
  assertInteger(
    value.outputTokens,
    "Benchmark completion output tokens",
    0,
    value.attempts * campaign.sampling.maxOutputTokensPerRequest,
  );
  assertFinite(
    value.durationMs,
    "Benchmark completion duration",
    value.attempts * campaign.trials.timeoutMsPerRequest,
  );
  assertFinite(
    value.reportedCostUsd,
    "Benchmark completion cost",
    campaign.budget.maxCostUsd,
  );
  if (value.outcome === "succeeded") {
    if (
      typeof value.outputSha256 !== "string" ||
      !SHA256.test(value.outputSha256)
    )
      throw new Error("Benchmark completion output hash is invalid");
  } else {
    assertIdentifier(value.failureCode, "Benchmark completion failure code");
  }
  return value as unknown as BenchmarkRunCompletion;
}

function parsePayload(
  value: unknown,
  campaign: BenchmarkCampaignV1,
  schedule: BenchmarkScheduledRequest[],
): BenchmarkEvidencePayload {
  if (!isRecord(value) || typeof value.type !== "string")
    throw new Error("Benchmark evidence payload is invalid");
  const scheduleIds = new Set(schedule.map((request) => request.requestId));
  switch (value.type as BenchmarkEvidenceEventType) {
    case "run-started":
      exactKeys(
        value,
        ["type", "providerId", "sandboxBackend", "spendApproved"],
        "Run-started payload",
      );
      assertIdentifier(value.providerId, "Benchmark provider id");
      if (
        !new Set(["docker", "podman", "injected"]).has(
          String(value.sandboxBackend),
        )
      )
        throw new Error("Benchmark sandbox backend is invalid");
      if (value.spendApproved !== true)
        throw new Error("Benchmark evidence requires explicit spend approval");
      break;
    case "request-started": {
      exactKeys(
        value,
        ["type", "requestId", "pairIndex", "position", "attempt"],
        "Request-started payload",
      );
      const request = schedule.find(
        (item) => item.requestId === value.requestId,
      );
      if (!request) throw new Error("Started request is outside the schedule");
      if (
        value.pairIndex !== request.pairIndex ||
        value.position !== request.position
      )
        throw new Error("Started request metadata does not match the schedule");
      assertInteger(
        value.attempt,
        "Benchmark request attempt",
        1,
        campaign.trials.maxRetriesPerRequest + 1,
      );
      break;
    }
    case "request-attempt-failed":
      exactKeys(
        value,
        [
          "type",
          "requestId",
          "attempt",
          "inputTokens",
          "outputTokens",
          "durationMs",
          "reportedCostUsd",
          "failureCode",
        ],
        "Request-attempt-failed payload",
      );
      if (
        typeof value.requestId !== "string" ||
        !scheduleIds.has(value.requestId)
      )
        throw new Error("Failed benchmark attempt is outside the schedule");
      assertInteger(
        value.attempt,
        "Failed benchmark attempt number",
        1,
        campaign.trials.maxRetriesPerRequest + 1,
      );
      assertInteger(
        value.inputTokens,
        "Failed benchmark attempt input tokens",
        0,
        campaign.sampling.maxInputTokensPerRequest,
      );
      assertInteger(
        value.outputTokens,
        "Failed benchmark attempt output tokens",
        0,
        campaign.sampling.maxOutputTokensPerRequest,
      );
      assertFinite(
        value.durationMs,
        "Failed benchmark attempt duration",
        campaign.trials.timeoutMsPerRequest,
      );
      assertFinite(
        value.reportedCostUsd,
        "Failed benchmark attempt cost",
        campaign.budget.maxCostUsd,
      );
      assertIdentifier(value.failureCode, "Failed benchmark attempt code");
      break;
    case "request-completed":
      exactKeys(value, ["type", "completion"], "Request-completed payload");
      return {
        type: "request-completed",
        completion: parseCompletion(value.completion, campaign, scheduleIds),
      };
    case "request-recovered":
      exactKeys(
        value,
        ["type", "completion", "resolution"],
        "Request-recovered payload",
      );
      if (value.resolution !== "abandoned-unknown-provider-state")
        throw new Error("Benchmark recovery resolution is invalid");
      return {
        type: "request-recovered",
        completion: parseCompletion(value.completion, campaign, scheduleIds),
        resolution: value.resolution,
      };
    case "run-paused":
      exactKeys(value, ["type", "reasonCode"], "Run-paused payload");
      if (!PAUSE_REASONS.has(value.reasonCode as BenchmarkPauseReason))
        throw new Error("Benchmark pause reason is invalid");
      break;
    case "run-completed":
      exactKeys(value, ["type"], "Run-completed payload");
      break;
    case "run-cancelled":
      exactKeys(value, ["type", "reasonCode"], "Run-cancelled payload");
      assertIdentifier(value.reasonCode, "Benchmark cancellation reason");
      break;
    default:
      throw new Error(`Unsupported benchmark evidence event: ${value.type}`);
  }
  return value as unknown as BenchmarkEvidencePayload;
}

function unsignedEvent(
  event: BenchmarkEvidenceEventV1,
): Omit<BenchmarkEvidenceEventV1, "eventSha256"> {
  const unsigned: Partial<BenchmarkEvidenceEventV1> = { ...event };
  delete unsigned.eventSha256;
  return unsigned as Omit<BenchmarkEvidenceEventV1, "eventSha256">;
}

export function benchmarkEvidenceEventSha256(
  event: Omit<BenchmarkEvidenceEventV1, "eventSha256">,
): string {
  return sha256(event);
}

export function parseBenchmarkEvidenceEvent(
  value: unknown,
  campaignValue: BenchmarkCampaignV1,
): BenchmarkEvidenceEventV1 {
  const campaign = parseBenchmarkCampaign(campaignValue);
  if (!isRecord(value))
    throw new Error("Benchmark evidence event must be an object");
  exactKeys(
    value,
    [
      "schemaVersion",
      "evidenceVersion",
      "runId",
      "campaignId",
      "campaignSha256",
      "scheduleSha256",
      "sequence",
      "recordedAt",
      "previousEventSha256",
      "payload",
      "eventSha256",
    ],
    "Benchmark evidence event",
  );
  if (
    value.schemaVersion !== 1 ||
    value.evidenceVersion !== BENCHMARK_EVIDENCE_VERSION
  )
    throw new Error("Unsupported benchmark evidence version");
  assertIdentifier(value.runId, "Benchmark run id");
  if (value.campaignId !== campaign.campaignId)
    throw new Error("Benchmark evidence names a different campaign");
  if (value.campaignSha256 !== benchmarkCampaignSha256(campaign))
    throw new Error("Benchmark evidence campaign hash is invalid");
  if (value.scheduleSha256 !== benchmarkScheduleSha256(campaign))
    throw new Error("Benchmark evidence schedule hash is invalid");
  assertInteger(value.sequence, "Benchmark evidence sequence", 0, 100_000);
  assertTimestamp(value.recordedAt, "Benchmark evidence timestamp");
  if (
    value.previousEventSha256 !== null &&
    !SHA256.test(String(value.previousEventSha256))
  )
    throw new Error("Benchmark previous-event hash is invalid");
  const payload = parsePayload(
    value.payload,
    campaign,
    buildBenchmarkSchedule(campaign),
  );
  if (typeof value.eventSha256 !== "string" || !SHA256.test(value.eventSha256))
    throw new Error("Benchmark event hash is invalid");
  const event = { ...value, payload } as unknown as BenchmarkEvidenceEventV1;
  if (benchmarkEvidenceEventSha256(unsignedEvent(event)) !== event.eventSha256)
    throw new Error("Benchmark event hash is invalid");
  return event;
}

export function reduceBenchmarkEvidence(
  values: readonly unknown[],
  campaignValue: BenchmarkCampaignV1,
): BenchmarkEvidenceState {
  const campaign = parseBenchmarkCampaign(campaignValue);
  const schedule = buildBenchmarkSchedule(campaign);
  const state: BenchmarkEvidenceState = {
    status: "empty",
    events: [],
    completions: [],
    pending: [...schedule],
    currentRequestUsage: {
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      reportedCostUsd: 0,
    },
    attempts: 0,
    inputTokens: 0,
    outputTokens: 0,
    reportedCostUsd: 0,
    durationMs: 0,
  };
  for (const [index, value] of values.entries()) {
    const event = parseBenchmarkEvidenceEvent(value, campaign);
    if (event.sequence !== index)
      throw new Error(
        `Benchmark evidence sequence is non-contiguous at ${index}`,
      );
    if (index === 0) {
      if (event.previousEventSha256 !== null)
        throw new Error("First benchmark event must not name a predecessor");
      if (event.payload.type !== "run-started")
        throw new Error("First benchmark event must start the run");
      state.runId = event.runId;
    } else {
      if (event.runId !== state.runId)
        throw new Error("Benchmark evidence mixes run ids");
      if (event.previousEventSha256 !== state.lastEventSha256)
        throw new Error("Benchmark evidence hash chain is invalid");
      const previous = state.events.at(-1)!;
      if (Date.parse(event.recordedAt) < Date.parse(previous.recordedAt))
        throw new Error("Benchmark evidence timestamps are non-monotonic");
    }
    if (state.status === "completed" || state.status === "cancelled")
      throw new Error("Benchmark evidence continues after a terminal event");
    if (state.status === "empty") state.status = "running";

    const payload = event.payload;
    if (payload.type === "run-started" && index !== 0)
      throw new Error("Benchmark run can only be started once");
    if (payload.type === "request-started") {
      const expected = state.pending[0];
      if (!expected || expected.requestId !== payload.requestId)
        throw new Error(
          "Benchmark request order differs from deterministic schedule",
        );
      const priorAttempts = state.events.filter(
        (item) =>
          item.payload.type === "request-started" &&
          item.payload.requestId === payload.requestId,
      ).length;
      if (payload.attempt !== priorAttempts + 1)
        throw new Error("Benchmark attempt number is non-contiguous");
      if (state.inFlight)
        throw new Error(
          "Benchmark evidence starts a request while one is in flight",
        );
      state.inFlight = { request: expected, attempt: payload.attempt };
      state.attempts += 1;
    }
    if (payload.type === "request-attempt-failed") {
      if (
        !state.inFlight ||
        state.inFlight.request.requestId !== payload.requestId ||
        state.inFlight.attempt !== payload.attempt
      )
        throw new Error(
          "Failed benchmark attempt has no matching in-flight request",
        );
      state.inFlight = undefined;
      state.currentRequestUsage.inputTokens += payload.inputTokens;
      state.currentRequestUsage.outputTokens += payload.outputTokens;
      state.currentRequestUsage.durationMs += payload.durationMs;
      state.currentRequestUsage.reportedCostUsd += payload.reportedCostUsd;
      state.inputTokens += payload.inputTokens;
      state.outputTokens += payload.outputTokens;
      state.durationMs += payload.durationMs;
      state.reportedCostUsd += payload.reportedCostUsd;
    }
    if (
      payload.type === "request-completed" ||
      payload.type === "request-recovered"
    ) {
      if (
        !state.inFlight ||
        state.inFlight.request.requestId !== payload.completion.requestId
      )
        throw new Error(
          "Benchmark completion has no matching in-flight request",
        );
      if (payload.completion.attempts !== state.inFlight.attempt)
        throw new Error(
          "Benchmark completion attempt count does not match evidence",
        );
      const used = state.currentRequestUsage;
      if (
        payload.completion.inputTokens < used.inputTokens ||
        payload.completion.outputTokens < used.outputTokens ||
        payload.completion.durationMs < used.durationMs ||
        payload.completion.reportedCostUsd + Number.EPSILON <
          used.reportedCostUsd
      )
        throw new Error(
          "Benchmark completion omits prior failed-attempt usage",
        );
      state.completions.push(payload.completion);
      state.pending.shift();
      state.inFlight = undefined;
      state.inputTokens += payload.completion.inputTokens - used.inputTokens;
      state.outputTokens += payload.completion.outputTokens - used.outputTokens;
      state.reportedCostUsd +=
        payload.completion.reportedCostUsd - used.reportedCostUsd;
      state.durationMs += payload.completion.durationMs - used.durationMs;
      state.currentRequestUsage = {
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
        reportedCostUsd: 0,
      };
    }
    if (payload.type === "run-paused") state.status = "paused";
    if (payload.type === "run-cancelled") state.status = "cancelled";
    if (payload.type === "run-completed") {
      if (state.pending.length || state.inFlight)
        throw new Error(
          "Benchmark run completed before its schedule was exhausted",
        );
      state.status = "completed";
    } else if (
      state.status === "paused" &&
      (payload.type === "request-started" ||
        payload.type === "request-attempt-failed" ||
        payload.type === "request-completed" ||
        payload.type === "request-recovered")
    ) {
      state.status = "running";
    }
    if (state.attempts > campaign.budget.maxRequests)
      throw new Error("Benchmark evidence exceeds its request ceiling");
    if (state.inputTokens > campaign.budget.maxInputTokens)
      throw new Error("Benchmark evidence exceeds its input-token ceiling");
    if (state.outputTokens > campaign.budget.maxOutputTokens)
      throw new Error("Benchmark evidence exceeds its output-token ceiling");
    if (state.reportedCostUsd > campaign.budget.maxCostUsd + Number.EPSILON)
      throw new Error("Benchmark evidence exceeds its cost ceiling");
    if (
      state.durationMs >
      schedule.length *
        campaign.trials.timeoutMsPerRequest *
        (campaign.trials.maxRetriesPerRequest + 1)
    )
      throw new Error("Benchmark evidence exceeds its time ceiling");
    state.events.push(event);
    state.lastEventSha256 = event.eventSha256;
  }
  return state;
}

export function createBenchmarkEvidenceEvent(
  campaignValue: BenchmarkCampaignV1,
  runId: string,
  existingEvents: readonly BenchmarkEvidenceEventV1[],
  payload: BenchmarkEvidencePayload,
  recordedAt = new Date().toISOString(),
): BenchmarkEvidenceEventV1 {
  const campaign = parseBenchmarkCampaign(campaignValue);
  assertIdentifier(runId, "Benchmark run id");
  assertTimestamp(recordedAt, "Benchmark evidence timestamp");
  const state = reduceBenchmarkEvidence(existingEvents, campaign);
  if (state.runId && state.runId !== runId)
    throw new Error("Benchmark evidence mixes run ids");
  const unsigned = {
    schemaVersion: 1 as const,
    evidenceVersion: BENCHMARK_EVIDENCE_VERSION,
    runId,
    campaignId: campaign.campaignId,
    campaignSha256: benchmarkCampaignSha256(campaign),
    scheduleSha256: benchmarkScheduleSha256(campaign),
    sequence: existingEvents.length,
    recordedAt,
    previousEventSha256: state.lastEventSha256 ?? null,
    payload,
  };
  const event: BenchmarkEvidenceEventV1 = {
    ...unsigned,
    eventSha256: benchmarkEvidenceEventSha256(unsigned),
  };
  reduceBenchmarkEvidence([...existingEvents, event], campaign);
  return event;
}

export async function readBenchmarkEvidenceLog(
  path: string,
  campaignValue: BenchmarkCampaignV1,
): Promise<BenchmarkEvidenceState> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return reduceBenchmarkEvidence([], campaignValue);
    throw error;
  }
  const lines = content.split("\n");
  if (lines.at(-1) !== "")
    throw new Error("Benchmark evidence log ends with an incomplete record");
  const values = lines
    .slice(0, -1)
    .filter((line) => line.length)
    .map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        throw new Error(`Benchmark evidence record ${index} is invalid JSON`);
      }
    });
  return reduceBenchmarkEvidence(values, campaignValue);
}

export async function appendBenchmarkEvidenceEvent(
  path: string,
  campaignValue: BenchmarkCampaignV1,
  runId: string,
  payload: BenchmarkEvidencePayload,
  recordedAt = new Date().toISOString(),
): Promise<BenchmarkEvidenceState> {
  return withFileLock(`${path}.lock`, async () => {
    const current = await readBenchmarkEvidenceLog(path, campaignValue);
    const event = createBenchmarkEvidenceEvent(
      campaignValue,
      runId,
      current.events,
      payload,
      recordedAt,
    );
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, "a", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(event)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return reduceBenchmarkEvidence([...current.events, event], campaignValue);
  });
}

export function buildInterruptedRecovery(
  state: BenchmarkEvidenceState,
  usage: {
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    reportedCostUsd: number;
  },
): BenchmarkEvidencePayload {
  if (!state.inFlight)
    throw new Error(
      "Benchmark recovery requires an interrupted in-flight request",
    );
  return {
    type: "request-recovered",
    resolution: "abandoned-unknown-provider-state",
    completion: {
      requestId: state.inFlight.request.requestId,
      outcome: "exhausted",
      attempts: state.inFlight.attempt,
      inputTokens: state.currentRequestUsage.inputTokens + usage.inputTokens,
      outputTokens: state.currentRequestUsage.outputTokens + usage.outputTokens,
      durationMs: state.currentRequestUsage.durationMs + usage.durationMs,
      reportedCostUsd:
        state.currentRequestUsage.reportedCostUsd + usage.reportedCostUsd,
      failureCode: "interrupted-provider-state-unknown",
    },
  };
}
