import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BENCHMARK_PROTOCOL_VERSION,
  buildBenchmarkSchedule,
  type BenchmarkCampaignV1,
} from "../src/core/benchmark-campaign.js";
import {
  createBenchmarkEvidenceEvent,
  type BenchmarkEvidenceEventV1,
} from "../src/core/benchmark-evidence.js";
import {
  buildCatalogTrustCoverage,
  createBenchmarkTrustEvidence,
  createSignedTrustDecision,
  signBenchmarkTrustEvidence,
  verifyBenchmarkTrustEvidence,
  verifyTrustDecisionChain,
  verifyTrustDecisionRecord,
  type BenchmarkJudgmentV1,
  type HumanTrustReviewV1,
  type SecurityReviewSummaryV1,
} from "../src/core/benchmark-trust.js";
import type { SignedEnvelope } from "../src/core/signing.js";

const sha = (character: string): string => character.repeat(64);
const commit = (character: string): string => character.repeat(40);

function campaign(
  id = "trust-positive",
  category: BenchmarkCampaignV1["category"] = "workflow-adherence",
): BenchmarkCampaignV1 {
  return {
    schemaVersion: 1,
    protocolVersion: BENCHMARK_PROTOCOL_VERSION,
    campaignId: id,
    createdAt: "2026-07-16T10:00:00.000Z",
    category,
    fixture: {
      id: `${category}-fixture`,
      version: "1.0.0",
      fixtureSha256: sha("a"),
      rubricSha256: sha("b"),
    },
    candidates: [
      {
        role: "baseline",
        id: "baseline",
        packageId: "baseline-package",
        skillPath: "baseline/SKILL.md",
        reviewedCommit: commit("c"),
        instructionSha256: sha("d"),
      },
      {
        role: "candidate",
        id: "candidate",
        packageId: "candidate-package",
        skillPath: "candidate/SKILL.md",
        reviewedCommit: commit("e"),
        instructionSha256: sha("f"),
      },
    ],
    model: { provider: "synthetic", model: "fixture-model", version: "1" },
    sampling: {
      temperature: 0,
      topP: 1,
      maxInputTokensPerRequest: 100,
      maxOutputTokensPerRequest: 50,
    },
    trials: { pairs: 5, maxRetriesPerRequest: 0, timeoutMsPerRequest: 1_000 },
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
      maxRequests: 10,
      maxInputTokens: 1_000,
      maxOutputTokens: 500,
      maxCostUsd: 1,
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 1,
    },
    decision: {
      minimumSuccessfulPairs: 5,
      minimumPracticalScoreDelta: 5,
      promotionPolicy: "signed-evidence-plus-human-approval",
    },
  };
}

function keys(): { privateKey: string; publicKey: string } {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    publicKey: pair.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
  };
}

function completedRun(
  selected: BenchmarkCampaignV1,
  baselineScore: number,
  candidateScore: number,
  candidateBlockingPair = -1,
): { events: BenchmarkEvidenceEventV1[]; judgments: BenchmarkJudgmentV1[] } {
  const schedule = buildBenchmarkSchedule(selected);
  let events: BenchmarkEvidenceEventV1[] = [];
  let tick = 0;
  const add = (
    payload: Parameters<typeof createBenchmarkEvidenceEvent>[3],
  ): void => {
    events = [
      ...events,
      createBenchmarkEvidenceEvent(
        selected,
        "trust-run",
        events,
        payload,
        new Date(Date.UTC(2026, 6, 16, 10, 1, tick++)).toISOString(),
      ),
    ];
  };
  add({
    type: "run-started",
    providerId: "synthetic",
    sandboxBackend: "injected",
    spendApproved: true,
  });
  const judgments: BenchmarkJudgmentV1[] = [];
  for (const request of schedule) {
    add({
      type: "request-started",
      requestId: request.requestId,
      pairIndex: request.pairIndex,
      position: request.position,
      attempt: 1,
    });
    const outputSha256 = sha(
      ((request.pairIndex * 2 + request.position) % 10).toString(),
    );
    add({
      type: "request-completed",
      completion: {
        requestId: request.requestId,
        outcome: "succeeded",
        attempts: 1,
        inputTokens: 10,
        outputTokens: 5,
        durationMs: 20,
        reportedCostUsd: 0.001,
        outputSha256,
      },
    });
    const blocked =
      request.role === "candidate" &&
      request.pairIndex === candidateBlockingPair;
    judgments.push({
      requestId: request.requestId,
      outputSha256,
      score: blocked
        ? 0
        : request.role === "candidate"
          ? candidateScore
          : baselineScore,
      blockingSafetyFailure: blocked,
    });
  }
  add({ type: "run-completed" });
  return { events, judgments };
}

function review(approved = true): HumanTrustReviewV1 {
  return {
    attestation: "human-reviewed",
    reviewId: "review-2026-07-16",
    reviewedBy: "team-member-1",
    reviewedAt: "2026-07-16T10:05:00.000Z",
    packageId: "candidate-package",
    reviewedCommit: commit("e"),
    licenseDecision: approved ? "approved" : "rejected",
    trustDecision: approved ? "approved" : "rejected",
    reviewEvidenceSha256: sha("9"),
  };
}

function security(blocked = false): SecurityReviewSummaryV1 {
  return {
    scannerVersion: "skill-security-v1",
    scannedCommit: commit("e"),
    blockingFindingIds: blocked ? ["credential-exfiltration"] : [],
    warningFindingIds: ["remote-domain"],
  };
}

function signedEvidence(
  signer: ReturnType<typeof keys>,
  baselineScore = 60,
  candidateScore = 90,
  selected = campaign(),
  candidateBlockingPair = -1,
) {
  const run = completedRun(
    selected,
    baselineScore,
    candidateScore,
    candidateBlockingPair,
  );
  return signBenchmarkTrustEvidence(
    createBenchmarkTrustEvidence(
      selected,
      run.events,
      run.judgments,
      "2026-07-16T10:04:00.000Z",
    ),
    signer.privateKey,
  );
}

describe("signed benchmark trust promotion", () => {
  it("recomputes protocol evidence and recommends only after human and security approval", () => {
    const signer = keys();
    const evidence = signedEvidence(signer);
    expect(
      verifyBenchmarkTrustEvidence(evidence, signer.publicKey).summary,
    ).toMatchObject({
      protocolConformant: true,
      meaningfulGain: true,
      scoreDelta: 30,
    });

    const withoutHuman = createSignedTrustDecision({
      packageId: "candidate-package",
      reviewedCommit: commit("e"),
      instructionSha256: sha("f"),
      evidence: [{ envelope: evidence, publicKeyPem: signer.publicKey }],
      humanReview: null,
      security: security(),
      privateKeyPem: signer.privateKey,
      createdAt: "2026-07-16T10:06:00.000Z",
    });
    expect(
      verifyTrustDecisionRecord(withoutHuman, signer.publicKey).status,
    ).toBe("benchmarked");

    const recommended = createSignedTrustDecision({
      packageId: "candidate-package",
      reviewedCommit: commit("e"),
      instructionSha256: sha("f"),
      evidence: [{ envelope: evidence, publicKeyPem: signer.publicKey }],
      humanReview: review(),
      security: security(),
      privateKeyPem: signer.privateKey,
      previousDecision: withoutHuman,
      createdAt: "2026-07-16T10:07:00.000Z",
    });
    const chain = verifyTrustDecisionChain(
      [withoutHuman, recommended],
      signer.publicKey,
    );
    expect(chain[1]).toMatchObject({
      status: "recommended",
      transition: "benchmarked->recommended",
      metrics: {
        conformantEvidenceRecords: 1,
        taskFamiliesWithMeaningfulGain: 1,
        missingEvidenceContribution: 0,
      },
    });
    expect(chain[1].retainedEvidence).toHaveLength(1);

    const coverage = buildCatalogTrustCoverage(
      [
        {
          id: "candidate-package",
          displayName: "Candidate",
          repository: "example/candidate",
          description: "Candidate package",
          category: "workflow",
          tier: "stable",
          source: {
            type: "github",
            url: "https://github.com/example/candidate",
            defaultBranch: "main",
            commit: commit("e"),
            evidencePaths: ["candidate/SKILL.md"],
            verifiedAt: "2026-07-16T10:00:00.000Z",
          },
        },
        {
          id: "no-evidence-package",
          displayName: "No Evidence",
          repository: "example/no-evidence",
          description: "No evidence package",
          category: "workflow",
          tier: "community",
        },
      ],
      [
        {
          envelopes: [withoutHuman, recommended],
          publicKeyPem: signer.publicKey,
        },
      ],
    );
    expect(coverage.counts).toEqual({
      unbenchmarked: 1,
      benchmarked: 0,
      recommended: 1,
    });
    expect(coverage.packages[1]).toMatchObject({
      packageId: "no-evidence-package",
      status: "unbenchmarked",
    });
  });

  it("gives missing evidence zero and rejects popularity as an evaluator input", () => {
    const signer = keys();
    const missing = createSignedTrustDecision({
      packageId: "candidate-package",
      reviewedCommit: commit("e"),
      instructionSha256: sha("f"),
      evidence: [],
      humanReview: review(),
      security: security(),
      privateKeyPem: signer.privateKey,
      createdAt: "2026-07-16T10:06:00.000Z",
    });
    expect(verifyTrustDecisionRecord(missing, signer.publicKey)).toMatchObject({
      status: "unbenchmarked",
      metrics: {
        signedEvidenceRecords: 0,
        conformantEvidenceRecords: 0,
        missingEvidenceContribution: 0,
      },
    });
    expect(() =>
      createSignedTrustDecision({
        packageId: "candidate-package",
        reviewedCommit: commit("e"),
        instructionSha256: sha("f"),
        evidence: [],
        humanReview: review(),
        security: security(),
        privateKeyPem: signer.privateKey,
        createdAt: "2026-07-16T10:06:00.000Z",
        stars: 1_000_000,
      } as Parameters<typeof createSignedTrustDecision>[0] & { stars: number }),
    ).toThrow(/unknown field.*stars/);
  });

  it("blocks recommendation for security failures or task-family regressions", () => {
    const signer = keys();
    const positive = signedEvidence(signer);
    const blocked = createSignedTrustDecision({
      packageId: "candidate-package",
      reviewedCommit: commit("e"),
      instructionSha256: sha("f"),
      evidence: [{ envelope: positive, publicKeyPem: signer.publicKey }],
      humanReview: review(),
      security: security(true),
      privateKeyPem: signer.privateKey,
      createdAt: "2026-07-16T10:06:00.000Z",
    });
    expect(verifyTrustDecisionRecord(blocked, signer.publicKey)).toMatchObject({
      status: "benchmarked",
      metrics: { blockingSecurityFindings: 1 },
    });

    const regressionCampaign = campaign(
      "trust-regression",
      "documentation-retrieval",
    );
    const regression = signedEvidence(signer, 90, 50, regressionCampaign);
    const regressed = createSignedTrustDecision({
      packageId: "candidate-package",
      reviewedCommit: commit("e"),
      instructionSha256: sha("f"),
      evidence: [
        { envelope: positive, publicKeyPem: signer.publicKey },
        { envelope: regression, publicKeyPem: signer.publicKey },
      ],
      humanReview: review(),
      security: security(),
      privateKeyPem: signer.privateKey,
      createdAt: "2026-07-16T10:06:00.000Z",
    });
    expect(
      verifyTrustDecisionRecord(regressed, signer.publicKey),
    ).toMatchObject({
      status: "benchmarked",
      metrics: {
        taskFamiliesWithMeaningfulGain: 1,
        unacceptableRegressions: 1,
      },
    });
  });

  it("rejects tampering, unsigned substitution, revision mismatch, and broken chains", () => {
    const signer = keys();
    const evidence = signedEvidence(signer);
    const tampered = structuredClone(evidence);
    tampered.payload.summary.scoreDelta = 99;
    expect(() =>
      verifyBenchmarkTrustEvidence(tampered, signer.publicKey),
    ).toThrow(/signature is invalid/);
    expect(() =>
      createSignedTrustDecision({
        packageId: "candidate-package",
        reviewedCommit: commit("a"),
        instructionSha256: sha("f"),
        evidence: [{ envelope: evidence, publicKeyPem: signer.publicKey }],
        humanReview: null,
        security: { ...security(), scannedCommit: commit("a") },
        privateKeyPem: signer.privateKey,
      }),
    ).toThrow(/does not bind/);

    const first = createSignedTrustDecision({
      packageId: "candidate-package",
      reviewedCommit: commit("e"),
      instructionSha256: sha("f"),
      evidence: [{ envelope: evidence, publicKeyPem: signer.publicKey }],
      humanReview: review(),
      security: security(),
      privateKeyPem: signer.privateKey,
      createdAt: "2026-07-16T10:06:00.000Z",
    });
    const second = createSignedTrustDecision({
      packageId: "candidate-package",
      reviewedCommit: commit("a"),
      instructionSha256: sha("7"),
      evidence: [],
      humanReview: {
        ...review(),
        reviewedCommit: commit("a"),
      },
      security: { ...security(), scannedCommit: commit("a") },
      privateKeyPem: signer.privateKey,
      previousDecision: first,
      createdAt: "2026-07-16T10:07:00.000Z",
    });
    const latest = verifyTrustDecisionChain(
      [first, second],
      signer.publicKey,
    )[1];
    expect(latest.status).toBe("unbenchmarked");
    expect(latest.retainedEvidence).toHaveLength(1);
    expect(latest.currentEvidence).toHaveLength(0);
    expect(() => verifyTrustDecisionChain([second], signer.publicKey)).toThrow(
      /non-contiguous/,
    );

    const forged = structuredClone(second) as SignedEnvelope<
      typeof second.payload
    >;
    forged.payload.retainedEvidence = [];
    expect(() => verifyTrustDecisionRecord(forged, signer.publicKey)).toThrow(
      /signature is invalid/,
    );
  });
});
