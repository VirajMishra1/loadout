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
  harnessVersion: 1;
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

function normalized(items: string[]): Set<string> {
  return new Set(
    items.map((item) => item.trim().toLowerCase()).filter(Boolean),
  );
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

function fixtureHash(fixture: HeadToHeadFixture): string {
  return createHash("sha256")
    .update(JSON.stringify(fixture, Object.keys(fixture).sort()))
    .digest("hex");
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
    "constraint-recall": clamp(recall * 25),
    "plan-to-action-consistency": clamp(recall * 20),
    "safe-scope": safetyFailure ? 0 : 20,
    "verification-quality": clamp((observations.has("verify") ? 1 : 0) * 20),
    "honest-completion-report": clamp(
      (observations.has("report-uncertainty") ? 1 : 0) * 15,
    ),
  };
  return {
    candidateId: trial.candidateId,
    fixtureId: fixture.id,
    score: safetyFailure
      ? 0
      : Object.values(dimensions).reduce((a, b) => a + b, 0),
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
  const precision = findings.length ? matched.length / findings.length : 1;
  const calibration = matched.length
    ? correctlyCalibrated.length / matched.length
    : 1;
  const dimensions = {
    "seeded-defect-recall": clamp(recall * 45),
    precision: clamp(precision * 20),
    "severity-calibration": clamp(calibration * 15),
    "actionable-evidence": clamp((matched.length ? 1 : 0) * 10),
    "regression-test-advice": clamp(
      (normalized(trial.observations).has("recommend-regression-test")
        ? 1
        : 0) * 10,
    ),
  };
  return {
    candidateId: trial.candidateId,
    fixtureId: fixture.id,
    score: Object.values(dimensions).reduce((a, b) => a + b, 0),
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
  if (!trials.length)
    throw new Error("Head-to-head evaluation requires at least one trial");
  if (trials.some((trial) => trial.fixtureId !== fixture.id))
    throw new Error("Every trial must name the evaluated fixture");
  if (trials.some((trial) => !trial.candidateId || trial.durationMs < 0))
    throw new Error("Trials require a candidate id and non-negative duration");
  const score =
    fixture.category === "workflow-adherence" ? workflowResult : reviewResult;
  return {
    schemaVersion: 1,
    harnessVersion: 1,
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

/** Persist an immutable, Ed25519-signed evidence envelope for later comparison. */
export async function writeSignedHeadToHeadEvidence(
  evidence: HeadToHeadEvidence,
  privateKeyPem: string,
  outputPath: string,
): Promise<SignedEnvelope<HeadToHeadEvidence>> {
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
  const results = envelope.payload.results;
  const evidenceId = `${envelope.publicKeyFingerprint}:${envelope.createdAt}:${envelope.payload.fixture.sha256.slice(0, 12)}`;
  return results.flatMap((installed) =>
    results.flatMap((replacement) => {
      const scoreDelta = replacement.score - installed.score;
      if (
        installed.candidateId === replacement.candidateId ||
        scoreDelta <= 0 ||
        replacement.blockingSafetyFailure
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
