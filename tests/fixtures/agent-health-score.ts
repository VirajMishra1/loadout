import type { AgentHealthEvidence } from "../../src/core/agent-health-score.js";
import type { LocalOutcomeEvent } from "../../src/core/outcomes.js";

const asOf = "2026-07-16T00:00:00.000Z";

function outcome(
  index: number,
  result: LocalOutcomeEvent["result"],
): LocalOutcomeEvent {
  return {
    id: `outcome-${index}`,
    recordedAt: asOf,
    selector: "alpha/review",
    agent: "codex",
    taskFamily: "general",
    result,
  };
}

export const emptyHealthEvidence: AgentHealthEvidence = {
  agent: "codex",
  asOf,
  packages: [],
};

export const perfectHealthEvidence: AgentHealthEvidence = {
  agent: "codex",
  asOf,
  packages: [
    {
      packageId: "alpha",
      provenance: "verified",
      license: "MIT",
      staticRisk: { status: "clear", findingCount: 0 },
      freshness: { status: "fresh", ageDays: 7 },
      benchmark: {
        passed: 3,
        failed: 0,
        evidenceIds: ["bench-alpha"],
      },
    },
    {
      packageId: "beta",
      provenance: "verified",
      license: "Apache-2.0",
      staticRisk: { status: "clear", findingCount: 0 },
      freshness: { status: "fresh", ageDays: 14 },
      benchmark: {
        passed: 2,
        failed: 0,
        evidenceIds: ["bench-beta"],
      },
    },
  ],
  drift: {
    checkedFiles: 12,
    driftedFiles: 0,
    checkedMcpServers: 2,
    driftedMcpServers: 0,
  },
  duplicates: {
    scannedSkills: 6,
    withinAgentGroups: 0,
    duplicateSkills: 0,
  },
  activeSet: { active: 6, capacity: 30, disabled: 2, quarantined: 0 },
  compatibility: [
    { component: "skill", compatibility: "native" },
    { component: "mcp", compatibility: "native" },
  ],
  outcomes: Array.from({ length: 10 }, (_, index) => outcome(index, "success")),
  recoverability: {
    protectedMutations: 5,
    recoverableMutations: 5,
    readableSnapshots: 4,
    corruptSnapshots: 0,
    pendingTransactions: 0,
  },
};

export const overloadedHealthEvidence: AgentHealthEvidence = {
  ...perfectHealthEvidence,
  activeSet: {
    active: 120,
    capacity: 30,
    disabled: 0,
    quarantined: 0,
  },
};

export const driftedHealthEvidence: AgentHealthEvidence = {
  ...perfectHealthEvidence,
  drift: {
    checkedFiles: 10,
    driftedFiles: 8,
    checkedMcpServers: 0,
    driftedMcpServers: 0,
  },
};

export const unlicensedHealthEvidence: AgentHealthEvidence = {
  ...perfectHealthEvidence,
  packages: perfectHealthEvidence.packages.map((item) => ({
    ...item,
    license: "NOASSERTION",
  })),
};

export const incompatibleHealthEvidence: AgentHealthEvidence = {
  ...perfectHealthEvidence,
  compatibility: [
    { component: "skill", compatibility: "unsupported" },
    { component: "mcp", compatibility: "unsupported" },
  ],
};

export const mixedHealthEvidence: AgentHealthEvidence = {
  agent: "codex",
  asOf,
  packages: [
    {
      packageId: "alpha",
      provenance: "verified",
      license: "MIT",
      staticRisk: { status: "clear", findingCount: 0 },
      freshness: { status: "fresh", ageDays: 30 },
      benchmark: {
        passed: 2,
        failed: 0,
        evidenceIds: ["bench-alpha-mixed"],
      },
    },
    {
      packageId: "beta",
      provenance: "managed",
      license: "NOASSERTION",
      staticRisk: { status: "warning", findingCount: 2 },
      freshness: { status: "aging", ageDays: 240 },
    },
  ],
  drift: {
    checkedFiles: 8,
    driftedFiles: 2,
    checkedMcpServers: 2,
    driftedMcpServers: 0,
  },
  duplicates: {
    scannedSkills: 6,
    withinAgentGroups: 1,
    duplicateSkills: 2,
  },
  activeSet: { active: 6, capacity: 5, disabled: 1, quarantined: 1 },
  compatibility: [
    { component: "skill", compatibility: "native" },
    { component: "mcp", compatibility: "adapted" },
    { component: "command", compatibility: "unknown" },
  ],
  outcomes: [
    outcome(20, "success"),
    outcome(21, "failure"),
    outcome(22, "activation"),
    outcome(23, "disable"),
  ],
  recoverability: {
    protectedMutations: 4,
    recoverableMutations: 3,
    readableSnapshots: 1,
    corruptSnapshots: 1,
    pendingTransactions: 1,
  },
};

export const agentHealthAdversarialFixtures = {
  empty: emptyHealthEvidence,
  perfect: perfectHealthEvidence,
  overloaded: overloadedHealthEvidence,
  drifted: driftedHealthEvidence,
  unlicensed: unlicensedHealthEvidence,
  incompatible: incompatibleHealthEvidence,
  mixed: mixedHealthEvidence,
} as const;
