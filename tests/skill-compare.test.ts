import { describe, expect, it } from "vitest";
import type { CatalogPackage } from "../src/shared/types.js";
import type {
  CatalogSkillEvidence,
  ProvenanceInventoryReport,
} from "../src/core/provenance.js";
import {
  compareSkill,
  formatSkillComparison,
} from "../src/core/skill-compare.js";

const evidence = (
  packageId: string,
  skillName: string,
  description: string,
  fingerprint: string,
): CatalogSkillEvidence => ({
  packageId,
  packageDisplayName: packageId,
  repository: `example/${packageId}`,
  commit: packageId.padEnd(40, "a").slice(0, 40),
  tier: "stable",
  category: "review",
  license: "MIT",
  skillName,
  description,
  skillPath: `skills/${skillName}`,
  fingerprint,
});

const catalogPackage = (record: CatalogSkillEvidence): CatalogPackage => ({
  id: record.packageId,
  displayName: record.packageDisplayName,
  repository: record.repository,
  description: record.description ?? record.skillName,
  category: record.category,
  tier: record.tier,
  license: record.license,
  components: ["skill"],
  operatingSystems: ["windows", "macos", "linux"],
  stars: 1000,
});

function inventory(): ProvenanceInventoryReport {
  return {
    generatedAt: "2026-07-15T00:00:00.000Z",
    total: 1,
    managed: 0,
    unmanaged: 1,
    uniqueNames: 1,
    agents: [],
    duplicates: [],
    warnings: [],
    skills: [
      {
        agent: "claude-code",
        agentDisplayName: "Claude Code",
        name: "review",
        description: "Review code carefully for correctness and security",
        path: "/home/.claude/skills/review",
        fingerprint: "installed-fingerprint",
        managed: false,
        provenance: {
          kind: "unknown",
          confidence: "unknown",
          evidence: ["Unknown"],
          candidates: [],
        },
      },
    ],
    provenance: {
      indexSource: "cache",
      indexedSkills: 2,
      exact: 0,
      managed: 0,
      embedded: 0,
      nameCandidates: 0,
      unknown: 1,
      failures: [],
    },
  };
}

describe("skill comparison", () => {
  it("prioritizes divergent same-name evidence without claiming it is better", () => {
    const sameName = evidence(
      "reviewed-review",
      "review",
      "Review code for correctness and security",
      "different-fingerprint",
    );
    const overlap = evidence(
      "security-review",
      "security-review",
      "Review code carefully for security vulnerabilities",
      "another-fingerprint",
    );
    const result = compareSkill(
      "review",
      inventory(),
      [overlap, sameName],
      [catalogPackage(overlap), catalogPackage(sameName)],
    );
    expect(result.alternatives[0]).toMatchObject({
      packageId: "reviewed-review",
      relationship: "divergent-same-name",
      evidenceDimensions: {
        adoption: expect.stringContaining("GitHub stars"),
        momentum: expect.stringContaining("No two-point"),
        permissions: expect.stringContaining("No declarative permission"),
        evaluation: expect.stringContaining("No skill-specific"),
      },
    });
    expect(result.recommendation).toMatch(
      /head-to-head.*cannot honestly call it better/i,
    );
    expect(formatSkillComparison(result)).toContain("Uncertainty:");
  });

  it("compares a catalog skill when it is not installed", () => {
    const subject = evidence(
      "reviewed-review",
      "review",
      "Review code carefully",
      "subject",
    );
    const related = evidence(
      "other-review",
      "review-helper",
      "Review code carefully for bugs",
      "related",
    );
    const result = compareSkill(
      "reviewed-review",
      { ...inventory(), skills: [], total: 0, unmanaged: 0 },
      [subject, related],
      [catalogPackage(subject), catalogPackage(related)],
    );
    expect(result.subject).toMatchObject({
      source: "catalog",
      name: "review",
    });
    expect(result.alternatives).toHaveLength(1);
    expect(result.recommendation).toMatch(/not an installed replacement/i);
    expect(formatSkillComparison(result)).toContain(
      "Reviewed source: reviewed-review",
    );
  });

  it("requires disambiguation for divergent installed matches", () => {
    const report = inventory();
    report.skills.push({
      ...report.skills[0],
      agent: "codex",
      path: "/home/.agents/skills/review",
      fingerprint: "different",
    });
    expect(() => compareSkill("review", report, [], [])).toThrow(
      /Several divergent installed skills.*--agent/,
    );
  });
});
