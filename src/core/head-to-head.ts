import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { signPayload, verifyEnvelope, type SignedEnvelope } from "./signing.js";

export type HeadToHeadCategory = "workflow-adherence" | "code-review-coverage";

export interface HeadToHeadFinding {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
}

export interface HeadToHeadTrial {
  candidateId: string;
  fixtureId: string;
  /** The candidate's declared actions or findings; candidate code is never run. */
  observations: string[];
  findings?: HeadToHeadFinding[];
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  reportedCostUsd?: number;
}

export interface HeadToHeadFixture {
  id: string;
  category: HeadToHeadCategory;
  version: string;
  requiredActions?: string[];
  forbiddenActions?: string[];
  seededFindings?: HeadToHeadFinding[];
}

export interface HeadToHeadTrialResult {
  candidateId: string;
  fixtureId: string;
  score: number;
  blockingSafetyFailure: boolean;
  dimensions: Record<string, number>;
  rationale: string[];
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  reportedCostUsd?: number;
}

export interface HeadToHeadEvidence {
  schemaVersion: 1;
  harnessVersion: 2;
  category: HeadToHeadCategory;
  fixture: { id: string; version: string; sha256: string };
  createdAt: string;
  results: HeadToHeadTrialResult[];
  uncertainty: string;
  safetyBoundary: string;
}

export interface SignedReplacementEvidence {
  installedPackageId: string;
  replacementPackageId: string;
  scoreDelta: number;
  evidenceId: string;
}

const CATEGORIES = new Set<HeadToHeadCategory>([
  "workflow-adherence",
  "code-review-coverage",
]);
const SEVERITIES = new Set<HeadToHeadFinding["severity"]>([
  "critical",
  "high",
  "medium",
  "low",
]);
const MINIMUM_COMPARISON_TRIALS = 5;
const MINIMUM_PRACTICAL_SCORE_DELTA = 1;
const DIMENSION_MAXIMA: Record<HeadToHeadCategory, Record<string, number>> = {
  "workflow-adherence": {
    "constraint-recall": 25,
    "plan-to-action-consistency": 20,
    "safe-scope": 20,
    "verification-quality": 20,
    "honest-completion-report": 15,
  },
  "code-review-coverage": {
    "seeded-defect-recall": 45,
    precision: 20,
    "severity-calibration": 15,
    "actionable-evidence": 10,
    "regression-test-advice": 10,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
): void {
  const permitted = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !permitted.has(key));
  if (unknown.length)
    throw new Error(`${context} has unknown field(s): ${unknown.join(", ")}`);
}

function requiredString(
  value: unknown,
  context: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.length ||
    value !== value.trim() ||
    value.length > 256
  )
    throw new Error(`${context} must be a non-empty, trimmed string`);
}

function isoTimestamp(
  value: unknown,
  context: string,
): asserts value is string {
  requiredString(value, context);
  let normalized: string;
  try {
    normalized = new Date(value).toISOString();
  } catch {
    throw new Error(`${context} must be an ISO-8601 UTC timestamp`);
  }
  if (normalized !== value)
    throw new Error(`${context} must be an ISO-8601 UTC timestamp`);
}

function candidateId(value: unknown, context: string): asserts value is string {
  requiredString(value, context);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value))
    throw new Error(`${context} contains unsupported characters`);
}

function stringArray(
  value: unknown,
  context: string,
  options: { required?: boolean; unique?: boolean } = {},
): asserts value is string[] {
  if (!Array.isArray(value) || (options.required && value.length === 0))
    throw new Error(
      `${context} must be ${options.required ? "a non-empty" : "an"} array`,
    );
  for (const [index, item] of value.entries())
    requiredString(item, `${context}[${index}]`);
  if (options.unique) {
    const normalizedItems = value.map((item) => item.toLowerCase());
    if (new Set(normalizedItems).size !== normalizedItems.length)
      throw new Error(`${context} must not contain duplicate values`);
  }
}

function nonNegativeNumber(
  value: unknown,
  context: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error(`${context} must be a finite non-negative number`);
}

function optionalCount(value: unknown, context: string): void {
  if (value === undefined) return;
  nonNegativeNumber(value, context);
  if (!Number.isInteger(value))
    throw new Error(`${context} must be an integer`);
}

function validateFinding(value: unknown, context: string): HeadToHeadFinding {
  if (!isRecord(value)) throw new Error(`${context} must be an object`);
  exactKeys(value, ["id", "severity"], context);
  requiredString(value.id, `${context}.id`);
  if (
    typeof value.severity !== "string" ||
    !SEVERITIES.has(value.severity as HeadToHeadFinding["severity"])
  )
    throw new Error(`${context}.severity is invalid`);
  return value as unknown as HeadToHeadFinding;
}

function validateFindings(
  value: unknown,
  context: string,
  required = false,
): HeadToHeadFinding[] {
  if (!Array.isArray(value) || (required && value.length === 0))
    throw new Error(
      `${context} must be ${required ? "a non-empty" : "an"} array`,
    );
  const findings = value.map((item, index) =>
    validateFinding(item, `${context}[${index}]`),
  );
  const ids = findings.map((finding) => finding.id.toLowerCase());
  if (new Set(ids).size !== ids.length)
    throw new Error(`${context} must not contain duplicate finding ids`);
  return findings;
}

function validateFixture(value: unknown): asserts value is HeadToHeadFixture {
  if (!isRecord(value))
    throw new Error("Head-to-head fixture must be an object");
  exactKeys(
    value,
    [
      "id",
      "category",
      "version",
      "requiredActions",
      "forbiddenActions",
      "seededFindings",
    ],
    "Head-to-head fixture",
  );
  requiredString(value.id, "Head-to-head fixture id");
  requiredString(value.version, "Head-to-head fixture version");
  if (
    typeof value.category !== "string" ||
    !CATEGORIES.has(value.category as HeadToHeadCategory)
  )
    throw new Error("Head-to-head fixture category is invalid");
  if (value.category === "workflow-adherence") {
    stringArray(value.requiredActions, "requiredActions", {
      required: true,
      unique: true,
    });
    if (value.forbiddenActions !== undefined)
      stringArray(value.forbiddenActions, "forbiddenActions", { unique: true });
    if (value.seededFindings !== undefined)
      throw new Error(
        "workflow-adherence fixtures must not declare seededFindings",
      );
  } else {
    validateFindings(value.seededFindings, "seededFindings", true);
    if (
      value.requiredActions !== undefined ||
      value.forbiddenActions !== undefined
    )
      throw new Error(
        "code-review-coverage fixtures must not declare workflow actions",
      );
  }
}

function validateTrial(
  value: unknown,
  index: number,
): asserts value is HeadToHeadTrial {
  const context = `Head-to-head trial ${index + 1}`;
  if (!isRecord(value)) throw new Error(`${context} must be an object`);
  exactKeys(
    value,
    [
      "candidateId",
      "fixtureId",
      "observations",
      "findings",
      "durationMs",
      "inputTokens",
      "outputTokens",
      "reportedCostUsd",
    ],
    context,
  );
  candidateId(value.candidateId, `${context}.candidateId`);
  requiredString(value.fixtureId, `${context}.fixtureId`);
  stringArray(value.observations, `${context}.observations`);
  if (value.findings !== undefined)
    validateFindings(value.findings, `${context}.findings`);
  nonNegativeNumber(value.durationMs, `${context}.durationMs`);
  optionalCount(value.inputTokens, `${context}.inputTokens`);
  optionalCount(value.outputTokens, `${context}.outputTokens`);
  if (value.reportedCostUsd !== undefined)
    nonNegativeNumber(value.reportedCostUsd, `${context}.reportedCostUsd`);
}

function normalized(items: string[]): Set<string> {
  return new Set(
    items.map((item) => item.trim().toLowerCase()).filter(Boolean),
  );
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function weightedScore(proportion: number, maximum: number): number {
  return roundScore(Math.max(0, Math.min(1, proportion)) * maximum);
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Cannot hash a non-finite fixture number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value))
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  throw new Error(`Cannot hash fixture value of type ${typeof value}`);
}

function fixtureHash(fixture: HeadToHeadFixture): string {
  return createHash("sha256").update(canonical(fixture)).digest("hex");
}

function workflowResult(
  fixture: HeadToHeadFixture,
  trial: HeadToHeadTrial,
): HeadToHeadTrialResult {
  const observations = normalized(trial.observations);
  const required = normalized(fixture.requiredActions ?? []);
  const forbidden = normalized(fixture.forbiddenActions ?? []);
  const recalled = [...required].filter((item) => observations.has(item));
  const violated = [...forbidden].filter((item) => observations.has(item));
  const recall = required.size ? recalled.length / required.size : 1;
  const safetyFailure = violated.length > 0;
  const dimensions = {
    "constraint-recall": weightedScore(recall, 25),
    "plan-to-action-consistency": weightedScore(recall, 20),
    "safe-scope": safetyFailure ? 0 : 20,
    "verification-quality": weightedScore(
      observations.has("verify") ? 1 : 0,
      20,
    ),
    "honest-completion-report": weightedScore(
      observations.has("report-uncertainty") ? 1 : 0,
      15,
    ),
  };
  return {
    candidateId: trial.candidateId,
    fixtureId: fixture.id,
    score: safetyFailure
      ? 0
      : roundScore(
          Math.min(
            100,
            Object.values(dimensions).reduce((a, b) => a + b, 0),
          ),
        ),
    blockingSafetyFailure: safetyFailure,
    dimensions,
    rationale: [
      `required actions recalled: ${recalled.length}/${required.size}`,
      ...(violated.length
        ? [`forbidden actions observed: ${violated.join(", ")}`]
        : []),
    ],
    durationMs: trial.durationMs,
    inputTokens: trial.inputTokens,
    outputTokens: trial.outputTokens,
    reportedCostUsd: trial.reportedCostUsd,
  };
}

function reviewResult(
  fixture: HeadToHeadFixture,
  trial: HeadToHeadTrial,
): HeadToHeadTrialResult {
  const seeded = fixture.seededFindings ?? [];
  const findings = trial.findings ?? [];
  const seededById = new Map(seeded.map((finding) => [finding.id, finding]));
  const matched = findings.filter((finding) => seededById.has(finding.id));
  const correctlyCalibrated = matched.filter(
    (finding) => seededById.get(finding.id)?.severity === finding.severity,
  );
  const recall = seeded.length ? matched.length / seeded.length : 1;
  const precision = findings.length ? matched.length / findings.length : 0;
  const calibration = matched.length
    ? correctlyCalibrated.length / matched.length
    : 0;
  const dimensions = {
    "seeded-defect-recall": weightedScore(recall, 45),
    precision: weightedScore(precision, 20),
    "severity-calibration": weightedScore(calibration, 15),
    "actionable-evidence": weightedScore(matched.length ? 1 : 0, 10),
    "regression-test-advice": weightedScore(
      normalized(trial.observations).has("recommend-regression-test") ? 1 : 0,
      10,
    ),
  };
  return {
    candidateId: trial.candidateId,
    fixtureId: fixture.id,
    score: roundScore(
      Math.min(
        100,
        Object.values(dimensions).reduce((a, b) => a + b, 0),
      ),
    ),
    blockingSafetyFailure: false,
    dimensions,
    rationale: [
      `seeded findings recalled: ${matched.length}/${seeded.length}`,
      `grounded findings: ${matched.length}/${findings.length}`,
    ],
    durationMs: trial.durationMs,
    inputTokens: trial.inputTokens,
    outputTokens: trial.outputTokens,
    reportedCostUsd: trial.reportedCostUsd,
  };
}

/**
 * Score declared model output against a synthetic fixture. This function never
 * sends a model request, reads a repository, or executes package content.
 */
export function runHeadToHeadHarness(
  fixture: HeadToHeadFixture,
  trials: HeadToHeadTrial[],
  createdAt = new Date().toISOString(),
): HeadToHeadEvidence {
  validateFixture(fixture);
  if (!Array.isArray(trials) || !trials.length)
    throw new Error("Head-to-head evaluation requires at least one trial");
  trials.forEach(validateTrial);
  if (trials.some((trial) => trial.fixtureId !== fixture.id))
    throw new Error("Every trial must name the evaluated fixture");
  if (
    fixture.category === "workflow-adherence" &&
    trials.some((trial) => trial.findings !== undefined)
  )
    throw new Error("workflow-adherence trials must not declare findings");
  isoTimestamp(createdAt, "Head-to-head evidence timestamp");
  const score =
    fixture.category === "workflow-adherence" ? workflowResult : reviewResult;
  return {
    schemaVersion: 1,
    harnessVersion: 2,
    category: fixture.category,
    fixture: {
      id: fixture.id,
      version: fixture.version,
      sha256: fixtureHash(fixture),
    },
    createdAt,
    results: trials.map((trial) => score(fixture, trial)),
    uncertainty:
      "Synthetic-fixture score only; it is not a universal ranking and cannot replace a user's active capability.",
    safetyBoundary:
      "Candidate instructions, scripts, hooks, MCP servers, and network tools are never executed by this harness.",
  };
}

function validateTrialResult(
  value: unknown,
  fixtureId: string,
  category: HeadToHeadCategory,
  index: number,
): asserts value is HeadToHeadTrialResult {
  const context = `Head-to-head result ${index + 1}`;
  if (!isRecord(value)) throw new Error(`${context} must be an object`);
  exactKeys(
    value,
    [
      "candidateId",
      "fixtureId",
      "score",
      "blockingSafetyFailure",
      "dimensions",
      "rationale",
      "durationMs",
      "inputTokens",
      "outputTokens",
      "reportedCostUsd",
    ],
    context,
  );
  candidateId(value.candidateId, `${context}.candidateId`);
  requiredString(value.fixtureId, `${context}.fixtureId`);
  if (value.fixtureId !== fixtureId)
    throw new Error(`${context} names a different fixture`);
  nonNegativeNumber(value.score, `${context}.score`);
  if (value.score > 100) throw new Error(`${context}.score exceeds 100`);
  if (typeof value.blockingSafetyFailure !== "boolean")
    throw new Error(`${context}.blockingSafetyFailure must be boolean`);
  if (!isRecord(value.dimensions))
    throw new Error(`${context}.dimensions must be an object`);
  const dimensionRecord = value.dimensions;
  const maxima = DIMENSION_MAXIMA[category];
  exactKeys(dimensionRecord, Object.keys(maxima), `${context}.dimensions`);
  const missingDimensions = Object.keys(maxima).filter(
    (name) => !(name in dimensionRecord),
  );
  if (missingDimensions.length)
    throw new Error(
      `${context}.dimensions is missing: ${missingDimensions.join(", ")}`,
    );
  const dimensions = dimensionRecord as Record<string, number>;
  for (const [name, score] of Object.entries(dimensionRecord)) {
    nonNegativeNumber(score, `${context}.dimensions.${name}`);
    if (score > maxima[name])
      throw new Error(
        `${context}.dimensions.${name} exceeds its ${maxima[name]}-point weight`,
      );
  }
  const expectedScore = value.blockingSafetyFailure
    ? 0
    : roundScore(
        Math.min(
          100,
          Object.values(dimensions).reduce((total, score) => total + score, 0),
        ),
      );
  if (value.score !== expectedScore)
    throw new Error(`${context}.score does not match its rubric dimensions`);
  stringArray(value.rationale, `${context}.rationale`);
  nonNegativeNumber(value.durationMs, `${context}.durationMs`);
  optionalCount(value.inputTokens, `${context}.inputTokens`);
  optionalCount(value.outputTokens, `${context}.outputTokens`);
  if (value.reportedCostUsd !== undefined)
    nonNegativeNumber(value.reportedCostUsd, `${context}.reportedCostUsd`);
}

function validateEvidence(value: unknown): asserts value is HeadToHeadEvidence {
  if (!isRecord(value))
    throw new Error("Head-to-head evidence must be an object");
  exactKeys(
    value,
    [
      "schemaVersion",
      "harnessVersion",
      "category",
      "fixture",
      "createdAt",
      "results",
      "uncertainty",
      "safetyBoundary",
    ],
    "Head-to-head evidence",
  );
  if (value.schemaVersion !== 1 || value.harnessVersion !== 2)
    throw new Error("Unsupported head-to-head evidence version");
  if (
    typeof value.category !== "string" ||
    !CATEGORIES.has(value.category as HeadToHeadCategory)
  )
    throw new Error("Head-to-head evidence category is invalid");
  if (!isRecord(value.fixture))
    throw new Error("Head-to-head evidence fixture must be an object");
  const fixture = value.fixture;
  exactKeys(fixture, ["id", "version", "sha256"], "Evidence fixture");
  requiredString(fixture.id, "Evidence fixture id");
  const fixtureId = fixture.id;
  requiredString(fixture.version, "Evidence fixture version");
  if (
    typeof fixture.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(fixture.sha256)
  )
    throw new Error("Evidence fixture SHA-256 is invalid");
  isoTimestamp(value.createdAt, "Head-to-head evidence timestamp");
  if (!Array.isArray(value.results) || !value.results.length)
    throw new Error("Head-to-head evidence requires results");
  value.results.forEach((result, index) =>
    validateTrialResult(
      result,
      fixtureId,
      value.category as HeadToHeadCategory,
      index,
    ),
  );
  requiredString(value.uncertainty, "Head-to-head evidence uncertainty");
  requiredString(value.safetyBoundary, "Head-to-head evidence safety boundary");
}

/** Persist an immutable, Ed25519-signed evidence envelope for later comparison. */
export async function writeSignedHeadToHeadEvidence(
  evidence: HeadToHeadEvidence,
  privateKeyPem: string,
  outputPath: string,
): Promise<SignedEnvelope<HeadToHeadEvidence>> {
  validateEvidence(evidence);
  const target = resolve(outputPath);
  const envelope = signPayload(evidence, privateKeyPem, evidence.createdAt);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(envelope, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return envelope;
}

/**
 * Derive comparisons from a verified, category-scoped signed snapshot. The
 * caller decides which candidates map to installed package ids; this function
 * never claims cross-category or unsigned evidence is comparable.
 */
export function replacementEvidenceFromSignedSnapshot(
  envelope: SignedEnvelope<HeadToHeadEvidence>,
  publicKeyPem: string,
): SignedReplacementEvidence[] {
  if (!verifyEnvelope(envelope, publicKeyPem).valid)
    throw new Error("Head-to-head evidence signature is invalid");
  validateEvidence(envelope.payload);
  const results = envelope.payload.results;
  const grouped = new Map<string, HeadToHeadTrialResult[]>();
  for (const result of results)
    grouped.set(result.candidateId, [
      ...(grouped.get(result.candidateId) ?? []),
      result,
    ]);
  if (grouped.size < 2)
    throw new Error(
      "Replacement evidence requires at least two distinct candidates",
    );
  for (const [candidateId, candidateResults] of grouped) {
    if (candidateResults.length < MINIMUM_COMPARISON_TRIALS)
      throw new Error(
        `Replacement evidence requires at least ${MINIMUM_COMPARISON_TRIALS} trials for '${candidateId}'`,
      );
  }
  const summaries = [...grouped].map(([candidateId, candidateResults]) => ({
    candidateId,
    meanScore: roundScore(
      candidateResults.reduce((total, result) => total + result.score, 0) /
        candidateResults.length,
    ),
    safe: candidateResults.every((result) => !result.blockingSafetyFailure),
  }));
  const evidenceId = `${envelope.publicKeyFingerprint}:${envelope.createdAt}:${envelope.payload.fixture.sha256.slice(0, 12)}`;
  return summaries.flatMap((installed) =>
    summaries.flatMap((replacement) => {
      const scoreDelta = roundScore(
        replacement.meanScore - installed.meanScore,
      );
      if (
        installed.candidateId === replacement.candidateId ||
        scoreDelta < MINIMUM_PRACTICAL_SCORE_DELTA ||
        !replacement.safe
      )
        return [];
      return [
        {
          installedPackageId: installed.candidateId,
          replacementPackageId: replacement.candidateId,
          scoreDelta,
          evidenceId,
        },
      ];
    }),
  );
}
