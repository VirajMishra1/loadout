import { createHash, createPublicKey } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  benchmarkCampaignSha256,
  buildBenchmarkSchedule,
  parseBenchmarkCampaign,
  type BenchmarkCampaignV1,
} from "./benchmark-campaign.js";
import {
  reduceBenchmarkEvidence,
  type BenchmarkEvidenceEventV1,
} from "./benchmark-evidence.js";
import { signPayload, verifyEnvelope, type SignedEnvelope } from "./signing.js";
import type { CatalogPackage } from "../shared/types.js";

export const BENCHMARK_TRUST_EVIDENCE_VERSION =
  "loadout-benchmark-trust-evidence-v1" as const;
export const TRUST_DECISION_POLICY_VERSION =
  "loadout-trust-decision-v1" as const;

export interface BenchmarkJudgmentV1 {
  requestId: string;
  outputSha256: string;
  score: number;
  blockingSafetyFailure: boolean;
}

export interface BenchmarkTrustSummaryV1 {
  taskFamily: BenchmarkCampaignV1["category"];
  successfulPairs: number;
  requiredSuccessfulPairs: number;
  baselineMeanScore: number;
  candidateMeanScore: number;
  scoreDelta: number;
  minimumPracticalScoreDelta: number;
  candidateBlockingSafetyFailures: number;
  protocolConformant: boolean;
  meaningfulGain: boolean;
  unacceptableRegression: boolean;
}

/**
 * Self-contained evidence: a verifier can replay the protocol state machine,
 * match every judgment to an output hash, and recompute the summary.
 */
export interface BenchmarkTrustEvidenceV1 {
  schemaVersion: 1;
  evidenceVersion: typeof BENCHMARK_TRUST_EVIDENCE_VERSION;
  createdAt: string;
  campaign: BenchmarkCampaignV1;
  events: BenchmarkEvidenceEventV1[];
  judgments: BenchmarkJudgmentV1[];
  summary: BenchmarkTrustSummaryV1;
  boundary: string;
}

export type TrustQualityStatus =
  "unbenchmarked" | "benchmarked" | "recommended";

export interface HumanTrustReviewV1 {
  attestation: "human-reviewed";
  reviewId: string;
  reviewedBy: string;
  reviewedAt: string;
  packageId: string;
  reviewedCommit: string;
  licenseDecision: "approved" | "rejected";
  trustDecision: "approved" | "rejected";
  reviewEvidenceSha256: string;
}

export interface SecurityReviewSummaryV1 {
  scannerVersion: string;
  scannedCommit: string;
  blockingFindingIds: string[];
  warningFindingIds: string[];
}

export interface BenchmarkEvidenceReferenceV1 {
  evidenceSha256: string;
  publicKeyFingerprint: string;
  createdAt: string;
  campaignId: string;
  campaignSha256: string;
  runId: string;
  packageId: string;
  reviewedCommit: string;
  instructionSha256: string;
  taskFamily: BenchmarkCampaignV1["category"];
  successfulPairs: number;
  requiredSuccessfulPairs: number;
  scoreDelta: number;
  minimumPracticalScoreDelta: number;
  protocolConformant: boolean;
  meaningfulGain: boolean;
  unacceptableRegression: boolean;
}

export interface TrustDecisionMetricsV1 {
  signedEvidenceRecords: number;
  conformantEvidenceRecords: number;
  taskFamiliesWithMeaningfulGain: number;
  unacceptableRegressions: number;
  blockingSecurityFindings: number;
  missingEvidenceContribution: 0;
}

export interface TrustDecisionRecordV1 {
  schemaVersion: 1;
  policyVersion: typeof TRUST_DECISION_POLICY_VERSION;
  decisionId: string;
  sequence: number;
  createdAt: string;
  packageId: string;
  reviewedCommit: string;
  instructionSha256: string;
  status: TrustQualityStatus;
  transition: string;
  previousDecisionSha256: string | null;
  currentEvidence: BenchmarkEvidenceReferenceV1[];
  retainedEvidence: BenchmarkEvidenceReferenceV1[];
  humanReview: HumanTrustReviewV1 | null;
  security: SecurityReviewSummaryV1;
  metrics: TrustDecisionMetricsV1;
  reasons: string[];
  policyBoundary: string;
}

export interface TrustedBenchmarkEvidenceInput {
  envelope: SignedEnvelope<BenchmarkTrustEvidenceV1>;
  publicKeyPem: string;
}

export interface CatalogTrustCoverageItemV1 {
  packageId: string;
  catalogCommit: string | null;
  status: TrustQualityStatus;
  decisionId: string | null;
  decisionCommit: string | null;
  transition: string;
  retainedEvidenceSha256: string[];
  explanation: string[];
}

export interface CatalogTrustCoverageV1 {
  schemaVersion: 1;
  policyVersion: typeof TRUST_DECISION_POLICY_VERSION;
  packages: CatalogTrustCoverageItemV1[];
  counts: Record<TrustQualityStatus, number>;
  policyBoundary: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const PACKAGE_ID = /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/;
const TASK_FAMILIES = new Set<BenchmarkCampaignV1["category"]>([
  "workflow-adherence",
  "code-review-coverage",
  "documentation-retrieval",
  "browser-test-planning",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  context: string,
): void {
  const allowed = new Set(expected);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length)
    throw new Error(`${context} has unknown field(s): ${unknown.join(", ")}`);
  const missing = expected.filter((key) => !(key in value));
  if (missing.length)
    throw new Error(`${context} is missing field(s): ${missing.join(", ")}`);
}

function text(value: unknown, context: string, maximum = 256): string {
  if (
    typeof value !== "string" ||
    !value.length ||
    value !== value.trim() ||
    value.length > maximum ||
    /(?:sk-[A-Za-z0-9_-]{8,}|bearer\s+\S+|password\s*[=:])/i.test(value)
  )
    throw new Error(`${context} must be non-sensitive, trimmed text`);
  return value;
}

function identifier(value: unknown, context: string): string {
  const result = text(value, context, 128);
  if (!ID.test(result) || result.includes("..") || result.includes("//"))
    throw new Error(`${context} is invalid`);
  return result;
}

function packageId(value: unknown, context: string): string {
  if (typeof value !== "string" || !PACKAGE_ID.test(value))
    throw new Error(`${context} is invalid`);
  return value;
}

function sha256(value: unknown, context: string): string {
  if (typeof value !== "string" || !SHA256.test(value))
    throw new Error(`${context} must be a lowercase SHA-256`);
  return value;
}

function commit(value: unknown, context: string): string {
  if (typeof value !== "string" || !COMMIT.test(value))
    throw new Error(`${context} must be a full lowercase Git commit`);
  return value;
}

function timestamp(value: unknown, context: string): string {
  const result = text(value, context, 64);
  let normalized: string;
  try {
    normalized = new Date(result).toISOString();
  } catch {
    throw new Error(`${context} must be an ISO-8601 UTC timestamp`);
  }
  if (normalized !== result)
    throw new Error(`${context} must be an ISO-8601 UTC timestamp`);
  return result;
}

function boundedNumber(
  value: unknown,
  context: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  )
    throw new Error(`${context} must be from ${minimum} to ${maximum}`);
  return value;
}

function integer(
  value: unknown,
  context: string,
  minimum: number,
  maximum: number,
): number {
  const result = boundedNumber(value, context, minimum, maximum);
  if (!Number.isInteger(result))
    throw new Error(`${context} must be an integer`);
  return result;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot hash non-finite data");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value))
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  throw new Error(`Cannot hash value of type ${typeof value}`);
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseJudgments(value: unknown): BenchmarkJudgmentV1[] {
  if (!Array.isArray(value))
    throw new Error("Benchmark judgments must be an array");
  const result = value.map((entry, index) => {
    const context = `Benchmark judgment ${index + 1}`;
    if (!isRecord(entry)) throw new Error(`${context} must be an object`);
    exactKeys(
      entry,
      ["requestId", "outputSha256", "score", "blockingSafetyFailure"],
      context,
    );
    const requestId = identifier(entry.requestId, `${context}.requestId`);
    const outputSha256 = sha256(entry.outputSha256, `${context}.outputSha256`);
    const score = boundedNumber(entry.score, `${context}.score`, 0, 100);
    if (rounded(score) !== score)
      throw new Error(`${context}.score supports at most two decimals`);
    if (typeof entry.blockingSafetyFailure !== "boolean")
      throw new Error(`${context}.blockingSafetyFailure must be boolean`);
    if (entry.blockingSafetyFailure && score !== 0)
      throw new Error(
        `${context} with a blocking safety failure must score zero`,
      );
    return {
      requestId,
      outputSha256,
      score,
      blockingSafetyFailure: entry.blockingSafetyFailure,
    };
  });
  if (new Set(result.map((item) => item.requestId)).size !== result.length)
    throw new Error("Benchmark judgments must have unique request ids");
  return result;
}

function computeTrustEvidence(
  campaignValue: unknown,
  eventValues: readonly unknown[],
  judgmentValues: unknown,
  createdAtValue: unknown,
): BenchmarkTrustEvidenceV1 {
  const campaign = parseBenchmarkCampaign(campaignValue);
  const state = reduceBenchmarkEvidence(eventValues, campaign);
  const judgments = parseJudgments(judgmentValues);
  const createdAt = timestamp(createdAtValue, "Trust evidence timestamp");
  const schedule = buildBenchmarkSchedule(campaign);
  const scheduled = new Map(
    schedule.map((request) => [request.requestId, request]),
  );
  const completions = new Map(
    state.completions.map((completion) => [completion.requestId, completion]),
  );
  const judgmentByRequest = new Map(
    judgments.map((judgment) => [judgment.requestId, judgment]),
  );
  for (const judgment of judgments) {
    const request = scheduled.get(judgment.requestId);
    const completion = completions.get(judgment.requestId);
    if (!request || !completion || completion.outcome !== "succeeded")
      throw new Error(
        "Benchmark judgment has no successful scheduled completion",
      );
    if (completion.outputSha256 !== judgment.outputSha256)
      throw new Error(
        "Benchmark judgment output hash does not match completion",
      );
  }

  const paired: Array<{
    baseline: BenchmarkJudgmentV1;
    candidate: BenchmarkJudgmentV1;
  }> = [];
  for (let pairIndex = 0; pairIndex < campaign.trials.pairs; pairIndex++) {
    const requests = schedule.filter(
      (request) => request.pairIndex === pairIndex,
    );
    const baselineRequest = requests.find(
      (request) => request.role === "baseline",
    );
    const candidateRequest = requests.find(
      (request) => request.role === "candidate",
    );
    const baseline = baselineRequest
      ? judgmentByRequest.get(baselineRequest.requestId)
      : undefined;
    const candidate = candidateRequest
      ? judgmentByRequest.get(candidateRequest.requestId)
      : undefined;
    if (baseline && candidate) paired.push({ baseline, candidate });
  }
  const mean = (
    rows: Array<{
      baseline: BenchmarkJudgmentV1;
      candidate: BenchmarkJudgmentV1;
    }>,
    role: "baseline" | "candidate",
  ): number =>
    rows.length
      ? rounded(
          rows.reduce((total, row) => total + row[role].score, 0) / rows.length,
        )
      : 0;
  const baselineMeanScore = mean(paired, "baseline");
  const candidateMeanScore = mean(paired, "candidate");
  const scoreDelta = rounded(candidateMeanScore - baselineMeanScore);
  const candidateBlockingSafetyFailures = paired.filter(
    (row) => row.candidate.blockingSafetyFailure,
  ).length;
  const protocolConformant =
    state.status === "completed" &&
    paired.length >= campaign.decision.minimumSuccessfulPairs;
  const meaningfulGain =
    protocolConformant &&
    scoreDelta >= campaign.decision.minimumPracticalScoreDelta;
  const unacceptableRegression =
    candidateBlockingSafetyFailures > 0 ||
    (protocolConformant &&
      scoreDelta <= -campaign.decision.minimumPracticalScoreDelta);
  return {
    schemaVersion: 1,
    evidenceVersion: BENCHMARK_TRUST_EVIDENCE_VERSION,
    createdAt,
    campaign,
    events: state.events,
    judgments,
    summary: {
      taskFamily: campaign.category,
      successfulPairs: paired.length,
      requiredSuccessfulPairs: campaign.decision.minimumSuccessfulPairs,
      baselineMeanScore,
      candidateMeanScore,
      scoreDelta,
      minimumPracticalScoreDelta: campaign.decision.minimumPracticalScoreDelta,
      candidateBlockingSafetyFailures,
      protocolConformant,
      meaningfulGain,
      unacceptableRegression,
    },
    boundary:
      "Signed synthetic task-family evidence is scoped to this exact protocol, fixture, model, package commit, and instruction hash; popularity is not quality evidence.",
  };
}

export function createBenchmarkTrustEvidence(
  campaign: BenchmarkCampaignV1,
  events: readonly BenchmarkEvidenceEventV1[],
  judgments: readonly BenchmarkJudgmentV1[],
  createdAt = new Date().toISOString(),
): BenchmarkTrustEvidenceV1 {
  return computeTrustEvidence(campaign, events, judgments, createdAt);
}

export function signBenchmarkTrustEvidence(
  evidenceValue: BenchmarkTrustEvidenceV1,
  privateKeyPem: string,
): SignedEnvelope<BenchmarkTrustEvidenceV1> {
  const evidence = parseBenchmarkTrustEvidence(evidenceValue);
  return signPayload(evidence, privateKeyPem, evidence.createdAt);
}

export function parseBenchmarkTrustEvidence(
  value: unknown,
): BenchmarkTrustEvidenceV1 {
  if (!isRecord(value))
    throw new Error("Benchmark trust evidence must be an object");
  exactKeys(
    value,
    [
      "schemaVersion",
      "evidenceVersion",
      "createdAt",
      "campaign",
      "events",
      "judgments",
      "summary",
      "boundary",
    ],
    "Benchmark trust evidence",
  );
  if (
    value.schemaVersion !== 1 ||
    value.evidenceVersion !== BENCHMARK_TRUST_EVIDENCE_VERSION
  )
    throw new Error("Unsupported benchmark trust evidence version");
  if (!Array.isArray(value.events))
    throw new Error("Benchmark trust evidence events must be an array");
  const rebuilt = computeTrustEvidence(
    value.campaign,
    value.events,
    value.judgments,
    value.createdAt,
  );
  if (!isDeepStrictEqual(value, rebuilt))
    throw new Error(
      "Benchmark trust evidence does not match recomputed protocol data",
    );
  return rebuilt;
}

export function verifyBenchmarkTrustEvidence(
  envelope: SignedEnvelope<BenchmarkTrustEvidenceV1>,
  publicKeyPem: string,
): BenchmarkTrustEvidenceV1 {
  if (!verifyEnvelope(envelope, publicKeyPem).valid)
    throw new Error("Benchmark trust evidence signature is invalid");
  const evidence = parseBenchmarkTrustEvidence(envelope.payload);
  if (envelope.createdAt !== evidence.createdAt)
    throw new Error(
      "Benchmark trust evidence envelope timestamp is inconsistent",
    );
  return evidence;
}

function evidenceReference(
  envelope: SignedEnvelope<BenchmarkTrustEvidenceV1>,
  evidence: BenchmarkTrustEvidenceV1,
): BenchmarkEvidenceReferenceV1 {
  const candidate = evidence.campaign.candidates.find(
    (item) => item.role === "candidate",
  )!;
  return {
    evidenceSha256: digest(envelope),
    publicKeyFingerprint: envelope.publicKeyFingerprint,
    createdAt: evidence.createdAt,
    campaignId: evidence.campaign.campaignId,
    campaignSha256: benchmarkCampaignSha256(evidence.campaign),
    runId: evidence.events[0]?.runId ?? "missing-run",
    packageId: candidate.packageId,
    reviewedCommit: candidate.reviewedCommit,
    instructionSha256: candidate.instructionSha256,
    taskFamily: evidence.summary.taskFamily,
    successfulPairs: evidence.summary.successfulPairs,
    requiredSuccessfulPairs: evidence.summary.requiredSuccessfulPairs,
    scoreDelta: evidence.summary.scoreDelta,
    minimumPracticalScoreDelta: evidence.summary.minimumPracticalScoreDelta,
    protocolConformant: evidence.summary.protocolConformant,
    meaningfulGain: evidence.summary.meaningfulGain,
    unacceptableRegression: evidence.summary.unacceptableRegression,
  };
}

function parseReview(value: unknown): HumanTrustReviewV1 | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error("Human trust review must be an object");
  exactKeys(
    value,
    [
      "attestation",
      "reviewId",
      "reviewedBy",
      "reviewedAt",
      "packageId",
      "reviewedCommit",
      "licenseDecision",
      "trustDecision",
      "reviewEvidenceSha256",
    ],
    "Human trust review",
  );
  if (value.attestation !== "human-reviewed")
    throw new Error("Human trust review requires an explicit attestation");
  const licenseDecision = value.licenseDecision;
  const trustDecision = value.trustDecision;
  if (licenseDecision !== "approved" && licenseDecision !== "rejected")
    throw new Error("Human license decision is invalid");
  if (trustDecision !== "approved" && trustDecision !== "rejected")
    throw new Error("Human trust decision is invalid");
  return {
    attestation: "human-reviewed",
    reviewId: identifier(value.reviewId, "Human review id"),
    reviewedBy: identifier(value.reviewedBy, "Human reviewer"),
    reviewedAt: timestamp(value.reviewedAt, "Human review timestamp"),
    packageId: packageId(value.packageId, "Human review package id"),
    reviewedCommit: commit(value.reviewedCommit, "Human reviewed commit"),
    licenseDecision,
    trustDecision,
    reviewEvidenceSha256: sha256(
      value.reviewEvidenceSha256,
      "Human review evidence hash",
    ),
  };
}

function identifierArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array`);
  const result = value.map((item, index) =>
    identifier(item, `${context}[${index}]`),
  );
  if (new Set(result).size !== result.length)
    throw new Error(`${context} must not contain duplicates`);
  return [...result].sort();
}

function parseSecurity(value: unknown): SecurityReviewSummaryV1 {
  if (!isRecord(value)) throw new Error("Security review must be an object");
  exactKeys(
    value,
    [
      "scannerVersion",
      "scannedCommit",
      "blockingFindingIds",
      "warningFindingIds",
    ],
    "Security review",
  );
  return {
    scannerVersion: identifier(
      value.scannerVersion,
      "Security scanner version",
    ),
    scannedCommit: commit(value.scannedCommit, "Security scanned commit"),
    blockingFindingIds: identifierArray(
      value.blockingFindingIds,
      "Blocking security findings",
    ),
    warningFindingIds: identifierArray(
      value.warningFindingIds,
      "Security warning findings",
    ),
  };
}

function decisionReasons(
  status: TrustQualityStatus,
  metrics: TrustDecisionMetricsV1,
  review: HumanTrustReviewV1 | null,
): string[] {
  return [
    metrics.conformantEvidenceRecords
      ? `${metrics.conformantEvidenceRecords} signed protocol-conformant evidence record(s) establish benchmarked status.`
      : "No signed protocol-conformant evidence is present; missing evidence contributes zero.",
    metrics.taskFamiliesWithMeaningfulGain
      ? `Meaningful gain exists in ${metrics.taskFamiliesWithMeaningfulGain} declared task family/families.`
      : "No declared task family currently has a meaningful measured gain.",
    metrics.unacceptableRegressions
      ? `${metrics.unacceptableRegressions} unacceptable regression record(s) block recommendation.`
      : "No unacceptable regression appears in the current conformant evidence.",
    metrics.blockingSecurityFindings
      ? `${metrics.blockingSecurityFindings} blocking security finding(s) block recommendation.`
      : "No blocking security finding is recorded for the reviewed commit.",
    review?.licenseDecision === "approved" &&
    review.trustDecision === "approved"
      ? `Human license/trust review '${review.reviewId}' is approved for the reviewed commit.`
      : "An approved human license and trust review is missing.",
    `Result: ${status}. Stars, installs, telemetry, and popularity are not quality evidence.`,
  ];
}

function evidenceKey(reference: BenchmarkEvidenceReferenceV1): string {
  return reference.evidenceSha256;
}

function qualityStatus(
  metrics: TrustDecisionMetricsV1,
  review: HumanTrustReviewV1 | null,
): TrustQualityStatus {
  if (!metrics.conformantEvidenceRecords) return "unbenchmarked";
  const humanApproved =
    review?.licenseDecision === "approved" &&
    review.trustDecision === "approved";
  if (
    humanApproved &&
    metrics.taskFamiliesWithMeaningfulGain > 0 &&
    metrics.unacceptableRegressions === 0 &&
    metrics.blockingSecurityFindings === 0
  )
    return "recommended";
  return "benchmarked";
}

/**
 * Evaluate and sign one immutable transition. `humanReview` records a human's
 * attestation; software can validate its shape and binding but cannot prove a
 * person actually performed the review.
 */
export function createSignedTrustDecision(options: {
  packageId: string;
  reviewedCommit: string;
  instructionSha256: string;
  evidence: TrustedBenchmarkEvidenceInput[];
  humanReview: HumanTrustReviewV1 | null;
  security: SecurityReviewSummaryV1;
  privateKeyPem: string;
  previousDecision?: SignedEnvelope<TrustDecisionRecordV1>;
  createdAt?: string;
}): SignedEnvelope<TrustDecisionRecordV1> {
  if (!isRecord(options))
    throw new Error("Trust decision input must be an object");
  exactKeys(
    options as unknown as Record<string, unknown>,
    [
      "packageId",
      "reviewedCommit",
      "instructionSha256",
      "evidence",
      "humanReview",
      "security",
      "privateKeyPem",
      ...(options.previousDecision === undefined ? [] : ["previousDecision"]),
      ...(options.createdAt === undefined ? [] : ["createdAt"]),
    ],
    "Trust decision input",
  );
  const selectedPackage = packageId(
    options.packageId,
    "Trust decision package id",
  );
  const selectedCommit = commit(
    options.reviewedCommit,
    "Trust decision commit",
  );
  const selectedInstruction = sha256(
    options.instructionSha256,
    "Trust decision instruction hash",
  );
  const createdAt = timestamp(
    options.createdAt ?? new Date().toISOString(),
    "Trust decision timestamp",
  );
  if (!Array.isArray(options.evidence))
    throw new Error("Trust decision evidence must be an array");
  const currentEvidence = options.evidence.map((entry, index) => {
    if (!isRecord(entry))
      throw new Error(`Trust decision evidence ${index + 1} is invalid`);
    exactKeys(
      entry,
      ["envelope", "publicKeyPem"],
      `Trust decision evidence ${index + 1}`,
    );
    if (typeof entry.publicKeyPem !== "string")
      throw new Error(
        `Trust decision evidence ${index + 1} public key is invalid`,
      );
    const evidence = verifyBenchmarkTrustEvidence(
      entry.envelope as SignedEnvelope<BenchmarkTrustEvidenceV1>,
      entry.publicKeyPem,
    );
    const reference = evidenceReference(
      entry.envelope as SignedEnvelope<BenchmarkTrustEvidenceV1>,
      evidence,
    );
    if (
      reference.packageId !== selectedPackage ||
      reference.reviewedCommit !== selectedCommit ||
      reference.instructionSha256 !== selectedInstruction
    )
      throw new Error(
        "Benchmark evidence does not bind the selected package revision",
      );
    return reference;
  });
  if (new Set(currentEvidence.map(evidenceKey)).size !== currentEvidence.length)
    throw new Error("Trust decision evidence must not contain duplicates");
  currentEvidence.sort((left, right) =>
    evidenceKey(left).localeCompare(evidenceKey(right)),
  );

  const review = parseReview(options.humanReview);
  if (
    review &&
    (review.packageId !== selectedPackage ||
      review.reviewedCommit !== selectedCommit)
  )
    throw new Error("Human review does not bind the selected package revision");
  const security = parseSecurity(options.security);
  if (security.scannedCommit !== selectedCommit)
    throw new Error(
      "Security review does not bind the selected package revision",
    );

  let sequence = 0;
  let previousDecisionSha256: string | null = null;
  let previousStatus: TrustQualityStatus = "unbenchmarked";
  let priorEvidence: BenchmarkEvidenceReferenceV1[] = [];
  if (options.previousDecision) {
    const publicPem = createPublicKey(options.privateKeyPem)
      .export({ type: "spki", format: "pem" })
      .toString();
    const previous = verifyTrustDecisionRecord(
      options.previousDecision,
      publicPem,
    );
    if (previous.packageId !== selectedPackage)
      throw new Error("Previous trust decision names a different package");
    if (Date.parse(createdAt) < Date.parse(previous.createdAt))
      throw new Error("Trust decision timestamps must be monotonic");
    sequence = previous.sequence + 1;
    previousDecisionSha256 = digest(options.previousDecision);
    previousStatus = previous.status;
    priorEvidence = previous.retainedEvidence;
  }
  const retainedByHash = new Map(
    [...priorEvidence, ...currentEvidence].map((reference) => [
      evidenceKey(reference),
      reference,
    ]),
  );
  const retainedEvidence = [...retainedByHash.values()].sort((left, right) =>
    evidenceKey(left).localeCompare(evidenceKey(right)),
  );
  const conformant = currentEvidence.filter(
    (reference) => reference.protocolConformant,
  );
  const metrics: TrustDecisionMetricsV1 = {
    signedEvidenceRecords: currentEvidence.length,
    conformantEvidenceRecords: conformant.length,
    taskFamiliesWithMeaningfulGain: new Set(
      conformant
        .filter((reference) => reference.meaningfulGain)
        .map((reference) => reference.taskFamily),
    ).size,
    unacceptableRegressions: conformant.filter(
      (reference) => reference.unacceptableRegression,
    ).length,
    blockingSecurityFindings: security.blockingFindingIds.length,
    missingEvidenceContribution: 0,
  };
  const status = qualityStatus(metrics, review);
  const payload: TrustDecisionRecordV1 = {
    schemaVersion: 1,
    policyVersion: TRUST_DECISION_POLICY_VERSION,
    decisionId: digest({
      selectedPackage,
      selectedCommit,
      sequence,
      createdAt,
    }).slice(0, 32),
    sequence,
    createdAt,
    packageId: selectedPackage,
    reviewedCommit: selectedCommit,
    instructionSha256: selectedInstruction,
    status,
    transition: `${previousStatus}->${status}`,
    previousDecisionSha256,
    currentEvidence,
    retainedEvidence,
    humanReview: review,
    security,
    metrics,
    reasons: decisionReasons(status, metrics, review),
    policyBoundary:
      "Promotion is scoped evidence, not a universal-best claim. Human attestation remains a real human responsibility and popularity never substitutes for quality evidence.",
  };
  return signPayload(payload, options.privateKeyPem, createdAt);
}

function parseEvidenceReference(
  value: unknown,
  context: string,
): BenchmarkEvidenceReferenceV1 {
  if (!isRecord(value)) throw new Error(`${context} must be an object`);
  exactKeys(
    value,
    [
      "evidenceSha256",
      "publicKeyFingerprint",
      "createdAt",
      "campaignId",
      "campaignSha256",
      "runId",
      "packageId",
      "reviewedCommit",
      "instructionSha256",
      "taskFamily",
      "successfulPairs",
      "requiredSuccessfulPairs",
      "scoreDelta",
      "minimumPracticalScoreDelta",
      "protocolConformant",
      "meaningfulGain",
      "unacceptableRegression",
    ],
    context,
  );
  const taskFamily = value.taskFamily;
  if (
    typeof taskFamily !== "string" ||
    !TASK_FAMILIES.has(taskFamily as BenchmarkCampaignV1["category"])
  )
    throw new Error(`${context}.taskFamily is invalid`);
  const protocolConformant = value.protocolConformant;
  const meaningfulGain = value.meaningfulGain;
  const unacceptableRegression = value.unacceptableRegression;
  if (
    typeof protocolConformant !== "boolean" ||
    typeof meaningfulGain !== "boolean" ||
    typeof unacceptableRegression !== "boolean"
  )
    throw new Error(`${context} boolean state is invalid`);
  const scoreDelta = boundedNumber(
    value.scoreDelta,
    `${context}.scoreDelta`,
    -100,
    100,
  );
  const minimumPracticalScoreDelta = boundedNumber(
    value.minimumPracticalScoreDelta,
    `${context}.minimumPracticalScoreDelta`,
    0,
    100,
  );
  if (
    meaningfulGain !==
    (protocolConformant && scoreDelta >= minimumPracticalScoreDelta)
  )
    throw new Error(`${context}.meaningfulGain is inconsistent`);
  return {
    evidenceSha256: sha256(value.evidenceSha256, `${context}.evidenceSha256`),
    publicKeyFingerprint: (() => {
      const fingerprint = text(
        value.publicKeyFingerprint,
        `${context}.publicKeyFingerprint`,
        96,
      );
      if (!/^sha256:[a-f0-9]{64}$/.test(fingerprint))
        throw new Error(`${context}.publicKeyFingerprint is invalid`);
      return fingerprint;
    })(),
    createdAt: timestamp(value.createdAt, `${context}.createdAt`),
    campaignId: identifier(value.campaignId, `${context}.campaignId`),
    campaignSha256: sha256(value.campaignSha256, `${context}.campaignSha256`),
    runId: identifier(value.runId, `${context}.runId`),
    packageId: packageId(value.packageId, `${context}.packageId`),
    reviewedCommit: commit(value.reviewedCommit, `${context}.reviewedCommit`),
    instructionSha256: sha256(
      value.instructionSha256,
      `${context}.instructionSha256`,
    ),
    taskFamily: taskFamily as BenchmarkCampaignV1["category"],
    successfulPairs: integer(
      value.successfulPairs,
      `${context}.successfulPairs`,
      0,
      100,
    ),
    requiredSuccessfulPairs: integer(
      value.requiredSuccessfulPairs,
      `${context}.requiredSuccessfulPairs`,
      5,
      100,
    ),
    scoreDelta,
    minimumPracticalScoreDelta,
    protocolConformant,
    meaningfulGain,
    unacceptableRegression,
  };
}

function parseReferenceArray(
  value: unknown,
  context: string,
): BenchmarkEvidenceReferenceV1[] {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array`);
  const references = value.map((entry, index) =>
    parseEvidenceReference(entry, `${context}[${index}]`),
  );
  const hashes = references.map(evidenceKey);
  if (new Set(hashes).size !== hashes.length)
    throw new Error(`${context} must not contain duplicate evidence`);
  if (!isDeepStrictEqual(hashes, [...hashes].sort()))
    throw new Error(`${context} must be sorted by evidence hash`);
  return references;
}

function parseMetrics(value: unknown): TrustDecisionMetricsV1 {
  if (!isRecord(value))
    throw new Error("Trust decision metrics must be an object");
  exactKeys(
    value,
    [
      "signedEvidenceRecords",
      "conformantEvidenceRecords",
      "taskFamiliesWithMeaningfulGain",
      "unacceptableRegressions",
      "blockingSecurityFindings",
      "missingEvidenceContribution",
    ],
    "Trust decision metrics",
  );
  if (value.missingEvidenceContribution !== 0)
    throw new Error("Missing evidence contribution must be zero");
  return {
    signedEvidenceRecords: integer(
      value.signedEvidenceRecords,
      "Signed evidence count",
      0,
      10_000,
    ),
    conformantEvidenceRecords: integer(
      value.conformantEvidenceRecords,
      "Conformant evidence count",
      0,
      10_000,
    ),
    taskFamiliesWithMeaningfulGain: integer(
      value.taskFamiliesWithMeaningfulGain,
      "Meaningful task-family count",
      0,
      TASK_FAMILIES.size,
    ),
    unacceptableRegressions: integer(
      value.unacceptableRegressions,
      "Unacceptable regression count",
      0,
      10_000,
    ),
    blockingSecurityFindings: integer(
      value.blockingSecurityFindings,
      "Blocking security finding count",
      0,
      10_000,
    ),
    missingEvidenceContribution: 0,
  };
}

export function parseTrustDecisionRecord(
  value: unknown,
): TrustDecisionRecordV1 {
  if (!isRecord(value)) throw new Error("Trust decision must be an object");
  exactKeys(
    value,
    [
      "schemaVersion",
      "policyVersion",
      "decisionId",
      "sequence",
      "createdAt",
      "packageId",
      "reviewedCommit",
      "instructionSha256",
      "status",
      "transition",
      "previousDecisionSha256",
      "currentEvidence",
      "retainedEvidence",
      "humanReview",
      "security",
      "metrics",
      "reasons",
      "policyBoundary",
    ],
    "Trust decision",
  );
  if (
    value.schemaVersion !== 1 ||
    value.policyVersion !== TRUST_DECISION_POLICY_VERSION
  )
    throw new Error("Unsupported trust decision version");
  const status = value.status;
  if (
    status !== "unbenchmarked" &&
    status !== "benchmarked" &&
    status !== "recommended"
  )
    throw new Error("Trust decision status is invalid");
  const sequence = integer(
    value.sequence,
    "Trust decision sequence",
    0,
    100_000,
  );
  const previousDecisionSha256 =
    value.previousDecisionSha256 === null
      ? null
      : sha256(value.previousDecisionSha256, "Previous trust decision hash");
  if ((sequence === 0) !== (previousDecisionSha256 === null))
    throw new Error("Trust decision predecessor is inconsistent with sequence");
  const currentEvidence = parseReferenceArray(
    value.currentEvidence,
    "Current benchmark evidence",
  );
  const retainedEvidence = parseReferenceArray(
    value.retainedEvidence,
    "Retained benchmark evidence",
  );
  const retainedHashes = new Set(retainedEvidence.map(evidenceKey));
  if (
    currentEvidence.some(
      (reference) => !retainedHashes.has(evidenceKey(reference)),
    )
  )
    throw new Error(
      "Current benchmark evidence is missing from retained evidence",
    );
  const review = parseReview(value.humanReview);
  const security = parseSecurity(value.security);
  const metrics = parseMetrics(value.metrics);
  const expectedMetrics: TrustDecisionMetricsV1 = {
    signedEvidenceRecords: currentEvidence.length,
    conformantEvidenceRecords: currentEvidence.filter(
      (reference) => reference.protocolConformant,
    ).length,
    taskFamiliesWithMeaningfulGain: new Set(
      currentEvidence
        .filter(
          (reference) =>
            reference.protocolConformant && reference.meaningfulGain,
        )
        .map((reference) => reference.taskFamily),
    ).size,
    unacceptableRegressions: currentEvidence.filter(
      (reference) =>
        reference.protocolConformant && reference.unacceptableRegression,
    ).length,
    blockingSecurityFindings: security.blockingFindingIds.length,
    missingEvidenceContribution: 0,
  };
  if (!isDeepStrictEqual(metrics, expectedMetrics))
    throw new Error("Trust decision metrics do not match retained inputs");
  const expectedStatus = qualityStatus(metrics, review);
  if (status !== expectedStatus)
    throw new Error("Trust decision status does not follow promotion policy");
  if (!Array.isArray(value.reasons))
    throw new Error("Trust decision reasons must be an array");
  const expectedReasons = decisionReasons(status, metrics, review);
  if (!isDeepStrictEqual(value.reasons, expectedReasons))
    throw new Error("Trust decision reasons do not match promotion policy");
  const selectedPackage = packageId(
    value.packageId,
    "Trust decision package id",
  );
  const selectedCommit = commit(value.reviewedCommit, "Trust decision commit");
  const selectedInstruction = sha256(
    value.instructionSha256,
    "Trust decision instruction hash",
  );
  const createdAt = timestamp(value.createdAt, "Trust decision timestamp");
  const decisionId = text(value.decisionId, "Trust decision id", 64);
  const expectedDecisionId = digest({
    selectedPackage,
    selectedCommit,
    sequence,
    createdAt,
  }).slice(0, 32);
  if (decisionId !== expectedDecisionId)
    throw new Error("Trust decision id does not match its immutable inputs");
  const transition = text(value.transition, "Trust decision transition", 64);
  if (
    (sequence === 0 && transition !== `unbenchmarked->${status}`) ||
    (sequence > 0 && !transition.endsWith(`->${status}`))
  )
    throw new Error("Trust decision transition is inconsistent");
  if (
    currentEvidence.some(
      (reference) =>
        reference.packageId !== selectedPackage ||
        reference.reviewedCommit !== selectedCommit ||
        reference.instructionSha256 !== selectedInstruction,
    ) ||
    (review &&
      (review.packageId !== selectedPackage ||
        review.reviewedCommit !== selectedCommit)) ||
    security.scannedCommit !== selectedCommit
  )
    throw new Error(
      "Trust decision inputs do not bind the selected package revision",
    );
  if (
    retainedEvidence.some(
      (reference) => reference.packageId !== selectedPackage,
    )
  )
    throw new Error("Retained evidence names a different package");
  if (
    sequence === 0 &&
    !isDeepStrictEqual(
      retainedEvidence.map(evidenceKey),
      currentEvidence.map(evidenceKey),
    )
  )
    throw new Error("First trust decision cannot contain prior evidence");
  const record: TrustDecisionRecordV1 = {
    schemaVersion: 1,
    policyVersion: TRUST_DECISION_POLICY_VERSION,
    decisionId,
    sequence,
    createdAt,
    packageId: selectedPackage,
    reviewedCommit: selectedCommit,
    instructionSha256: selectedInstruction,
    status,
    transition,
    previousDecisionSha256,
    currentEvidence,
    retainedEvidence,
    humanReview: review,
    security,
    metrics,
    reasons: expectedReasons,
    policyBoundary: text(
      value.policyBoundary,
      "Trust decision policy boundary",
      512,
    ),
  };
  return record;
}

export function verifyTrustDecisionRecord(
  envelope: SignedEnvelope<TrustDecisionRecordV1>,
  publicKeyPem: string,
): TrustDecisionRecordV1 {
  if (!verifyEnvelope(envelope, publicKeyPem).valid)
    throw new Error("Trust decision signature is invalid");
  const record = parseTrustDecisionRecord(envelope.payload);
  if (record.createdAt !== envelope.createdAt)
    throw new Error("Trust decision envelope timestamp is inconsistent");
  return record;
}

export function verifyTrustDecisionChain(
  envelopes: readonly SignedEnvelope<TrustDecisionRecordV1>[],
  publicKeyPem: string,
): TrustDecisionRecordV1[] {
  if (!envelopes.length) throw new Error("Trust decision chain is empty");
  const records = envelopes.map((envelope) =>
    verifyTrustDecisionRecord(envelope, publicKeyPem),
  );
  for (const [index, record] of records.entries()) {
    if (record.sequence !== index)
      throw new Error(`Trust decision chain is non-contiguous at ${index}`);
    if (index === 0) continue;
    const previous = records[index - 1];
    if (
      record.previousDecisionSha256 !== digest(envelopes[index - 1]) ||
      record.packageId !== previous.packageId ||
      Date.parse(record.createdAt) < Date.parse(previous.createdAt)
    )
      throw new Error(`Trust decision chain is invalid at ${index}`);
    if (record.transition !== `${previous.status}->${record.status}`)
      throw new Error(`Trust decision transition is invalid at ${index}`);
    const retained = new Set(record.retainedEvidence.map(evidenceKey));
    if (
      previous.retainedEvidence.some(
        (reference) => !retained.has(evidenceKey(reference)),
      )
    )
      throw new Error(`Trust decision dropped prior evidence at ${index}`);
  }
  return records;
}

/**
 * Produce complete catalog coverage from verified decision chains. A decision
 * for an older commit remains visible, but is never silently applied to a newer
 * catalog revision.
 */
export function buildCatalogTrustCoverage(
  catalog: readonly CatalogPackage[],
  chains: readonly {
    envelopes: readonly SignedEnvelope<TrustDecisionRecordV1>[];
    publicKeyPem: string;
  }[],
): CatalogTrustCoverageV1 {
  const catalogIds = catalog.map((item) => item.id);
  if (new Set(catalogIds).size !== catalogIds.length)
    throw new Error("Catalog trust coverage requires unique package ids");
  const latestByPackage = new Map<string, TrustDecisionRecordV1>();
  for (const [index, chain] of chains.entries()) {
    if (!isRecord(chain))
      throw new Error(`Catalog trust chain ${index + 1} must be an object`);
    exactKeys(
      chain,
      ["envelopes", "publicKeyPem"],
      `Catalog trust chain ${index + 1}`,
    );
    if (typeof chain.publicKeyPem !== "string")
      throw new Error(`Catalog trust chain ${index + 1} public key is invalid`);
    const records = verifyTrustDecisionChain(
      chain.envelopes,
      chain.publicKeyPem,
    );
    const latest = records.at(-1)!;
    if (latestByPackage.has(latest.packageId))
      throw new Error(
        `Catalog has multiple trust chains for '${latest.packageId}'`,
      );
    latestByPackage.set(latest.packageId, latest);
  }
  const packages = [...catalog]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((item): CatalogTrustCoverageItemV1 => {
      const latest = latestByPackage.get(item.id);
      const catalogCommit = item.source?.commit ?? null;
      if (!latest)
        return {
          packageId: item.id,
          catalogCommit,
          status: "unbenchmarked",
          decisionId: null,
          decisionCommit: null,
          transition: "none->unbenchmarked",
          retainedEvidenceSha256: [],
          explanation: [
            "No signed trust decision exists; missing benchmark evidence contributes zero.",
            "Popularity and stars do not establish catalog quality.",
          ],
        };
      const exactRevision =
        catalogCommit !== null && latest.reviewedCommit === catalogCommit;
      return {
        packageId: item.id,
        catalogCommit,
        status: exactRevision ? latest.status : "unbenchmarked",
        decisionId: latest.decisionId,
        decisionCommit: latest.reviewedCommit,
        transition: exactRevision
          ? latest.transition
          : `${latest.status}->unbenchmarked`,
        retainedEvidenceSha256: latest.retainedEvidence.map(evidenceKey),
        explanation: exactRevision
          ? [...latest.reasons]
          : [
              catalogCommit
                ? `Latest signed decision covers ${latest.reviewedCommit}; catalog now pins ${catalogCommit}.`
                : "Catalog package has no immutable reviewed commit.",
              "The prior signed decision and evidence references are retained, but missing evidence for this revision contributes zero.",
            ],
      };
    });
  const counts: Record<TrustQualityStatus, number> = {
    unbenchmarked: packages.filter((item) => item.status === "unbenchmarked")
      .length,
    benchmarked: packages.filter((item) => item.status === "benchmarked")
      .length,
    recommended: packages.filter((item) => item.status === "recommended")
      .length,
  };
  return {
    schemaVersion: 1,
    policyVersion: TRUST_DECISION_POLICY_VERSION,
    packages,
    counts,
    policyBoundary:
      "Coverage reports signed evidence for exact reviewed commits. Missing or stale evidence contributes zero; popularity is never substituted.",
  };
}
