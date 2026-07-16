import { createHash } from "node:crypto";

export const BENCHMARK_PROTOCOL_VERSION = "loadout-evaluation-v1" as const;

export type BenchmarkCategory =
  | "workflow-adherence"
  | "code-review-coverage"
  | "documentation-retrieval"
  | "browser-test-planning";

export interface BenchmarkCandidateReference {
  role: "baseline" | "candidate";
  id: string;
  packageId: string;
  skillPath: string;
  reviewedCommit: string;
  instructionSha256: string;
}

export interface BenchmarkCampaignV1 {
  schemaVersion: 1;
  protocolVersion: typeof BENCHMARK_PROTOCOL_VERSION;
  campaignId: string;
  createdAt: string;
  category: BenchmarkCategory;
  fixture: {
    id: string;
    version: string;
    fixtureSha256: string;
    rubricSha256: string;
  };
  candidates: [BenchmarkCandidateReference, BenchmarkCandidateReference];
  model: {
    provider: string;
    model: string;
    version: string;
  };
  sampling: {
    temperature: number;
    topP: number;
    maxInputTokensPerRequest: number;
    maxOutputTokensPerRequest: number;
  };
  trials: {
    pairs: number;
    maxRetriesPerRequest: number;
    timeoutMsPerRequest: number;
  };
  randomization: {
    strategy: "paired-balanced-sha256-v1";
    seed: string;
    concealCandidateLabels: true;
  };
  isolation: {
    toolPolicy: "none";
    networkPolicy: "disabled";
    candidatePolicy: "instructions-as-data";
    fixturePolicy: "synthetic-only";
  };
  budget: {
    maxRequests: number;
    maxInputTokens: number;
    maxOutputTokens: number;
    maxCostUsd: number;
    inputUsdPerMillionTokens: number;
    outputUsdPerMillionTokens: number;
  };
  decision: {
    minimumSuccessfulPairs: number;
    minimumPracticalScoreDelta: number;
    promotionPolicy: "signed-evidence-plus-human-approval";
  };
}

export interface BenchmarkScheduledRequest {
  requestId: string;
  pairIndex: number;
  position: 1 | 2;
  role: "baseline" | "candidate";
  candidateId: string;
}

export interface BenchmarkBudgetPreview {
  protocolVersion: typeof BENCHMARK_PROTOCOL_VERSION;
  campaignId: string;
  campaignSha256: string;
  scheduledPairs: number;
  scheduledRequests: number;
  worstCaseRequests: number;
  worstCaseInputTokens: number;
  worstCaseOutputTokens: number;
  worstCaseCostUsd: number;
  withinBudget: boolean;
  blockers: string[];
  safetyBoundary: string;
}

export interface BenchmarkCampaignSummary {
  protocolVersion: typeof BENCHMARK_PROTOCOL_VERSION;
  campaignId: string;
  category: BenchmarkCategory;
  providerModel: string;
  baselineId: string;
  candidateId: string;
  pairs: number;
  scheduledRequests: number;
  baselineFirstPairs: number;
  candidateFirstPairs: number;
  campaignSha256: string;
  scheduleSha256: string;
  worstCaseRequests: number;
  worstCaseInputTokens: number;
  worstCaseOutputTokens: number;
  worstCaseCostUsd: number;
  withinBudget: boolean;
  blockers: string[];
}

export interface BenchmarkRunCompletion {
  requestId: string;
  outcome: "succeeded" | "exhausted";
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  reportedCostUsd: number;
  outputSha256?: string;
  failureCode?: string;
}

export interface BenchmarkRunV1 {
  schemaVersion: 1;
  protocolVersion: typeof BENCHMARK_PROTOCOL_VERSION;
  runId: string;
  campaignId: string;
  campaignSha256: string;
  scheduleSha256: string;
  createdAt: string;
  updatedAt: string;
  status: "planned" | "running" | "paused" | "completed" | "cancelled";
  completed: BenchmarkRunCompletion[];
  uncertainty: string;
  safetyBoundary: string;
}

const CATEGORIES = new Set<BenchmarkCategory>([
  "workflow-adherence",
  "code-review-coverage",
  "documentation-retrieval",
  "browser-test-planning",
]);
const ROLES = new Set(["baseline", "candidate"]);
const RUN_STATUSES = new Set([
  "planned",
  "running",
  "paused",
  "completed",
  "cancelled",
]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const PACKAGE_ID_PATTERN = /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  context: string,
): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length)
    throw new Error(`${context} has unknown field(s): ${unknown.join(", ")}`);
  const missing = keys.filter((key) => !(key in value));
  if (missing.length)
    throw new Error(`${context} is missing field(s): ${missing.join(", ")}`);
}

function identifier(value: unknown, context: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !ID_PATTERN.test(value) ||
    value.includes("..") ||
    value.includes("//")
  )
    throw new Error(`${context} is invalid`);
  if (/\b(?:sk-|api[_-]?key|bearer\s|token=|password=)/i.test(value))
    throw new Error(`${context} must not contain a credential value`);
}

function text(
  value: unknown,
  context: string,
  maximum = 256,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.length ||
    value !== value.trim() ||
    value.length > maximum
  )
    throw new Error(`${context} must be a non-empty, trimmed string`);
  if (/\b(?:sk-[A-Za-z0-9_-]{8,}|bearer\s+\S+|password\s*[=:])/i.test(value))
    throw new Error(`${context} must not contain a credential value`);
}

function timestamp(value: unknown, context: string): asserts value is string {
  text(value, context);
  let normalized: string;
  try {
    normalized = new Date(value).toISOString();
  } catch {
    throw new Error(`${context} must be an ISO-8601 UTC timestamp`);
  }
  if (normalized !== value)
    throw new Error(`${context} must be an ISO-8601 UTC timestamp`);
}

function finite(
  value: unknown,
  context: string,
  minimum = 0,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum)
    throw new Error(`${context} must be a finite number >= ${minimum}`);
}

function integer(
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

function sha256(value: unknown, context: string): asserts value is string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value))
    throw new Error(`${context} must be a lowercase SHA-256`);
}

function relativePath(
  value: unknown,
  context: string,
): asserts value is string {
  text(value, context, 512);
  if (
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes("\\") ||
    value.split("/").some((segment) => segment === "" || segment === "..")
  )
    throw new Error(`${context} must be a portable relative path`);
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Cannot hash a non-finite number");
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

function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function validateCandidate(
  value: unknown,
  index: number,
): BenchmarkCandidateReference {
  const context = `Benchmark candidate ${index + 1}`;
  if (!isRecord(value)) throw new Error(`${context} must be an object`);
  exactKeys(
    value,
    [
      "role",
      "id",
      "packageId",
      "skillPath",
      "reviewedCommit",
      "instructionSha256",
    ],
    context,
  );
  if (typeof value.role !== "string" || !ROLES.has(value.role))
    throw new Error(`${context}.role is invalid`);
  identifier(value.id, `${context}.id`);
  if (
    typeof value.packageId !== "string" ||
    !PACKAGE_ID_PATTERN.test(value.packageId)
  )
    throw new Error(`${context}.packageId is invalid`);
  relativePath(value.skillPath, `${context}.skillPath`);
  if (
    typeof value.reviewedCommit !== "string" ||
    !COMMIT_PATTERN.test(value.reviewedCommit)
  )
    throw new Error(
      `${context}.reviewedCommit must be a full lowercase Git commit`,
    );
  sha256(value.instructionSha256, `${context}.instructionSha256`);
  return value as unknown as BenchmarkCandidateReference;
}

export function parseBenchmarkCampaign(value: unknown): BenchmarkCampaignV1 {
  if (!isRecord(value)) throw new Error("Benchmark campaign must be an object");
  exactKeys(
    value,
    [
      "schemaVersion",
      "protocolVersion",
      "campaignId",
      "createdAt",
      "category",
      "fixture",
      "candidates",
      "model",
      "sampling",
      "trials",
      "randomization",
      "isolation",
      "budget",
      "decision",
    ],
    "Benchmark campaign",
  );
  if (
    value.schemaVersion !== 1 ||
    value.protocolVersion !== BENCHMARK_PROTOCOL_VERSION
  )
    throw new Error("Unsupported benchmark campaign version");
  identifier(value.campaignId, "Benchmark campaign id");
  timestamp(value.createdAt, "Benchmark campaign timestamp");
  if (
    typeof value.category !== "string" ||
    !CATEGORIES.has(value.category as BenchmarkCategory)
  )
    throw new Error("Benchmark campaign category is invalid");

  if (!isRecord(value.fixture))
    throw new Error("Benchmark fixture must be an object");
  exactKeys(
    value.fixture,
    ["id", "version", "fixtureSha256", "rubricSha256"],
    "Benchmark fixture",
  );
  identifier(value.fixture.id, "Benchmark fixture id");
  text(value.fixture.version, "Benchmark fixture version", 64);
  sha256(value.fixture.fixtureSha256, "Benchmark fixture SHA-256");
  sha256(value.fixture.rubricSha256, "Benchmark rubric SHA-256");

  if (!Array.isArray(value.candidates) || value.candidates.length !== 2)
    throw new Error("Benchmark campaign requires exactly two candidates");
  const candidates = value.candidates.map(validateCandidate);
  if (new Set(candidates.map((item) => item.role)).size !== 2)
    throw new Error("Benchmark campaign requires baseline and candidate roles");
  if (new Set(candidates.map((item) => item.id)).size !== 2)
    throw new Error("Benchmark candidate ids must be unique");

  if (!isRecord(value.model))
    throw new Error("Benchmark model must be an object");
  exactKeys(value.model, ["provider", "model", "version"], "Benchmark model");
  identifier(value.model.provider, "Benchmark provider");
  identifier(value.model.model, "Benchmark model id");
  text(value.model.version, "Benchmark model version", 128);

  if (!isRecord(value.sampling))
    throw new Error("Benchmark sampling must be an object");
  exactKeys(
    value.sampling,
    [
      "temperature",
      "topP",
      "maxInputTokensPerRequest",
      "maxOutputTokensPerRequest",
    ],
    "Benchmark sampling",
  );
  finite(value.sampling.temperature, "Benchmark temperature");
  if (value.sampling.temperature > 2)
    throw new Error("Benchmark temperature must be <= 2");
  finite(value.sampling.topP, "Benchmark topP");
  if (value.sampling.topP > 1) throw new Error("Benchmark topP must be <= 1");
  integer(
    value.sampling.maxInputTokensPerRequest,
    "Benchmark input token cap",
    1,
    2_000_000,
  );
  integer(
    value.sampling.maxOutputTokensPerRequest,
    "Benchmark output token cap",
    1,
    2_000_000,
  );

  if (!isRecord(value.trials))
    throw new Error("Benchmark trials must be an object");
  exactKeys(
    value.trials,
    ["pairs", "maxRetriesPerRequest", "timeoutMsPerRequest"],
    "Benchmark trials",
  );
  integer(value.trials.pairs, "Benchmark trial pairs", 5, 100);
  integer(value.trials.maxRetriesPerRequest, "Benchmark retry cap", 0, 3);
  integer(
    value.trials.timeoutMsPerRequest,
    "Benchmark request timeout",
    1_000,
    600_000,
  );

  if (!isRecord(value.randomization))
    throw new Error("Benchmark randomization must be an object");
  exactKeys(
    value.randomization,
    ["strategy", "seed", "concealCandidateLabels"],
    "Benchmark randomization",
  );
  if (value.randomization.strategy !== "paired-balanced-sha256-v1")
    throw new Error("Benchmark randomization strategy is invalid");
  sha256(value.randomization.seed, "Benchmark randomization seed");
  if (value.randomization.concealCandidateLabels !== true)
    throw new Error(
      "Benchmark candidate labels must be concealed from graders",
    );

  if (!isRecord(value.isolation))
    throw new Error("Benchmark isolation must be an object");
  exactKeys(
    value.isolation,
    ["toolPolicy", "networkPolicy", "candidatePolicy", "fixturePolicy"],
    "Benchmark isolation",
  );
  if (
    value.isolation.toolPolicy !== "none" ||
    value.isolation.networkPolicy !== "disabled" ||
    value.isolation.candidatePolicy !== "instructions-as-data" ||
    value.isolation.fixturePolicy !== "synthetic-only"
  )
    throw new Error(
      "Benchmark isolation must preserve the protocol safety boundary",
    );

  if (!isRecord(value.budget))
    throw new Error("Benchmark budget must be an object");
  exactKeys(
    value.budget,
    [
      "maxRequests",
      "maxInputTokens",
      "maxOutputTokens",
      "maxCostUsd",
      "inputUsdPerMillionTokens",
      "outputUsdPerMillionTokens",
    ],
    "Benchmark budget",
  );
  integer(value.budget.maxRequests, "Benchmark request budget", 1, 10_000);
  integer(
    value.budget.maxInputTokens,
    "Benchmark input token budget",
    1,
    1_000_000_000,
  );
  integer(
    value.budget.maxOutputTokens,
    "Benchmark output token budget",
    1,
    1_000_000_000,
  );
  finite(value.budget.maxCostUsd, "Benchmark cost budget");
  finite(value.budget.inputUsdPerMillionTokens, "Benchmark input price");
  finite(value.budget.outputUsdPerMillionTokens, "Benchmark output price");

  if (!isRecord(value.decision))
    throw new Error("Benchmark decision must be an object");
  exactKeys(
    value.decision,
    ["minimumSuccessfulPairs", "minimumPracticalScoreDelta", "promotionPolicy"],
    "Benchmark decision",
  );
  integer(
    value.decision.minimumSuccessfulPairs,
    "Minimum successful pairs",
    5,
    value.trials.pairs as number,
  );
  finite(
    value.decision.minimumPracticalScoreDelta,
    "Minimum practical score delta",
  );
  if (value.decision.minimumPracticalScoreDelta > 100)
    throw new Error("Minimum practical score delta must be <= 100");
  if (value.decision.promotionPolicy !== "signed-evidence-plus-human-approval")
    throw new Error("Benchmark promotion policy is invalid");

  return value as unknown as BenchmarkCampaignV1;
}

export function benchmarkCampaignSha256(campaign: BenchmarkCampaignV1): string {
  return hash(parseBenchmarkCampaign(campaign));
}

export function buildBenchmarkSchedule(
  campaignValue: BenchmarkCampaignV1,
): BenchmarkScheduledRequest[] {
  const campaign = parseBenchmarkCampaign(campaignValue);
  const campaignSha256 = benchmarkCampaignSha256(campaign);
  const byRole = new Map(campaign.candidates.map((item) => [item.role, item]));
  const schedule: BenchmarkScheduledRequest[] = [];
  for (let pairIndex = 0; pairIndex < campaign.trials.pairs; pairIndex++) {
    const digest = createHash("sha256")
      .update(
        `${campaign.randomization.seed}:${campaign.campaignId}:${pairIndex}`,
      )
      .digest();
    const roles: Array<"baseline" | "candidate"> =
      digest[0] % 2 === 0
        ? ["baseline", "candidate"]
        : ["candidate", "baseline"];
    for (const [offset, role] of roles.entries()) {
      const candidate = byRole.get(role)!;
      schedule.push({
        requestId: createHash("sha256")
          .update(`${campaignSha256}:${pairIndex}:${role}`)
          .digest("hex")
          .slice(0, 24),
        pairIndex,
        position: (offset + 1) as 1 | 2,
        role,
        candidateId: candidate.id,
      });
    }
  }
  return schedule;
}

export function benchmarkScheduleSha256(
  campaignValue: BenchmarkCampaignV1,
): string {
  return hash(buildBenchmarkSchedule(campaignValue));
}

function roundedUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function previewBenchmarkBudget(
  campaignValue: BenchmarkCampaignV1,
): BenchmarkBudgetPreview {
  const campaign = parseBenchmarkCampaign(campaignValue);
  const scheduledRequests = campaign.trials.pairs * 2;
  const worstCaseRequests =
    scheduledRequests * (1 + campaign.trials.maxRetriesPerRequest);
  const worstCaseInputTokens =
    worstCaseRequests * campaign.sampling.maxInputTokensPerRequest;
  const worstCaseOutputTokens =
    worstCaseRequests * campaign.sampling.maxOutputTokensPerRequest;
  const worstCaseCostUsd = roundedUsd(
    (worstCaseInputTokens / 1_000_000) *
      campaign.budget.inputUsdPerMillionTokens +
      (worstCaseOutputTokens / 1_000_000) *
        campaign.budget.outputUsdPerMillionTokens,
  );
  const blockers = [
    ...(worstCaseRequests > campaign.budget.maxRequests
      ? [
          `request ceiling ${worstCaseRequests} > ${campaign.budget.maxRequests}`,
        ]
      : []),
    ...(worstCaseInputTokens > campaign.budget.maxInputTokens
      ? [
          `input-token ceiling ${worstCaseInputTokens} > ${campaign.budget.maxInputTokens}`,
        ]
      : []),
    ...(worstCaseOutputTokens > campaign.budget.maxOutputTokens
      ? [
          `output-token ceiling ${worstCaseOutputTokens} > ${campaign.budget.maxOutputTokens}`,
        ]
      : []),
    ...(worstCaseCostUsd > campaign.budget.maxCostUsd
      ? [
          `cost ceiling $${worstCaseCostUsd.toFixed(6)} > $${campaign.budget.maxCostUsd.toFixed(6)}`,
        ]
      : []),
  ];
  return {
    protocolVersion: BENCHMARK_PROTOCOL_VERSION,
    campaignId: campaign.campaignId,
    campaignSha256: benchmarkCampaignSha256(campaign),
    scheduledPairs: campaign.trials.pairs,
    scheduledRequests,
    worstCaseRequests,
    worstCaseInputTokens,
    worstCaseOutputTokens,
    worstCaseCostUsd,
    withinBudget: blockers.length === 0,
    blockers,
    safetyBoundary:
      "Deterministic arithmetic only; no prompt, credential, project source, candidate content, provider request, or model execution occurred.",
  };
}

export function summarizeBenchmarkCampaign(
  campaignValue: BenchmarkCampaignV1,
): BenchmarkCampaignSummary {
  const campaign = parseBenchmarkCampaign(campaignValue);
  const schedule = buildBenchmarkSchedule(campaign);
  const preview = previewBenchmarkBudget(campaign);
  const byRole = new Map(campaign.candidates.map((item) => [item.role, item]));
  const firstPositions = schedule.filter((request) => request.position === 1);
  return {
    protocolVersion: BENCHMARK_PROTOCOL_VERSION,
    campaignId: campaign.campaignId,
    category: campaign.category,
    providerModel: `${campaign.model.provider}/${campaign.model.model}@${campaign.model.version}`,
    baselineId: byRole.get("baseline")!.id,
    candidateId: byRole.get("candidate")!.id,
    pairs: campaign.trials.pairs,
    scheduledRequests: schedule.length,
    baselineFirstPairs: firstPositions.filter(
      (request) => request.role === "baseline",
    ).length,
    candidateFirstPairs: firstPositions.filter(
      (request) => request.role === "candidate",
    ).length,
    campaignSha256: preview.campaignSha256,
    scheduleSha256: hash(schedule),
    worstCaseRequests: preview.worstCaseRequests,
    worstCaseInputTokens: preview.worstCaseInputTokens,
    worstCaseOutputTokens: preview.worstCaseOutputTokens,
    worstCaseCostUsd: preview.worstCaseCostUsd,
    withinBudget: preview.withinBudget,
    blockers: [...preview.blockers],
  };
}

export function formatBenchmarkCampaignSummary(
  campaignValue: BenchmarkCampaignV1,
): string {
  const summary = summarizeBenchmarkCampaign(campaignValue);
  const budget = summary.withinBudget
    ? "within declared ceilings"
    : `blocked: ${summary.blockers.join("; ")}`;
  return [
    `Campaign: ${summary.campaignId} (${summary.protocolVersion})`,
    `Scope: ${summary.category}; ${summary.baselineId} vs ${summary.candidateId}`,
    `Model: ${summary.providerModel}`,
    `Schedule: ${summary.pairs} pairs / ${summary.scheduledRequests} requests; first position ${summary.baselineFirstPairs} baseline, ${summary.candidateFirstPairs} candidate`,
    `Worst case: ${summary.worstCaseRequests} requests, ${summary.worstCaseInputTokens} input tokens, ${summary.worstCaseOutputTokens} output tokens, $${summary.worstCaseCostUsd.toFixed(6)}`,
    `Budget: ${budget}`,
    `Campaign SHA-256: ${summary.campaignSha256}`,
    `Schedule SHA-256: ${summary.scheduleSha256}`,
  ].join("\n");
}

export function createBenchmarkRun(
  campaignValue: BenchmarkCampaignV1,
  runId: string,
  createdAt = new Date().toISOString(),
): BenchmarkRunV1 {
  const campaign = parseBenchmarkCampaign(campaignValue);
  identifier(runId, "Benchmark run id");
  timestamp(createdAt, "Benchmark run timestamp");
  return {
    schemaVersion: 1,
    protocolVersion: BENCHMARK_PROTOCOL_VERSION,
    runId,
    campaignId: campaign.campaignId,
    campaignSha256: benchmarkCampaignSha256(campaign),
    scheduleSha256: benchmarkScheduleSha256(campaign),
    createdAt,
    updatedAt: createdAt,
    status: "planned",
    completed: [],
    uncertainty:
      "Planned benchmark only; no model output or comparative quality evidence exists yet.",
    safetyBoundary:
      "Run metadata contains hashes and bounded usage only; prompts, outputs, credentials, project source, and candidate executable content are excluded.",
  };
}

function validateCompletion(
  value: unknown,
  index: number,
  campaign: BenchmarkCampaignV1,
  requestIds: Set<string>,
): BenchmarkRunCompletion {
  const context = `Benchmark run completion ${index + 1}`;
  if (!isRecord(value)) throw new Error(`${context} must be an object`);
  const common = [
    "requestId",
    "outcome",
    "attempts",
    "inputTokens",
    "outputTokens",
    "durationMs",
    "reportedCostUsd",
  ];
  const outcome = value.outcome;
  exactKeys(
    value,
    outcome === "succeeded"
      ? [...common, "outputSha256"]
      : outcome === "exhausted"
        ? [...common, "failureCode"]
        : common,
    context,
  );
  if (typeof value.requestId !== "string" || !requestIds.has(value.requestId))
    throw new Error(
      `${context}.requestId is not in the deterministic schedule`,
    );
  if (outcome !== "succeeded" && outcome !== "exhausted")
    throw new Error(`${context}.outcome is invalid`);
  integer(
    value.attempts,
    `${context}.attempts`,
    1,
    1 + campaign.trials.maxRetriesPerRequest,
  );
  if (
    outcome === "exhausted" &&
    value.attempts !== 1 + campaign.trials.maxRetriesPerRequest
  )
    throw new Error(`${context} cannot be exhausted before its retry ceiling`);
  integer(
    value.inputTokens,
    `${context}.inputTokens`,
    0,
    (value.attempts as number) * campaign.sampling.maxInputTokensPerRequest,
  );
  integer(
    value.outputTokens,
    `${context}.outputTokens`,
    0,
    (value.attempts as number) * campaign.sampling.maxOutputTokensPerRequest,
  );
  finite(value.durationMs, `${context}.durationMs`);
  finite(value.reportedCostUsd, `${context}.reportedCostUsd`);
  if (outcome === "succeeded")
    sha256(value.outputSha256, `${context}.outputSha256`);
  else identifier(value.failureCode, `${context}.failureCode`);
  return value as unknown as BenchmarkRunCompletion;
}

export function parseBenchmarkRun(
  value: unknown,
  campaignValue: BenchmarkCampaignV1,
): BenchmarkRunV1 {
  const campaign = parseBenchmarkCampaign(campaignValue);
  if (!isRecord(value)) throw new Error("Benchmark run must be an object");
  exactKeys(
    value,
    [
      "schemaVersion",
      "protocolVersion",
      "runId",
      "campaignId",
      "campaignSha256",
      "scheduleSha256",
      "createdAt",
      "updatedAt",
      "status",
      "completed",
      "uncertainty",
      "safetyBoundary",
    ],
    "Benchmark run",
  );
  if (
    value.schemaVersion !== 1 ||
    value.protocolVersion !== BENCHMARK_PROTOCOL_VERSION
  )
    throw new Error("Unsupported benchmark run version");
  identifier(value.runId, "Benchmark run id");
  if (value.campaignId !== campaign.campaignId)
    throw new Error("Benchmark run names a different campaign");
  const campaignSha256 = benchmarkCampaignSha256(campaign);
  if (value.campaignSha256 !== campaignSha256)
    throw new Error("Benchmark run campaign hash is invalid");
  const schedule = buildBenchmarkSchedule(campaign);
  if (value.scheduleSha256 !== benchmarkScheduleSha256(campaign))
    throw new Error("Benchmark run schedule hash is invalid");
  timestamp(value.createdAt, "Benchmark run creation timestamp");
  timestamp(value.updatedAt, "Benchmark run update timestamp");
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt))
    throw new Error("Benchmark run update precedes creation");
  if (typeof value.status !== "string" || !RUN_STATUSES.has(value.status))
    throw new Error("Benchmark run status is invalid");
  if (!Array.isArray(value.completed))
    throw new Error("Benchmark run completed records must be an array");
  const requestIds = new Set(schedule.map((item) => item.requestId));
  const completed = value.completed.map((item, index) =>
    validateCompletion(item, index, campaign, requestIds),
  );
  if (
    new Set(completed.map((item) => item.requestId)).size !== completed.length
  )
    throw new Error("Benchmark run has duplicate completed request ids");
  if (value.status === "planned" && completed.length)
    throw new Error("A planned benchmark run cannot have completed requests");
  if (value.status === "completed" && completed.length !== schedule.length)
    throw new Error("A completed benchmark run must account for every request");
  if (
    completed.reduce((total, item) => total + item.attempts, 0) >
    campaign.budget.maxRequests
  )
    throw new Error("Benchmark run exceeds its request budget");
  if (
    completed.reduce((total, item) => total + item.inputTokens, 0) >
    campaign.budget.maxInputTokens
  )
    throw new Error("Benchmark run exceeds its input-token budget");
  if (
    completed.reduce((total, item) => total + item.outputTokens, 0) >
    campaign.budget.maxOutputTokens
  )
    throw new Error("Benchmark run exceeds its output-token budget");
  if (
    completed.reduce((total, item) => total + item.reportedCostUsd, 0) >
    campaign.budget.maxCostUsd
  )
    throw new Error("Benchmark run exceeds its cost budget");
  text(value.uncertainty, "Benchmark run uncertainty", 1_000);
  text(value.safetyBoundary, "Benchmark run safety boundary", 1_000);
  return value as unknown as BenchmarkRunV1;
}

export function pendingBenchmarkRequests(
  runValue: BenchmarkRunV1,
  campaignValue: BenchmarkCampaignV1,
): BenchmarkScheduledRequest[] {
  const campaign = parseBenchmarkCampaign(campaignValue);
  const run = parseBenchmarkRun(runValue, campaign);
  if (run.status === "completed" || run.status === "cancelled") return [];
  const completed = new Set(run.completed.map((item) => item.requestId));
  return buildBenchmarkSchedule(campaign).filter(
    (request) => !completed.has(request.requestId),
  );
}
