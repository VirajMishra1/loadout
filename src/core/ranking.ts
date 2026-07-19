import type { CatalogPackage } from "../shared/types.js";

export interface ScoreContribution {
  factor: "adoption" | "momentum" | "maintenance" | "compatibility" | "trust";
  points: number;
  maximum: number;
  evidence: string;
}

export interface CatalogScoreExplanation {
  /** An evidence-weighted ordering aid out of 100, never a measure of quality. */
  score: number;
  contributions: ScoreContribution[];
  guardrails: string[];
}

const TIER_ORDER: Record<CatalogPackage["tier"], number> = {
  official: 4,
  stable: 3,
  trending: 2,
  community: 1,
};

function bounded(value: number, maximum: number): number {
  return Math.max(0, Math.min(maximum, value));
}

function daysSince(value: string, now: Date): number | undefined {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp) || timestamp > now.getTime()) return undefined;
  return (now.getTime() - timestamp) / 86_400_000;
}

/**
 * Explain the score from evidence that is actually present in the catalog.
 * A single star count cannot establish momentum, so momentum is intentionally
 * assigned zero points until the discovery service stores a second observation.
 */
export function explainCatalogScore(
  pkg: CatalogPackage,
  now = new Date(),
): CatalogScoreExplanation {
  const adoption =
    pkg.stars === undefined
      ? {
          factor: "adoption" as const,
          points: 0,
          maximum: 30,
          evidence: "No independently fetched adoption count is available.",
        }
      : {
          factor: "adoption" as const,
          points: Number(
            bounded((Math.log10(pkg.stars + 1) / 6) * 30, 30).toFixed(2),
          ),
          maximum: 30,
          evidence: `${pkg.stars.toLocaleString()} GitHub stars, logarithmically scaled and capped.`,
        };

  const momentum = {
    factor: "momentum" as const,
    points: 0,
    maximum: 20,
    evidence:
      "No two-point star or download history is stored yet; a single snapshot is not treated as momentum.",
  };

  const age = pkg.pushedAt ? daysSince(pkg.pushedAt, now) : undefined;
  const maintenance =
    age === undefined
      ? {
          factor: "maintenance" as const,
          points: 0,
          maximum: 20,
          evidence:
            "No valid code-push timestamp is available; metadata edits and catalog verification are not counted as maintenance.",
        }
      : {
          factor: "maintenance" as const,
          points: Number(
            (age <= 30
              ? 20
              : age <= 90
                ? 16
                : age <= 180
                  ? 10
                  : age <= 365
                    ? 5
                    : 0
            ).toFixed(2),
          ),
          maximum: 20,
          evidence: `Repository code was last pushed ${Math.floor(age)} day(s) ago.`,
        };

  const platforms = pkg.operatingSystems?.length ?? 0;
  // Catalog operatingSystems describe where Loadout can inspect the Git
  // source, not where every component has been proven installable. Until a
  // record carries agent-specific compatibility evidence, do not award those
  // ten points.
  const compatibilityPoints = pkg.components?.length ? 5 : 0;
  const compatibility = {
    factor: "compatibility" as const,
    points: Number(compatibilityPoints.toFixed(2)),
    maximum: 15,
    evidence: `${pkg.components?.length ?? 0} evidenced component kind(s) and ${platforms} source-inspection platform(s); no package or adapter compatibility is inferred.`,
  };

  const assertedLicense = Boolean(
    pkg.license && pkg.license.toUpperCase() !== "NOASSERTION",
  );
  const trustPoints =
    (pkg.source ? 6 : 0) +
    (assertedLicense ? 4 : 0) +
    (pkg.tier === "official" ? 5 : 0);
  const trust = {
    factor: "trust" as const,
    points: trustPoints,
    maximum: 15,
    evidence: `${pkg.source ? "Immutable source evidence" : "No immutable source evidence"}, ${assertedLicense ? `asserted ${pkg.license} license metadata` : pkg.license === "NOASSERTION" ? "license is unknown (NOASSERTION)" : "no license metadata"}${pkg.tier === "official" ? ", and a declared official publisher tier" : ""}.`,
  };

  const contributions = [adoption, momentum, maintenance, compatibility, trust];
  return {
    score: Number(
      contributions
        .reduce((sum, contribution) => sum + contribution.points, 0)
        .toFixed(2),
    ),
    contributions,
    guardrails: [
      "Scores order candidates inside a capability category; they do not compare unrelated tools or prove universal quality.",
      "Stars are logarithmic and capped, so popularity cannot overwhelm tier, provenance, license, archive, or compatibility policy.",
      "Missing evidence earns no points. Self-reported README claims, topics, and a single timestamp are not treated as adoption, momentum, or safety proof.",
      "Official is a publisher-identity tier, not a security guarantee. Archived packages remain ineligible for automatic profiles.",
    ],
  };
}

/** A deterministic policy ordering: declared tier, bounded evidence score, then id. */
export function compareCatalogPackages(
  a: CatalogPackage,
  b: CatalogPackage,
): number {
  return (
    TIER_ORDER[b.tier] - TIER_ORDER[a.tier] ||
    explainCatalogScore(b).score - explainCatalogScore(a).score ||
    a.id.localeCompare(b.id)
  );
}
