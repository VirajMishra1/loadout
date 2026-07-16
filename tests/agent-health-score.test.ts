import { describe, expect, it } from "vitest";
import {
  AGENT_HEALTH_DIMENSION_CAPS,
  AGENT_HEALTH_POLICY_VERSION,
  buildAgentHealthScore,
  formatAgentHealthScore,
  type AgentHealthDimensionId,
} from "../src/core/agent-health-score.js";
import {
  agentHealthAdversarialFixtures,
  driftedHealthEvidence,
  emptyHealthEvidence,
  incompatibleHealthEvidence,
  mixedHealthEvidence,
  overloadedHealthEvidence,
  perfectHealthEvidence,
  unlicensedHealthEvidence,
} from "./fixtures/agent-health-score.js";

function dimension(
  fixture: Parameters<typeof buildAgentHealthScore>[0],
  id: AgentHealthDimensionId,
) {
  return buildAgentHealthScore(fixture).dimensions.find(
    (item) => item.id === id,
  )!;
}

describe("deterministic Agent Health Score", () => {
  it("uses ten independent caps that total exactly 100", () => {
    expect(Object.keys(AGENT_HEALTH_DIMENSION_CAPS)).toHaveLength(10);
    expect(
      Object.values(AGENT_HEALTH_DIMENSION_CAPS).reduce(
        (total, cap) => total + cap,
        0,
      ),
    ).toBe(100);
  });

  it("gives an empty profile zero credit and explicit uncertainty", () => {
    const score = buildAgentHealthScore(emptyHealthEvidence);
    expect(score).toMatchObject({
      policyVersion: AGENT_HEALTH_POLICY_VERSION,
      score: 0,
      maximumScore: 100,
      rating: "unknown",
      evidenceCoverage: 0,
      knownDimensions: 0,
    });
    expect(score.dimensions).toHaveLength(10);
    for (const item of score.dimensions) {
      expect(item.status).toBe("unknown");
      expect(item.contribution).toBe(0);
      expect(item.evidence.length).toBeGreaterThan(0);
      expect(item.uncertainty.length).toBeGreaterThan(0);
      expect(item.remediation.length).toBeGreaterThan(0);
    }
  });

  it("requires positive evidence in every dimension for a perfect score", () => {
    const score = buildAgentHealthScore(perfectHealthEvidence);
    expect(score).toMatchObject({
      score: 100,
      rating: "excellent",
      evidenceCoverage: 100,
      knownDimensions: 10,
    });
    expect(
      score.dimensions.every(
        (item) => item.status === "strong" && item.contribution === item.cap,
      ),
    ).toBe(true);
  });

  it("makes severe active-set overload visible even when other evidence is perfect", () => {
    const score = buildAgentHealthScore(overloadedHealthEvidence);
    const capacity = dimension(overloadedHealthEvidence, "active-set-capacity");
    expect(capacity).toMatchObject({ contribution: 2.5, status: "critical" });
    expect(capacity.remediation.join(" ")).toContain("90 active skill");
    expect(score.rating).toBe("attention");
  });

  it("does not hide local drift behind healthy unrelated dimensions", () => {
    const score = buildAgentHealthScore(driftedHealthEvidence);
    expect(dimension(driftedHealthEvidence, "drift")).toMatchObject({
      contribution: 2.8,
      status: "critical",
    });
    expect(score.rating).toBe("attention");
  });

  it("gives no license credit to NOASSERTION", () => {
    const item = dimension(unlicensedHealthEvidence, "provenance-license");
    expect(item).toMatchObject({ contribution: 7, status: "attention" });
    expect(item.uncertainty.join(" ")).toContain(
      "2 package(s) lack an asserted license",
    );
    expect(buildAgentHealthScore(unlicensedHealthEvidence).rating).toBe("good");
  });

  it("gives unsupported components zero compatibility credit", () => {
    const score = buildAgentHealthScore(incompatibleHealthEvidence);
    expect(
      dimension(incompatibleHealthEvidence, "compatibility"),
    ).toMatchObject({ contribution: 0, status: "critical" });
    expect(score.rating).toBe("attention");
  });

  it("does not credit benchmark claims without stored evidence ids", () => {
    const evidence = {
      ...perfectHealthEvidence,
      packages: perfectHealthEvidence.packages.map((item) => ({
        ...item,
        benchmark: { ...item.benchmark!, evidenceIds: [] },
      })),
    };
    expect(dimension(evidence, "benchmarks")).toMatchObject({
      contribution: 0,
      status: "unknown",
    });
  });

  it("produces an auditable mixed score without rounding outside caps", () => {
    const score = buildAgentHealthScore(mixedHealthEvidence);
    expect(score).toMatchObject({
      score: 62.52,
      rating: "attention",
      evidenceCoverage: 100,
      knownDimensions: 10,
    });
    expect(
      Object.fromEntries(
        score.dimensions.map((item) => [item.id, item.contribution]),
      ),
    ).toEqual({
      "provenance-license": 8.75,
      "static-risk": 9,
      drift: 11.2,
      duplicates: 5.33,
      staleness: 6,
      "active-set-capacity": 8.33,
      compatibility: 5.83,
      benchmarks: 4,
      "local-outcomes": 1.48,
      recoverability: 2.6,
    });
    expect(
      score.dimensions.every(
        (item) =>
          item.contribution >= 0 &&
          item.contribution <= item.cap &&
          item.evidence.length > 0 &&
          item.uncertainty.length > 0 &&
          item.remediation.length > 0,
      ),
    ).toBe(true);
  });

  it("is deterministic for every adversarial fixture", () => {
    for (const fixture of Object.values(agentHealthAdversarialFixtures))
      expect(buildAgentHealthScore(fixture)).toEqual(
        buildAgentHealthScore(structuredClone(fixture)),
      );
  });

  it("rejects internally inconsistent evidence instead of normalizing it", () => {
    expect(() =>
      buildAgentHealthScore({
        ...perfectHealthEvidence,
        drift: {
          checkedFiles: 1,
          driftedFiles: 2,
          checkedMcpServers: 0,
          driftedMcpServers: 0,
        },
      }),
    ).toThrow(/cannot exceed checked/);
    expect(() =>
      buildAgentHealthScore({
        ...perfectHealthEvidence,
        packages: [
          perfectHealthEvidence.packages[0],
          perfectHealthEvidence.packages[0],
        ],
      }),
    ).toThrow(/duplicate values/);
  });

  it("formats every dimension with evidence, uncertainty, and remediation", () => {
    const output = formatAgentHealthScore(
      buildAgentHealthScore(mixedHealthEvidence),
    );
    expect(output).toContain("Agent Health Score: 62.52/100");
    expect(output.match(/Evidence:/g)).toHaveLength(12);
    expect(output.match(/Uncertainty:/g)?.length).toBeGreaterThanOrEqual(10);
    expect(output.match(/Remediation:/g)).toHaveLength(10);
    expect(output).toContain("Limitation:");
  });
});
