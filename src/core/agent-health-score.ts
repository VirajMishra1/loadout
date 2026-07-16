import type {
  AgentId,
  ComponentCompatibility,
  ComponentType,
} from "../shared/types.js";
import type { LocalOutcomeEvent, OutcomeResult } from "./outcomes.js";

export const AGENT_HEALTH_POLICY_VERSION = "p16-07-v1" as const;

export const AGENT_HEALTH_DIMENSION_CAPS = {
  "provenance-license": 14,
  "static-risk": 12,
  drift: 14,
  duplicates: 8,
  staleness: 8,
  "active-set-capacity": 10,
  compatibility: 10,
  benchmarks: 8,
  "local-outcomes": 8,
  recoverability: 8,
} as const;

export type AgentHealthDimensionId = keyof typeof AGENT_HEALTH_DIMENSION_CAPS;
export type AgentHealthDimensionStatus =
  "unknown" | "critical" | "attention" | "strong";
export type AgentHealthRating =
  "unknown" | "critical" | "attention" | "good" | "excellent";

export interface AgentHealthPackageEvidence {
  packageId: string;
  /** Verified means a pinned reviewed source; managed is ownership evidence only. */
  provenance?: "verified" | "managed" | "unverified";
  /** SPDX identifier observed in stored metadata; NOASSERTION is explicit uncertainty. */
  license?: string;
  staticRisk?: {
    status: "clear" | "warning" | "blocking";
    findingCount: number;
  };
  freshness?: {
    status: "fresh" | "aging" | "stale";
    ageDays?: number;
  };
  benchmark?: {
    passed: number;
    failed: number;
    evidenceIds: string[];
  };
}

export interface AgentHealthEvidence {
  agent: AgentId;
  /** Caller-supplied observation time; scoring never reads the wall clock. */
  asOf?: string;
  packages: AgentHealthPackageEvidence[];
  drift?: {
    checkedFiles: number;
    driftedFiles: number;
    checkedMcpServers: number;
    driftedMcpServers: number;
  };
  duplicates?: {
    scannedSkills: number;
    withinAgentGroups: number;
    duplicateSkills: number;
  };
  activeSet?: {
    active: number;
    capacity: number;
    disabled: number;
    quarantined: number;
  };
  compatibility?: Array<{
    component: ComponentType;
    compatibility: ComponentCompatibility | "unknown";
  }>;
  /** Raw local-only events are filtered to the scored agent. */
  outcomes?: LocalOutcomeEvent[];
  recoverability?: {
    protectedMutations: number;
    recoverableMutations: number;
    readableSnapshots: number;
    corruptSnapshots: number;
    pendingTransactions: number;
  };
}

export interface AgentHealthDimension {
  id: AgentHealthDimensionId;
  label: string;
  cap: number;
  contribution: number;
  status: AgentHealthDimensionStatus;
  evidence: string[];
  uncertainty: string[];
  remediation: string[];
}

export interface AgentHealthScore {
  schemaVersion: 1;
  policyVersion: typeof AGENT_HEALTH_POLICY_VERSION;
  agent: AgentId;
  asOf?: string;
  score: number;
  maximumScore: 100;
  rating: AgentHealthRating;
  evidenceCoverage: number;
  knownDimensions: number;
  dimensions: AgentHealthDimension[];
  limitations: string[];
}

const DIMENSION_LABELS: Record<AgentHealthDimensionId, string> = {
  "provenance-license": "Provenance and license",
  "static-risk": "Static risk",
  drift: "Managed-file drift",
  duplicates: "Duplicate skills",
  staleness: "Source freshness",
  "active-set-capacity": "Active-set capacity",
  compatibility: "Agent compatibility",
  benchmarks: "Benchmark evidence",
  "local-outcomes": "Local outcomes",
  recoverability: "Recoverability",
};

const DIMENSION_ORDER = Object.keys(
  AGENT_HEALTH_DIMENSION_CAPS,
) as AgentHealthDimensionId[];

function round(value: number): number {
  return Number(value.toFixed(2));
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function count(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative safe integer`);
  return value;
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length)
    throw new Error(`${label} contains duplicate values`);
}

function statusFor(
  contribution: number,
  cap: number,
  known: boolean,
): AgentHealthDimensionStatus {
  if (!known) return "unknown";
  const ratio = contribution / cap;
  if (ratio >= 0.8) return "strong";
  if (ratio >= 0.4) return "attention";
  return "critical";
}

function dimension(
  id: AgentHealthDimensionId,
  ratio: number,
  known: boolean,
  evidence: string[],
  uncertainty: string[],
  remediation: string[],
): AgentHealthDimension {
  const cap = AGENT_HEALTH_DIMENSION_CAPS[id];
  const contribution = round(cap * clamp(ratio));
  return {
    id,
    label: DIMENSION_LABELS[id],
    cap,
    contribution,
    status: statusFor(contribution, cap, known),
    evidence: evidence.length
      ? evidence
      : [
          `No stored local evidence is available for ${DIMENSION_LABELS[id].toLowerCase()}.`,
        ],
    uncertainty: uncertainty.length
      ? uncertainty
      : [
          "Local evidence is point-in-time and does not guarantee future behavior.",
        ],
    remediation: remediation.length
      ? remediation
      : ["Refresh this evidence after the agent configuration changes."],
  };
}

function assertedLicense(value: string | undefined): boolean {
  return Boolean(value?.trim() && value.trim().toUpperCase() !== "NOASSERTION");
}

function provenanceAndLicense(
  packages: AgentHealthPackageEvidence[],
): AgentHealthDimension {
  if (!packages.length)
    return dimension(
      "provenance-license",
      0,
      false,
      [],
      [
        "No installed package exists to match against pinned provenance or license metadata.",
      ],
      [
        "Install or adopt a package, then refresh reviewed provenance and SPDX license evidence.",
      ],
    );
  const provenanceValue = { verified: 1, managed: 0.5, unverified: 0 } as const;
  const verified = packages.filter(
    (item) => item.provenance === "verified",
  ).length;
  const managed = packages.filter(
    (item) => item.provenance === "managed",
  ).length;
  const asserted = packages.filter((item) =>
    assertedLicense(item.license),
  ).length;
  const unknownProvenance = packages.filter(
    (item) => item.provenance === undefined || item.provenance === "unverified",
  ).length;
  const unknownLicense = packages.length - asserted;
  const ratio =
    packages.reduce(
      (total, item) =>
        total +
        ((item.provenance ? provenanceValue[item.provenance] : 0) +
          (assertedLicense(item.license) ? 1 : 0)) /
          2,
      0,
    ) / packages.length;
  return dimension(
    "provenance-license",
    ratio,
    true,
    [
      `${verified}/${packages.length} package(s) have pinned reviewed provenance; ${managed} have Loadout ownership evidence only.`,
      `${asserted}/${packages.length} package(s) have an asserted SPDX license; NOASSERTION and absence receive no credit.`,
    ],
    [
      unknownProvenance
        ? `${unknownProvenance} package(s) lack verified pinned provenance.`
        : "Pinned provenance proves source identity, not runtime safety or usefulness.",
      unknownLicense
        ? `${unknownLicense} package(s) lack an asserted license.`
        : "License metadata is not a legal opinion and must remain attributable to its source.",
    ],
    ratio === 1
      ? [
          "Re-verify pins and license metadata whenever a package revision changes.",
        ]
      : [
          "Review unverified sources and resolve missing or NOASSERTION licenses before promotion.",
        ],
  );
}

function staticRisk(
  packages: AgentHealthPackageEvidence[],
): AgentHealthDimension {
  if (!packages.length)
    return dimension(
      "static-risk",
      0,
      false,
      [],
      ["No package exists to assess statically."],
      [
        "Run static inspection after packages are selected; do not infer safety from an empty profile.",
      ],
    );
  const assessed = packages.filter((item) => item.staticRisk !== undefined);
  for (const item of assessed)
    count(
      item.staticRisk!.findingCount,
      `${item.packageId} static risk findings`,
    );
  const weights = { clear: 1, warning: 0.5, blocking: 0 } as const;
  const ratio =
    assessed.reduce(
      (total, item) => total + weights[item.staticRisk!.status],
      0,
    ) / packages.length;
  const blocking = assessed.filter(
    (item) => item.staticRisk!.status === "blocking",
  ).length;
  const warnings = assessed.filter(
    (item) => item.staticRisk!.status === "warning",
  ).length;
  const missing = packages.length - assessed.length;
  return dimension(
    "static-risk",
    ratio,
    assessed.length > 0,
    [
      `${assessed.length}/${packages.length} package(s) have stored static analysis: ${blocking} blocking, ${warnings} warning, ${assessed.length - blocking - warnings} clear.`,
      `${assessed.reduce((total, item) => total + item.staticRisk!.findingCount, 0)} finding(s) are retained as review evidence.`,
    ],
    [
      missing
        ? `${missing} package(s) have no stored static assessment and receive no credit.`
        : "Static inspection does not execute code or prove runtime behavior.",
    ],
    blocking
      ? [
          "Keep blocking packages quarantined until each finding is reviewed and explicitly resolved.",
        ]
      : warnings || missing
        ? ["Review warnings and statically assess every unassessed package."]
        : [
            "Re-run static analysis after every source or configuration change.",
          ],
  );
}

function driftScore(
  evidence: AgentHealthEvidence["drift"],
): AgentHealthDimension {
  if (!evidence)
    return dimension(
      "drift",
      0,
      false,
      [],
      ["Managed file and MCP fingerprints have not been checked."],
      ["Run a local managed-file and MCP fingerprint check."],
    );
  const checkedFiles = count(evidence.checkedFiles, "checked files");
  const driftedFiles = count(evidence.driftedFiles, "drifted files");
  const checkedMcp = count(evidence.checkedMcpServers, "checked MCP servers");
  const driftedMcp = count(evidence.driftedMcpServers, "drifted MCP servers");
  if (driftedFiles > checkedFiles || driftedMcp > checkedMcp)
    throw new Error("Drifted items cannot exceed checked items");
  const checked = checkedFiles + checkedMcp;
  const drifted = driftedFiles + driftedMcp;
  return dimension(
    "drift",
    checked ? (checked - drifted) / checked : 0,
    checked > 0,
    checked
      ? [
          `${checkedFiles} managed file(s) and ${checkedMcp} MCP server(s) checked; ${drifted} total drift finding(s).`,
        ]
      : [],
    [
      checked
        ? "Fingerprints show byte/config equality only; they do not measure behavior."
        : "A completed check with zero managed items is not positive integrity evidence.",
    ],
    drifted
      ? [
          "Review drift, then reinstall, resynchronize, remove, or explicitly adopt the changed content.",
        ]
      : [
          "Repeat fingerprint checks after external tools or agents change managed paths.",
        ],
  );
}

function duplicateScore(
  evidence: AgentHealthEvidence["duplicates"],
): AgentHealthDimension {
  if (!evidence)
    return dimension(
      "duplicates",
      0,
      false,
      [],
      [
        "No local skill inventory has been scanned for within-agent duplicates.",
      ],
      [
        "Scan the active agent skill inventory and group normalized duplicate names.",
      ],
    );
  const scanned = count(evidence.scannedSkills, "scanned skills");
  const groups = count(evidence.withinAgentGroups, "duplicate groups");
  const duplicates = count(evidence.duplicateSkills, "duplicate skills");
  if (duplicates > scanned)
    throw new Error("Duplicate skills cannot exceed scanned skills");
  if ((groups === 0) !== (duplicates === 0))
    throw new Error(
      "Duplicate groups and duplicate skills must agree on whether duplicates exist",
    );
  return dimension(
    "duplicates",
    scanned ? (scanned - duplicates) / scanned : 0,
    scanned > 0,
    scanned
      ? [
          `${scanned} skill(s) scanned; ${groups} within-agent group(s) contain ${duplicates} duplicate skill entries.`,
        ]
      : [],
    [
      scanned
        ? "Name overlap is a conflict signal; it does not prove semantic equivalence."
        : "An empty inventory provides no evidence that duplicate guidance is absent.",
    ],
    duplicates
      ? [
          "Compare duplicate groups and disable or remove redundant active skills after review.",
        ]
      : ["Re-scan after installing, enabling, or renaming skills."],
  );
}

function staleness(
  packages: AgentHealthPackageEvidence[],
): AgentHealthDimension {
  if (!packages.length)
    return dimension(
      "staleness",
      0,
      false,
      [],
      ["No package activity metadata exists."],
      [
        "Refresh source activity after packages are installed; empty does not mean fresh.",
      ],
    );
  const assessed = packages.filter((item) => item.freshness !== undefined);
  const weights = { fresh: 1, aging: 0.5, stale: 0 } as const;
  const ratio =
    assessed.reduce(
      (total, item) => total + weights[item.freshness!.status],
      0,
    ) / packages.length;
  const counts = {
    fresh: assessed.filter((item) => item.freshness!.status === "fresh").length,
    aging: assessed.filter((item) => item.freshness!.status === "aging").length,
    stale: assessed.filter((item) => item.freshness!.status === "stale").length,
  };
  for (const item of assessed)
    if (item.freshness!.ageDays !== undefined)
      count(item.freshness!.ageDays!, `${item.packageId} freshness age`);
  const missing = packages.length - assessed.length;
  return dimension(
    "staleness",
    ratio,
    assessed.length > 0,
    [
      `${assessed.length}/${packages.length} package(s) have stored activity evidence: ${counts.fresh} fresh, ${counts.aging} aging, ${counts.stale} stale.`,
    ],
    [
      missing
        ? `${missing} package(s) have no activity observation and receive no freshness credit.`
        : "Repository activity is a maintenance signal, not proof of quality or compatibility.",
    ],
    counts.stale || missing
      ? [
          "Refresh missing activity and compare stale or archived packages with reviewed alternatives.",
        ]
      : [
          "Refresh activity metadata periodically; aging thresholds remain disclosed heuristics.",
        ],
  );
}

function activeSetCapacity(
  evidence: AgentHealthEvidence["activeSet"],
): AgentHealthDimension {
  if (!evidence)
    return dimension(
      "active-set-capacity",
      0,
      false,
      [],
      ["No active-set count or configured capacity was supplied."],
      [
        "Scan the agent and compare active skills with the disclosed capacity policy.",
      ],
    );
  const active = count(evidence.active, "active skills");
  const capacity = count(evidence.capacity, "active-set capacity");
  const disabled = count(evidence.disabled, "disabled skills");
  const quarantined = count(evidence.quarantined, "quarantined skills");
  if (capacity === 0)
    throw new Error("Active-set capacity must be greater than zero");
  const ratio = active <= capacity ? 1 : capacity / active;
  return dimension(
    "active-set-capacity",
    ratio,
    true,
    [
      `${active}/${capacity} active skill slot(s) used; ${disabled} disabled and ${quarantined} quarantined.`,
    ],
    [
      "Capacity is a transparent context-load heuristic, not a universal model limit.",
    ],
    active > capacity
      ? [
          `Disable or consolidate at least ${active - capacity} active skill(s), prioritizing duplicates and weak evidence.`,
        ]
      : [
          "Keep nonessential packages in the reviewed library and re-check capacity after activation changes.",
        ],
  );
}

function compatibility(
  evidence: AgentHealthEvidence["compatibility"],
): AgentHealthDimension {
  if (!evidence?.length)
    return dimension(
      "compatibility",
      0,
      false,
      [],
      ["No installed component has stored adapter compatibility evidence."],
      ["Map every active component to the reviewed adapter capability matrix."],
    );
  const weights = {
    native: 1,
    adapted: 0.75,
    unsupported: 0,
    unknown: 0,
  } as const;
  const counts = {
    native: evidence.filter((item) => item.compatibility === "native").length,
    adapted: evidence.filter((item) => item.compatibility === "adapted").length,
    unsupported: evidence.filter((item) => item.compatibility === "unsupported")
      .length,
    unknown: evidence.filter((item) => item.compatibility === "unknown").length,
  };
  const ratio =
    evidence.reduce((total, item) => total + weights[item.compatibility], 0) /
    evidence.length;
  return dimension(
    "compatibility",
    ratio,
    true,
    [
      `${evidence.length} component(s) evaluated: ${counts.native} native, ${counts.adapted} adapted, ${counts.unsupported} unsupported, ${counts.unknown} unknown.`,
    ],
    [
      counts.adapted
        ? `${counts.adapted} adapted component(s) depend on bounded conversion/configuration behavior.`
        : "Compatibility declares supported layout/configuration behavior, not runtime usefulness.",
      ...(counts.unknown
        ? [`${counts.unknown} unknown component(s) receive no credit.`]
        : []),
    ],
    counts.unsupported || counts.unknown
      ? [
          "Disable unsupported components and gather official path/config evidence before adding adapter support.",
        ]
      : ["Re-run compatibility checks after agent or adapter upgrades."],
  );
}

function benchmarks(
  packages: AgentHealthPackageEvidence[],
): AgentHealthDimension {
  if (!packages.length)
    return dimension(
      "benchmarks",
      0,
      false,
      [],
      ["No package exists to benchmark."],
      [
        "Store reproducible package/task benchmark results after selecting packages.",
      ],
    );
  const assessed: AgentHealthPackageEvidence[] = [];
  let passed = 0;
  let failed = 0;
  const evidenceIds: string[] = [];
  for (const item of packages) {
    if (!item.benchmark) continue;
    const packagePassed = count(
      item.benchmark.passed,
      `${item.packageId} passed benchmarks`,
    );
    const packageFailed = count(
      item.benchmark.failed,
      `${item.packageId} failed benchmarks`,
    );
    assertUnique(
      item.benchmark.evidenceIds,
      `${item.packageId} benchmark evidence`,
    );
    if (item.benchmark.evidenceIds.some((id) => !id.trim()))
      throw new Error(
        `${item.packageId} benchmark evidence ids must not be empty`,
      );
    if (
      packagePassed + packageFailed === 0 ||
      item.benchmark.evidenceIds.length === 0
    )
      continue;
    assessed.push(item);
    passed += packagePassed;
    failed += packageFailed;
    evidenceIds.push(...item.benchmark.evidenceIds);
  }
  assertUnique(evidenceIds, "benchmark evidence ids");
  const runs = passed + failed;
  const coverage = assessed.length / packages.length;
  const ratio = runs ? coverage * (passed / runs) : 0;
  const missing = packages.length - assessed.length;
  return dimension(
    "benchmarks",
    ratio,
    runs > 0,
    runs
      ? [
          `${passed}/${runs} stored benchmark run(s) passed across ${assessed.length}/${packages.length} package(s); ${evidenceIds.length} evidence id(s).`,
        ]
      : [],
    [
      missing
        ? `${missing} package(s) have no benchmark run and receive no credit.`
        : "Stored benchmarks cover declared fixtures only and do not prove universal model quality.",
    ],
    failed || missing
      ? [
          "Run reproducible agent/task fixtures for missing packages and investigate every failure before promotion.",
        ]
      : ["Re-run the same fixtures after package, model, or agent changes."],
  );
}

const OUTCOME_VALUES: Record<OutcomeResult, number> = {
  accept: 1,
  success: 1,
  activation: 0.6,
  disable: 0.25,
  reject: 0,
  failure: 0,
  rollback: 0,
};
const FULL_OUTCOME_SAMPLE = 10;

function localOutcomes(
  agent: AgentId,
  evidence: AgentHealthEvidence["outcomes"],
): AgentHealthDimension {
  const events = (evidence ?? []).filter((event) => event.agent === agent);
  if (!events.length)
    return dimension(
      "local-outcomes",
      0,
      false,
      [],
      [
        "No local-only outcome event exists for this agent; absence is not success.",
      ],
      [
        "Record accept/reject, success/failure, activation/disable, and rollback outcomes without project content.",
      ],
    );
  assertUnique(
    events.map((event) => event.id),
    "local outcome event ids",
  );
  const quality =
    events.reduce((total, event) => total + OUTCOME_VALUES[event.result], 0) /
    events.length;
  const sampleConfidence = Math.min(1, events.length / FULL_OUTCOME_SAMPLE);
  const negative = events.filter((event) =>
    ["reject", "failure", "rollback"].includes(event.result),
  ).length;
  return dimension(
    "local-outcomes",
    quality * sampleConfidence,
    true,
    [
      `${events.length} local-only event(s) for ${agent}; ${negative} rejection/failure/rollback outcome(s); sample confidence ${round(sampleConfidence * 100)}%.`,
    ],
    [
      events.length < FULL_OUTCOME_SAMPLE
        ? `${FULL_OUTCOME_SAMPLE - events.length} more scoped event(s) are required for full sample confidence.`
        : "Outcomes are user/device-specific and do not establish causal improvement.",
    ],
    negative
      ? [
          "Inspect packages associated with negative outcomes; compare, disable, or roll back when evidence supports it.",
        ]
      : [
          "Keep recording privacy-safe outcomes across task families to reduce sampling uncertainty.",
        ],
  );
}

function recoverability(
  evidence: AgentHealthEvidence["recoverability"],
): AgentHealthDimension {
  if (!evidence)
    return dimension(
      "recoverability",
      0,
      false,
      [],
      ["No local transaction/snapshot recovery check is stored."],
      [
        "Verify transaction coverage, readable snapshots, and pending-journal recovery.",
      ],
    );
  const protectedMutations = count(
    evidence.protectedMutations,
    "protected mutations",
  );
  const recoverableMutations = count(
    evidence.recoverableMutations,
    "recoverable mutations",
  );
  const readableSnapshots = count(
    evidence.readableSnapshots,
    "readable snapshots",
  );
  const corruptSnapshots = count(
    evidence.corruptSnapshots,
    "corrupt snapshots",
  );
  const pending = count(evidence.pendingTransactions, "pending transactions");
  if (recoverableMutations > protectedMutations)
    throw new Error("Recoverable mutations cannot exceed protected mutations");
  const snapshots = readableSnapshots + corruptSnapshots;
  const mutationRatio = protectedMutations
    ? recoverableMutations / protectedMutations
    : 0;
  const snapshotRatio = snapshots ? readableSnapshots / snapshots : 0;
  const pendingPenalty = 1 / (1 + pending);
  const ratio = (mutationRatio * 0.6 + snapshotRatio * 0.4) * pendingPenalty;
  const known = protectedMutations > 0 || snapshots > 0 || pending > 0;
  return dimension(
    "recoverability",
    ratio,
    known,
    known
      ? [
          `${recoverableMutations}/${protectedMutations} mutation class(es) are transactionally recoverable; ${readableSnapshots}/${snapshots} snapshot(s) readable; ${pending} pending transaction(s).`,
        ]
      : [],
    [
      protectedMutations
        ? "Snapshot readability proves parseability, not that every external side effect can be reversed."
        : "No protected mutation coverage is stored and receives no credit.",
      ...(snapshots
        ? []
        : ["No readable snapshot evidence is stored and receives no credit."]),
    ],
    recoverableMutations < protectedMutations || corruptSnapshots || pending
      ? [
          "Repair corrupt snapshots, recover pending journals, and move every mutation class behind the durable transaction boundary.",
        ]
      : [
          "Periodically exercise rollback and interrupted-transaction recovery in a disposable environment.",
        ],
  );
}

function rating(
  score: number,
  knownDimensions: number,
  dimensions: AgentHealthDimension[],
): AgentHealthRating {
  if (knownDimensions === 0) return "unknown";
  if (score < 40) return "critical";
  if (dimensions.some((item) => item.status === "critical")) return "attention";
  if (score >= 90 && dimensions.every((item) => item.status === "strong"))
    return "excellent";
  if (score >= 70) return "good";
  return "attention";
}

function validateEvidence(evidence: AgentHealthEvidence): void {
  assertUnique(
    evidence.packages.map((item) => item.packageId),
    "agent health package ids",
  );
  if (evidence.packages.some((item) => !item.packageId.trim()))
    throw new Error("Agent health package ids must not be empty");
  if (evidence.asOf && !Number.isFinite(Date.parse(evidence.asOf)))
    throw new Error("Agent health observation time is invalid");
}

/**
 * Score only supplied stored/local evidence. This function performs no I/O,
 * uses no popularity proxy, and never turns missing evidence into a pass.
 */
export function buildAgentHealthScore(
  evidence: AgentHealthEvidence,
): AgentHealthScore {
  validateEvidence(evidence);
  const byId: Record<AgentHealthDimensionId, AgentHealthDimension> = {
    "provenance-license": provenanceAndLicense(evidence.packages),
    "static-risk": staticRisk(evidence.packages),
    drift: driftScore(evidence.drift),
    duplicates: duplicateScore(evidence.duplicates),
    staleness: staleness(evidence.packages),
    "active-set-capacity": activeSetCapacity(evidence.activeSet),
    compatibility: compatibility(evidence.compatibility),
    benchmarks: benchmarks(evidence.packages),
    "local-outcomes": localOutcomes(evidence.agent, evidence.outcomes),
    recoverability: recoverability(evidence.recoverability),
  };
  const dimensions = DIMENSION_ORDER.map((id) => byId[id]);
  const knownDimensions = dimensions.filter(
    (item) => item.status !== "unknown",
  ).length;
  const score = round(
    dimensions.reduce((total, item) => total + item.contribution, 0),
  );
  return {
    schemaVersion: 1,
    policyVersion: AGENT_HEALTH_POLICY_VERSION,
    agent: evidence.agent,
    ...(evidence.asOf ? { asOf: evidence.asOf } : {}),
    score,
    maximumScore: 100,
    rating: rating(score, knownDimensions, dimensions),
    evidenceCoverage: round((knownDimensions / dimensions.length) * 100),
    knownDimensions,
    dimensions,
    limitations: [
      "This deterministic score summarizes stored local evidence; it does not call a model, execute package code, or prove task quality.",
      "Dimensions are independently capped so one strong signal cannot hide missing provenance, safety, integrity, compatibility, outcome, or recovery evidence.",
    ],
  };
}

export function formatAgentHealthScore(score: AgentHealthScore): string {
  const lines = [
    `Agent Health Score: ${score.score}/${score.maximumScore} (${score.rating}; evidence coverage ${score.evidenceCoverage}%)`,
    `Agent: ${score.agent}${score.asOf ? ` · observed ${score.asOf}` : ""}`,
  ];
  for (const item of score.dimensions) {
    lines.push(
      `${item.label}: ${item.contribution}/${item.cap} (${item.status})`,
      ...item.evidence.map((entry) => `  Evidence: ${entry}`),
      ...item.uncertainty.map((entry) => `  Uncertainty: ${entry}`),
      ...item.remediation.map((entry) => `  Remediation: ${entry}`),
    );
  }
  lines.push(...score.limitations.map((item) => `Limitation: ${item}`));
  return lines.join("\n");
}
