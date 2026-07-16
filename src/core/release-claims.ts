import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ReleaseClaimStatus = "supported" | "bounded" | "not-established";

export interface ReleaseClaim {
  id: string;
  status: ReleaseClaimStatus;
  statement: string;
  boundary: string;
  evidence: {
    files: string[];
    commands: string[];
    sources: string[];
  };
}

export interface ReleaseEvidenceIndex {
  schemaVersion: 1;
  policyVersion: "p16-17-v1";
  claims: ReleaseClaim[];
  releaseBlocked: boolean;
  blockers: string[];
}

export const RELEASE_CLAIMS: readonly ReleaseClaim[] = [
  {
    id: "catalog-immutable-attribution",
    status: "supported",
    statement:
      "The bundled catalog records immutable Git commits and upstream credit links.",
    boundary:
      "A pin proves source identity; it does not prove safety, license permission, usefulness, or future compatibility.",
    evidence: {
      files: [
        "catalog/packages.json",
        "docs/CATALOG.md",
        "scripts/check-catalog-attribution.mjs",
      ],
      commands: ["npm run check:evidence"],
      sources: [],
    },
  },
  {
    id: "stable-bounded-profile",
    status: "bounded",
    statement:
      "Stable selects 30 skill directories from four pinned SPDX-identified sources.",
    boundary:
      "Recommended means the bounded Loadout policy default, not universal task superiority.",
    evidence: {
      files: [
        "src/core/profiles.ts",
        "tests/profiles.test.ts",
        "tests/catalog-install.test.ts",
      ],
      commands: ["npm test -- --run"],
      sources: [],
    },
  },
  {
    id: "transactional-managed-mutations",
    status: "bounded",
    statement:
      "Managed installation batches use snapshot-backed filesystem transactions and rollback.",
    boundary:
      "This is not database-grade power-loss durability and never authorizes mutation of unmanaged content.",
    evidence: {
      files: [
        "src/core/transaction.ts",
        "src/core/snapshot.ts",
        "tests/transaction.test.ts",
        "tests/snapshot.test.ts",
        "tests/native-filesystem-smoke.test.ts",
      ],
      commands: ["npm run test:e2e:cli"],
      sources: [],
    },
  },
  {
    id: "daily-read-only-autopilot",
    status: "bounded",
    statement:
      "Autopilot schedules read-only discovery and update checks on supported native schedulers.",
    boundary:
      "Scheduled jobs do not install, promote, execute, or update candidate content.",
    evidence: {
      files: ["src/core/scheduler.ts", "tests/scheduler.test.ts"],
      commands: ["npm test -- --run tests/scheduler.test.ts"],
      sources: [],
    },
  },
  {
    id: "benchmark-performance-evidence",
    status: "not-established",
    statement:
      "Loadout has a deterministic evaluation protocol and model-free campaign planner.",
    boundary:
      "No bundled source is benchmarked until isolated real trials, signed evidence, and human promotion approval exist.",
    evidence: {
      files: [
        "docs/EVALUATION_PROTOCOL_V1.md",
        "src/core/benchmark-campaign.ts",
        "tests/benchmark-campaign.test.ts",
        "tests/benchmark-cli.test.ts",
      ],
      commands: [
        "npm test -- --run tests/benchmark-campaign.test.ts tests/benchmark-cli.test.ts",
      ],
      sources: [],
    },
  },
  {
    id: "privacy-safe-sharing",
    status: "bounded",
    statement:
      "Cards, reports, comparisons, and badges expose aggregate local evidence without project content or credentials.",
    boundary:
      "Users must review generated artifacts before sharing; scores do not establish universal quality.",
    evidence: {
      files: [
        "src/core/share-report.ts",
        "src/core/loadout-card.ts",
        "src/core/loadout-badge.ts",
        "tests/share-report.test.ts",
        "tests/loadout-card.test.ts",
        "tests/loadout-badge.test.ts",
      ],
      commands: ["npm test -- --run"],
      sources: [],
    },
  },
] as const;

export function releaseEvidenceRoot(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDirectory, "..", ".."),
    join(moduleDirectory, "..", "..", ".."),
    process.cwd(),
  ];
  return (
    candidates.find((candidate) => existsSync(join(candidate, "README.md"))) ??
    candidates[0]
  );
}

const FORBIDDEN_PUBLIC_CLAIMS = [
  /\buniversally best\b/i,
  /\bguaranteed safe\b/i,
  /\bzero[- ]risk\b/i,
  /\bperfect(?:ly)? compatible\b/i,
  /\bproves? task improvement\b/i,
  /\bevery (?:skill|repository) is (?:safe|reviewed|benchmarked)\b/i,
];

function portableEvidencePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").includes("..")
  );
}

export async function auditReleaseClaims(options: {
  root: string;
  readme: string;
  catalogCount: number;
  claims?: readonly ReleaseClaim[];
  verifyEvidenceFiles?: boolean;
}): Promise<ReleaseEvidenceIndex> {
  const claims = [...(options.claims ?? RELEASE_CLAIMS)];
  const blockers: string[] = [];
  const ids = new Set<string>();
  for (const claim of claims) {
    if (ids.has(claim.id)) blockers.push(`duplicate claim id: ${claim.id}`);
    ids.add(claim.id);
    if (!claim.statement.trim() || !claim.boundary.trim())
      blockers.push(`claim ${claim.id} lacks statement or boundary`);
    if (!claim.evidence.files.length)
      blockers.push(`claim ${claim.id} has no evidence files`);
    for (const path of claim.evidence.files) {
      if (!portableEvidencePath(path)) {
        blockers.push(`claim ${claim.id} has unsafe evidence path: ${path}`);
        continue;
      }
      if (options.verifyEvidenceFiles !== false)
        try {
          await access(resolve(options.root, path));
        } catch {
          blockers.push(`claim ${claim.id} evidence is missing: ${path}`);
        }
    }
  }
  for (const pattern of FORBIDDEN_PUBLIC_CLAIMS)
    if (pattern.test(options.readme))
      blockers.push(`README contains forbidden release claim: ${pattern}`);
  const catalogPhrase = `${options.catalogCount} credited public repositories`;
  if (!options.readme.includes(catalogPhrase))
    blockers.push(
      `README catalog count is stale or missing; expected '${catalogPhrase}'`,
    );
  if (
    !/does not claim there is one universally [“"]best[”"] configuration/i.test(
      options.readme,
    )
  )
    blockers.push("README lacks the universal-best claim boundary");
  if (!/no bundled source is called benchmarked/i.test(options.readme))
    blockers.push("README lacks the no-bundled-benchmark-evidence boundary");
  return {
    schemaVersion: 1,
    policyVersion: "p16-17-v1",
    claims,
    releaseBlocked: blockers.length > 0,
    blockers,
  };
}

export function formatReleaseEvidenceIndex(
  index: ReleaseEvidenceIndex,
): string {
  return [
    `Release claim gate: ${index.releaseBlocked ? "BLOCKED" : "PASS"} (${index.claims.length} claim(s))`,
    ...index.claims.map(
      (claim) =>
        `${claim.status === "supported" ? "✓" : claim.status === "bounded" ? "△" : "○"} ${claim.id} — ${claim.statement}\n  Boundary: ${claim.boundary}`,
    ),
    ...index.blockers.map((blocker) => `BLOCKER: ${blocker}`),
  ].join("\n");
}
