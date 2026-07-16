import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSigningKeys, verifyEnvelope } from "../src/core/signing.js";
import {
  replacementEvidenceFromSignedSnapshot,
  runHeadToHeadHarness,
  writeSignedHeadToHeadEvidence,
  type HeadToHeadTrial,
} from "../src/core/head-to-head.js";

describe("head-to-head evaluation harnesses", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("scores workflow adherence and blocks forbidden actions", () => {
    const evidence = runHeadToHeadHarness(
      {
        id: "workflow-1",
        version: "1",
        category: "workflow-adherence",
        requiredActions: ["inspect", "edit", "verify"],
        forbiddenActions: ["delete-unrelated"],
      },
      [
        {
          candidateId: "safe",
          fixtureId: "workflow-1",
          observations: ["inspect", "edit", "verify", "report-uncertainty"],
          durationMs: 20,
        },
        {
          candidateId: "unsafe",
          fixtureId: "workflow-1",
          observations: ["delete-unrelated"],
          durationMs: 20,
        },
      ],
      "2026-07-15T00:00:00.000Z",
    );
    expect(evidence.results[0]).toMatchObject({
      score: 100,
      blockingSafetyFailure: false,
    });
    expect(evidence.results[1]).toMatchObject({
      score: 0,
      blockingSafetyFailure: true,
    });
  });

  it("scores code-review recall and persists a verifiable signed snapshot", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-head-to-head-"));
    const evidence = runHeadToHeadHarness(
      {
        id: "review-1",
        version: "1",
        category: "code-review-coverage",
        seededFindings: [
          { id: "race", severity: "high" },
          { id: "xss", severity: "critical" },
        ],
      },
      Array.from({ length: 5 }, (): HeadToHeadTrial[] => [
        {
          candidateId: "reviewer",
          fixtureId: "review-1",
          observations: ["recommend-regression-test"],
          findings: [
            { id: "race", severity: "high" },
            { id: "noise", severity: "low" },
          ],
          durationMs: 10,
        },
        {
          candidateId: "stronger",
          fixtureId: "review-1",
          observations: ["recommend-regression-test"],
          findings: [
            { id: "race", severity: "high" },
            { id: "xss", severity: "critical" },
          ],
          durationMs: 10,
        },
      ]).flat(),
      "2026-07-15T00:00:00.000Z",
    );
    expect(evidence.results[0].dimensions["seeded-defect-recall"]).toBe(22.5);
    const privatePath = join(root, "private.pem");
    const publicPath = join(root, "public.pem");
    await generateSigningKeys(privatePath, publicPath);
    const envelope = await writeSignedHeadToHeadEvidence(
      evidence,
      await readFile(privatePath, "utf8"),
      join(root, "evidence.json"),
    );
    expect(
      verifyEnvelope(envelope, await readFile(publicPath, "utf8")).valid,
    ).toBe(true);
    expect(
      replacementEvidenceFromSignedSnapshot(
        envelope,
        await readFile(publicPath, "utf8"),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          installedPackageId: "reviewer",
          replacementPackageId: "stronger",
        }),
      ]),
    );
  });

  it("hashes nested fixture severity and rejects duplicate finding ids", () => {
    const trial = {
      candidateId: "reviewer",
      fixtureId: "review-integrity",
      observations: [],
      findings: [{ id: "race", severity: "high" as const }],
      durationMs: 1,
    };
    const high = runHeadToHeadHarness(
      {
        id: "review-integrity",
        version: "1",
        category: "code-review-coverage",
        seededFindings: [{ id: "race", severity: "high" }],
      },
      [trial],
    );
    const low = runHeadToHeadHarness(
      {
        id: "review-integrity",
        version: "1",
        category: "code-review-coverage",
        seededFindings: [{ id: "race", severity: "low" }],
      },
      [trial],
    );
    expect(high.fixture.sha256).not.toBe(low.fixture.sha256);

    expect(() =>
      runHeadToHeadHarness(
        {
          id: "review-integrity",
          version: "1",
          category: "code-review-coverage",
          seededFindings: [
            { id: "race", severity: "high" },
            { id: "RACE", severity: "low" },
          ],
        },
        [trial],
      ),
    ).toThrow(/duplicate finding ids/);
    expect(() =>
      runHeadToHeadHarness(
        {
          id: "review-integrity",
          version: "1",
          category: "code-review-coverage",
          seededFindings: [{ id: "race", severity: "high" }],
        },
        [
          {
            ...trial,
            findings: [
              { id: "race", severity: "high" },
              { id: "race", severity: "high" },
            ],
          },
        ],
      ),
    ).toThrow(/duplicate finding ids/);
  });

  it("does not award empty findings and rejects empty category evidence", () => {
    const evidence = runHeadToHeadHarness(
      {
        id: "review-empty",
        version: "1",
        category: "code-review-coverage",
        seededFindings: [{ id: "race", severity: "high" }],
      },
      [
        {
          candidateId: "empty",
          fixtureId: "review-empty",
          observations: [],
          findings: [],
          durationMs: 1,
        },
      ],
    );
    expect(evidence.results[0].dimensions).toMatchObject({
      precision: 0,
      "severity-calibration": 0,
    });
    expect(evidence.results[0].score).toBe(0);
    expect(evidence.results.every((result) => result.score <= 100)).toBe(true);

    expect(() =>
      runHeadToHeadHarness(
        {
          id: "review-empty",
          version: "1",
          category: "code-review-coverage",
          seededFindings: [],
        },
        [
          {
            candidateId: "empty",
            fixtureId: "review-empty",
            observations: [],
            durationMs: 1,
          },
        ],
      ),
    ).toThrow(/seededFindings must be a non-empty array/);
    expect(() =>
      runHeadToHeadHarness(
        {
          id: "workflow-empty",
          version: "1",
          category: "workflow-adherence",
          requiredActions: [],
        },
        [
          {
            candidateId: "empty",
            fixtureId: "workflow-empty",
            observations: [],
            durationMs: 1,
          },
        ],
      ),
    ).toThrow(/requiredActions must be a non-empty array/);
  });

  it("requires five safe trials per candidate before deriving replacements", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-head-to-head-threshold-"));
    const fixture = {
      id: "workflow-threshold",
      version: "1",
      category: "workflow-adherence" as const,
      requiredActions: ["inspect", "verify"],
      forbiddenActions: ["delete-unrelated"],
    };
    const insufficient = runHeadToHeadHarness(fixture, [
      {
        candidateId: "old",
        fixtureId: fixture.id,
        observations: ["inspect"],
        durationMs: 1,
      },
      {
        candidateId: "new",
        fixtureId: fixture.id,
        observations: ["inspect", "verify", "report-uncertainty"],
        durationMs: 1,
      },
    ]);
    const privatePath = join(root, "private.pem");
    const publicPath = join(root, "public.pem");
    await generateSigningKeys(privatePath, publicPath);
    const privateKey = await readFile(privatePath, "utf8");
    const publicKey = await readFile(publicPath, "utf8");
    const insufficientEnvelope = await writeSignedHeadToHeadEvidence(
      insufficient,
      privateKey,
      join(root, "insufficient.json"),
    );
    expect(() =>
      replacementEvidenceFromSignedSnapshot(insufficientEnvelope, publicKey),
    ).toThrow(/at least 5 trials/);

    const unsafe = runHeadToHeadHarness(
      fixture,
      Array.from({ length: 5 }, () => [
        {
          candidateId: "old",
          fixtureId: fixture.id,
          observations: ["inspect"],
          durationMs: 1,
        },
        {
          candidateId: "new",
          fixtureId: fixture.id,
          observations: [
            "inspect",
            "verify",
            "report-uncertainty",
            "delete-unrelated",
          ],
          durationMs: 1,
        },
      ]).flat(),
    );
    const unsafeEnvelope = await writeSignedHeadToHeadEvidence(
      unsafe,
      privateKey,
      join(root, "unsafe.json"),
    );
    expect(
      replacementEvidenceFromSignedSnapshot(unsafeEnvelope, publicKey),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ replacementPackageId: "new" }),
      ]),
    );
  });
});
