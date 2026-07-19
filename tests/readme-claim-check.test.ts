import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  createBenchmarkTrustEvidence,
  type BenchmarkJudgmentV1,
} from "../src/core/benchmark-trust.js";
import { signPayload } from "../src/core/signing.js";
import {
  auditDocumentedCommands,
  auditReadmeClaims,
  documentedLoadoutCommands,
  formatReadmeClaimFailures,
  runVerifierSubprocess,
} from "../scripts/check-readme-claims.mjs";

const roots: string[] = [];
const builtCli = resolve("dist/src/cli.js");

const packageJson = {
  name: "loadout-ai",
  version: "0.1.2",
  bin: { loadout: "dist/src/cli.js" },
  engines: { node: ">=20" },
  scripts: {
    test: "vitest run",
    "check:evidence": "node scripts/check-readme-claims.mjs",
  },
};

const facts = {
  catalog: { records: 50 },
  agents: { supportedNames: ["Codex"] },
  package: {
    name: packageJson.name,
    version: packageJson.version,
    bin: packageJson.bin,
  },
  runtime: { node: packageJson.engines.node },
};

const releaseIndex = {
  schemaVersion: 1 as const,
  policyVersion: "p16-17-v1" as const,
  claims: [],
  releaseBlocked: false,
  blockers: [],
};

function claim(overrides: Record<string, unknown> = {}) {
  return {
    id: "product.scope",
    section: "Introduction",
    summary: "Loadout provides a local workflow.",
    evidenceClass: "structural",
    status: "proven",
    evidence: ["evidence.txt"],
    ...overrides,
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "loadout-readme-claims-"));
  roots.push(root);
  await mkdir(join(root, "docs"), { recursive: true });
  await Promise.all([
    writeFile(join(root, "evidence.txt"), "authoritative\n", "utf8"),
    writeFile(join(root, "fake-review.json"), "{}\n", "utf8"),
    writeFile(
      join(root, "docs", "RELEASE_REVIEW.md"),
      "# Release review — 2026-07-16\n\nScope, findings, and bounded decision.\n",
      "utf8",
    ),
    writeFile(
      join(root, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
      "utf8",
    ),
  ]);
  execFileSync("git", ["init", "--quiet", root]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=README verifier fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture source",
  ]);
  const reviewedSourceCommit = execFileSync(
    "git",
    ["-C", root, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  await writeFile(
    join(root, "valid-review.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        attestation: "human-reviewed",
        claimId: "release.review",
        reviewer: "test-fixture-reviewer",
        reviewedAt: "2026-07-16T12:00:00.000Z",
        reviewedSourceCommit,
        scope: "Temporary verifier fixture only.",
        findings: ["The synthetic artifact satisfies the verifier schema."],
        decision: "approved-with-boundaries",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return root;
}

async function audit(options: {
  readme?: string;
  claims?: ReturnType<typeof claim>[];
  setup?: (root: string) => Promise<void>;
}) {
  const root = await fixture();
  await options.setup?.(root);
  return auditReadmeClaims({
    root,
    readme:
      options.readme ??
      "Install with `npm install --global loadout-ai@0.1.2`.\n",
    manifest: { schemaVersion: 1, claims: options.claims ?? [claim()] },
    packageJson,
    facts,
    releaseIndex,
    cliPath: builtCli,
  });
}

async function writeBenchmarkEvidence(
  root: string,
  options: {
    timestampMismatch?: boolean;
    protocolConformant?: boolean;
  } = {},
) {
  const sha = (character: string) => character.repeat(64);
  const commit = (character: string) => character.repeat(40);
  const campaign: BenchmarkCampaignV1 = {
    schemaVersion: 1,
    protocolVersion: BENCHMARK_PROTOCOL_VERSION,
    campaignId: "readme-verifier-fixture",
    createdAt: "2026-07-16T10:00:00.000Z",
    category: "workflow-adherence",
    fixture: {
      id: "readme-verifier-fixture",
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
  let events: BenchmarkEvidenceEventV1[] = [];
  const judgments: BenchmarkJudgmentV1[] = [];
  let tick = 0;
  const add = (payload: Parameters<typeof createBenchmarkEvidenceEvent>[3]) => {
    events = [
      ...events,
      createBenchmarkEvidenceEvent(
        campaign,
        "readme-verifier-run",
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
  for (const [index, request] of buildBenchmarkSchedule(campaign).entries()) {
    add({
      type: "request-started",
      requestId: request.requestId,
      pairIndex: request.pairIndex,
      position: request.position,
      attempt: 1,
    });
    const outputSha256 = sha(String(index % 10));
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
    if (options.protocolConformant !== false || request.pairIndex < 4)
      judgments.push({
        requestId: request.requestId,
        outputSha256,
        score: request.role === "candidate" ? 90 : 60,
        blockingSafetyFailure: false,
      });
  }
  add({ type: "run-completed" });
  const evidence = createBenchmarkTrustEvidence(
    campaign,
    events,
    judgments,
    "2026-07-16T10:04:00.000Z",
  );
  const pair = generateKeyPairSync("ed25519");
  const privateKey = pair.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const publicKey = pair.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const envelope = signPayload(
    evidence,
    privateKey,
    options.timestampMismatch ? "2026-07-16T10:05:00.000Z" : evidence.createdAt,
  );
  await Promise.all([
    writeFile(
      join(root, "benchmark-evidence.json"),
      `${JSON.stringify(envelope, null, 2)}\n`,
      "utf8",
    ),
    writeFile(join(root, "benchmark-public.pem"), publicKey, "utf8"),
  ]);
}

async function writeTimestampMismatchedBenchmarkEvidence(root: string) {
  await writeBenchmarkEvidence(root, { timestampMismatch: true });
}

async function writeNonconformantBenchmarkEvidence(root: string) {
  await writeBenchmarkEvidence(root, { protocolConformant: false });
}

async function writeSelfSignedLiveEvidence(
  root: string,
  options: { target: string; verifiedAt: string },
) {
  const pair = generateKeyPairSync("ed25519");
  const privateKey = pair.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const publicKey = pair.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const envelope = signPayload(
    {
      schemaVersion: 1,
      evidenceVersion: "loadout-live-verification-v1",
      result: "verified",
      target: options.target,
      verifiedAt: options.verifiedAt,
    },
    privateKey,
    options.verifiedAt,
  );
  await Promise.all([
    writeFile(
      join(root, "live-evidence.json"),
      `${JSON.stringify(envelope, null, 2)}\n`,
      "utf8",
    ),
    writeFile(join(root, "live-public.pem"), publicKey, "utf8"),
  ]);
}

function expectActionable(
  result: Awaited<ReturnType<typeof audit>>,
  claimId: string,
  observed: RegExp,
) {
  const failure = result.failures.find((item) => item.claimId === claimId);
  expect(failure).toMatchObject({ claimId });
  expect(failure?.observed).toMatch(observed);
  expect(failure?.authoritativeSource).toBeTruthy();
  expect(failure?.remediation).toBeTruthy();
  expect(formatReadmeClaimFailures([failure!])).toMatch(
    /Observed:.*Authoritative source:.*Remediation:/s,
  );
}

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
});

afterAll(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("README claim evidence gate", () => {
  it("rejects stale npm version wording and contradictory publication wording", async () => {
    const stale = await audit({
      readme: "Install with `npm install --global loadout-ai@0.1.1`.\n",
    });
    expectActionable(stale, "distribution.npm", /0\.1\.1/);

    const contradiction = await audit({
      readme: [
        "Loadout is available as a public npm beta.",
        "The npm package is prepared but not yet published.",
        "Install with `npm install --global loadout-ai@0.1.2`.",
      ].join("\n"),
    });
    expectActionable(
      contradiction,
      "distribution.npm",
      /both available and not published/i,
    );
  });

  it("rejects absent authoritative evidence paths", async () => {
    const result = await audit({
      claims: [claim({ evidence: ["missing-evidence.json"] })],
    });

    expectActionable(result, "product.scope", /missing-evidence\.json/);
  });

  it("rejects POSIX, Windows drive, and UNC absolute evidence paths", async () => {
    for (const path of [
      "/tmp/evidence.json",
      "C:\\evidence\\review.json",
      "C:/evidence/review.json",
      "\\\\server\\share\\review.json",
      "//server/share/review.json",
    ]) {
      const result = await audit({ claims: [claim({ evidence: [path] })] });
      expectActionable(result, "product.scope", /repository-relative path/i);
    }
  });

  it.skipIf(process.platform === "win32")(
    "rejects symlinks, non-regular files, and symlink-parent escapes",
    async () => {
      const result = await audit({
        claims: [
          claim({
            evidence: [
              "evidence-link.txt",
              "evidence-directory",
              "escape-link/outside.txt",
            ],
          }),
        ],
        setup: async (root) => {
          const outside = await mkdtemp(
            join(tmpdir(), "loadout-readme-outside-"),
          );
          roots.push(outside);
          await Promise.all([
            mkdir(join(root, "evidence-directory")),
            writeFile(join(outside, "outside.txt"), "outside\n", "utf8"),
          ]);
          await Promise.all([
            symlink("evidence.txt", join(root, "evidence-link.txt")),
            symlink(outside, join(root, "escape-link"), "dir"),
          ]);
        },
      });

      expect(result.failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            observed: expect.stringMatching(/symlink/i),
          }),
          expect.objectContaining({
            observed: expect.stringMatching(/regular file/i),
          }),
          expect.objectContaining({
            observed: expect.stringMatching(/symlink|real path|escapes/i),
          }),
        ]),
      );
    },
  );

  it("rejects duplicate manifest claim IDs", async () => {
    const result = await audit({
      claims: [claim(), claim({ summary: "A duplicate claim." })],
    });

    expectActionable(result, "product.scope", /duplicate/i);
  });

  it("rejects an unfulfilled claim presented as a current capability", async () => {
    const summary = "Loadout supports teleporting skills between machines.";
    const result = await audit({
      readme: `# Product\n\n${summary}\n\nInstall with \`npm install --global loadout-ai@0.1.2\`.\n`,
      claims: [
        claim({
          id: "future.teleportation",
          summary,
          status: "unfulfilled",
          evidence: [],
        }),
      ],
    });

    expectActionable(result, "future.teleportation", /current capability/i);
  });

  it("rejects a paraphrased unfulfilled claim presented as a current capability", async () => {
    const result = await audit({
      readme:
        "# Product\n\nLoadout currently supports teleporting skills across computers.\n\nInstall with `npm install --global loadout-ai@0.1.2`.\n",
      claims: [
        claim({
          id: "future.teleportation",
          summary: "Loadout supports teleporting skills between machines.",
          status: "unfulfilled",
          evidence: [],
        }),
      ],
    });

    expectActionable(result, "future.teleportation", /current capability/i);
  });

  it("rejects human-reviewed claims without a review artifact", async () => {
    const result = await audit({
      claims: [
        claim({
          id: "release.review",
          evidenceClass: "human-reviewed",
          status: "bounded",
          evidence: ["fake-review.json"],
        }),
      ],
    });

    expectActionable(result, "release.review", /review artifact/i);
  });

  it("accepts a complete structured human-review artifact", async () => {
    const result = await audit({
      claims: [
        claim({
          id: "release.review",
          evidenceClass: "human-reviewed",
          status: "bounded",
          evidence: ["valid-review.json"],
        }),
      ],
    });

    expect(result.failures).toEqual([]);
  });

  it("rejects a human review bound to a present but unreachable commit", async () => {
    const result = await audit({
      claims: [
        claim({
          id: "release.review",
          evidenceClass: "human-reviewed",
          status: "bounded",
          evidence: ["valid-review.json"],
        }),
      ],
      setup: async (root) => {
        const unrelatedCommit = execFileSync(
          "git",
          [
            "-C",
            root,
            "-c",
            "user.name=README verifier fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit-tree",
            "HEAD^{tree}",
            "-m",
            "unrelated source",
          ],
          { encoding: "utf8" },
        ).trim();
        const valid = JSON.parse(
          await readFile(join(root, "valid-review.json"), "utf8"),
        );
        await writeFile(
          join(root, "valid-review.json"),
          `${JSON.stringify(
            { ...valid, reviewedSourceCommit: unrelatedCommit },
            null,
            2,
          )}\n`,
          "utf8",
        );
      },
    });

    expectActionable(result, "release.review", /review artifact/i);
  });

  it("rejects human reviews with unsupported decisions, attestations, scopes, or fields", async () => {
    const invalidReviews = [
      { decision: "rejected" },
      { attestation: "self-reviewed" },
      { claimId: "different.claim" },
      { extra: "not allowed" },
      { reviewedSourceCommit: "a".repeat(39) },
      { reviewedSourceCommit: "0123456789abcdef0123456789abcdef01234567" },
    ];
    for (const override of invalidReviews) {
      const result = await audit({
        claims: [
          claim({
            id: "release.review",
            evidenceClass: "human-reviewed",
            status: "bounded",
            evidence: ["review-under-test.json"],
          }),
        ],
        setup: async (root) => {
          const valid = JSON.parse(
            await readFile(join(root, "valid-review.json"), "utf8"),
          );
          await writeFile(
            join(root, "review-under-test.json"),
            `${JSON.stringify({ ...valid, ...override }, null, 2)}\n`,
            "utf8",
          );
        },
      });
      expectActionable(result, "release.review", /review artifact/i);
    }
  });

  it("keeps human-reviewed claims bounded even with an approved decision", async () => {
    const result = await audit({
      claims: [
        claim({
          id: "release.review",
          evidenceClass: "human-reviewed",
          status: "proven",
          evidence: ["valid-review.json"],
        }),
      ],
      setup: async (root) => {
        const valid = JSON.parse(
          await readFile(join(root, "valid-review.json"), "utf8"),
        );
        await writeFile(
          join(root, "valid-review.json"),
          `${JSON.stringify({ ...valid, decision: "approved" }, null, 2)}\n`,
          "utf8",
        );
      },
    });

    expectActionable(result, "release.review", /review artifact/i);
  });

  it("rejects benchmarked claims without verifiable signed run evidence even when bounded", async () => {
    const result = await audit({
      claims: [
        claim({
          id: "benchmark.result",
          evidenceClass: "benchmarked",
          status: "bounded",
          evidence: ["evidence.txt"],
        }),
      ],
    });

    expectActionable(result, "benchmark.result", /signed run evidence/i);
  });

  it("rejects signed benchmark evidence with inconsistent envelope and payload timestamps", async () => {
    const result = await audit({
      claims: [
        claim({
          id: "benchmark.result",
          evidenceClass: "benchmarked",
          status: "bounded",
          evidence: ["benchmark-evidence.json", "benchmark-public.pem"],
        }),
      ],
      setup: writeTimestampMismatchedBenchmarkEvidence,
    });

    expectActionable(result, "benchmark.result", /signed run evidence/i);
  });

  it("rejects a signed completed benchmark run that is not protocol-conformant", async () => {
    const result = await audit({
      claims: [
        claim({
          id: "benchmark.result",
          evidenceClass: "benchmarked",
          status: "bounded",
          evidence: ["benchmark-evidence.json", "benchmark-public.pem"],
        }),
      ],
      setup: writeNonconformantBenchmarkEvidence,
    });

    expectActionable(result, "benchmark.result", /signed run evidence/i);
  });

  it("requires every live claim to remain bounded with explicit external prerequisites", async () => {
    const proven = await audit({
      claims: [
        claim({
          id: "distribution.live",
          evidenceClass: "live-verified",
          evidence: ["evidence.txt"],
        }),
      ],
    });
    expectActionable(proven, "distribution.live", /remain bounded/i);

    const unbounded = await audit({
      claims: [
        claim({
          id: "distribution.live",
          evidenceClass: "live-verified",
          status: "bounded",
          evidence: ["evidence.txt"],
        }),
      ],
    });
    expectActionable(unbounded, "distribution.live", /external prerequisite/i);

    const bounded = await audit({
      claims: [
        claim({
          id: "distribution.live",
          evidenceClass: "live-verified",
          status: "bounded",
          evidence: ["evidence.txt"],
          externalPrerequisites: ["Current registry availability"],
        }),
      ],
    });
    expect(bounded.failures).toEqual([]);
  });

  it("does not promote unrelated, stale, or future self-signed live artifacts", async () => {
    const cases = [
      {
        target: "https://registry.example/unrelated-package",
        verifiedAt: "2020-01-01T00:00:00.000Z",
      },
      {
        target: "https://registry.npmjs.org/loadout-ai",
        verifiedAt: "2020-01-01T00:00:00.000Z",
      },
      {
        target: "https://registry.npmjs.org/loadout-ai",
        verifiedAt: "2099-01-01T00:00:00.000Z",
      },
    ];
    for (const liveCase of cases) {
      const result = await audit({
        claims: [
          claim({
            id: "distribution.live",
            evidenceClass: "live-verified",
            status: "proven",
            evidence: ["live-evidence.json", "live-public.pem"],
          }),
        ],
        setup: (root) => writeSelfSignedLiveEvidence(root, liveCase),
      });
      expectActionable(result, "distribution.live", /remain bounded/i);
    }
  });

  it("rejects a documented command absent from built CLI help", async () => {
    const result = await audit({
      readme: [
        "Install with `npm install --global loadout-ai@0.1.2`.",
        "```bash",
        "loadout status && loadout candidate command-that-does-not-exist",
        "```",
      ].join("\n"),
    });

    expectActionable(
      result,
      "product.scope",
      /command-that-does-not-exist.*built CLI help/i,
    );
  });

  it("accepts nested commands reported by built subcommand help", async () => {
    const result = await audit({
      readme: [
        "Install with `npm install --global loadout-ai@0.1.2`.",
        "```bash",
        "loadout candidate inspect owner/repository --output dossier.json",
        "loadout credentials set loadout.github --stdin",
        "```",
      ].join("\n"),
    });

    expect(result.failures).toEqual([]);
  });

  it("rejects unknown options instead of mistaking their values for nested commands", async () => {
    const result = await audit({
      readme: [
        "Install with `npm install --global loadout-ai@0.1.2`.",
        "```bash",
        "loadout candidate --not-a-real-option list",
        "```",
      ].join("\n"),
    });

    expectActionable(
      result,
      "product.scope",
      /not-a-real-option.*built CLI help/i,
    );
  });

  it("extracts adjacent shell operators without splitting quoted option values", () => {
    const commands = documentedLoadoutCommands(
      [
        "```bash",
        'loadout search "skill|mcp";loadout status|loadout health&&loadout doctor||loadout versions',
        "```",
      ].join("\n"),
    );

    expect(commands).toEqual([
      "loadout doctor",
      "loadout health",
      'loadout search "skill|mcp"',
      "loadout status",
      "loadout versions",
    ]);
  });

  it("uses disposable homes for built CLI help and leaves real pending state untouched", async () => {
    const root = await fixture();
    const realState = join(root, "real-loadout-home");
    const realUser = join(root, "real-user-home");
    const pending = join(
      realState,
      "staging",
      "1234567890-aaaaaaaaaaaa",
      "transaction.json",
    );
    const userSentinel = join(realUser, "keep.txt");
    await Promise.all([
      mkdir(join(pending, ".."), { recursive: true }),
      mkdir(realUser, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(pending, "corrupt real pending state\n", "utf8"),
      writeFile(userSentinel, "real user state\n", "utf8"),
    ]);
    const previousLoadoutHome = process.env.LOADOUT_HOME;
    const previousUserHome = process.env.LOADOUT_USER_HOME;
    process.env.LOADOUT_HOME = realState;
    process.env.LOADOUT_USER_HOME = realUser;
    try {
      const failures = await auditDocumentedCommands({
        readme: "```bash\nloadout status\n```\n",
        cliPath: builtCli,
      });
      expect(failures).toEqual([]);
      expect(await readFile(pending, "utf8")).toBe(
        "corrupt real pending state\n",
      );
      expect(await readFile(userSentinel, "utf8")).toBe("real user state\n");
    } finally {
      if (previousLoadoutHome === undefined) delete process.env.LOADOUT_HOME;
      else process.env.LOADOUT_HOME = previousLoadoutHome;
      if (previousUserHome === undefined) delete process.env.LOADOUT_USER_HOME;
      else process.env.LOADOUT_USER_HOME = previousUserHome;
    }
  });

  it("times out the outer verifier subprocess with actionable diagnostics", async () => {
    const root = await fixture();
    const hangingScript = join(root, "hang.mjs");
    await writeFile(
      hangingScript,
      "await new Promise(() => undefined);\n",
      "utf8",
    );

    const result = runVerifierSubprocess({
      script: hangingScript,
      timeoutMs: 50,
      stdio: "pipe",
    });

    expect(result.status).toBe(1);
    expect(result.failure).toMatchObject({
      claimId: "verifier.runtime",
      authoritativeSource: hangingScript,
    });
    expect(result.failure?.observed).toMatch(/exceeded.*50 ms/i);
    expect(result.failure?.remediation).toMatch(/timeout|stuck/i);
  });
});
