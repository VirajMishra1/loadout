import type { LoadoutCard } from "./loadout-card.js";

export type LoadoutBadgeMetric =
  "evidence" | "active-skills" | "managed-packages" | "mcp";

/** Shields endpoint JSON v1. It is generated locally and contains no telemetry. */
export interface LoadoutBadge {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
  cacheSeconds: number;
}

export function parseLoadoutBadgeMetric(value: string): LoadoutBadgeMetric {
  if (["evidence", "active-skills", "managed-packages", "mcp"].includes(value))
    return value as LoadoutBadgeMetric;
  throw new Error(
    "--metric must be evidence, active-skills, managed-packages, or mcp",
  );
}

export function buildLoadoutBadge(
  card: LoadoutCard,
  metric: LoadoutBadgeMetric = "evidence",
): LoadoutBadge {
  if (metric === "active-skills")
    return {
      schemaVersion: 1,
      label: "Loadout active skills",
      message: String(card.totals.activeSkills),
      color: "blue",
      cacheSeconds: 3600,
    };
  if (metric === "managed-packages")
    return {
      schemaVersion: 1,
      label: "Loadout packages",
      message: String(card.totals.managedPackages),
      color: "blue",
      cacheSeconds: 3600,
    };
  if (metric === "mcp")
    return {
      schemaVersion: 1,
      label: "Loadout MCP",
      message: String(card.totals.mcpEntries),
      color: "blue",
      cacheSeconds: 3600,
    };
  const scored = card.agents.filter(
    (agent) => agent.knownDimensions > 0 && agent.evidenceCoverage > 0,
  );
  const average = (values: number[]): number =>
    values.length
      ? Math.round(
          values.reduce((total, value) => total + value, 0) / values.length,
        )
      : 0;
  const health = average(scored.map((agent) => agent.health));
  const coverage = average(scored.map((agent) => agent.evidenceCoverage));
  return {
    schemaVersion: 1,
    label: "Loadout evidence",
    message: scored.length
      ? `${health}/100 · ${coverage}% covered`
      : "unknown · 0% covered",
    // Color reflects evidence coverage, never an unevidenced quality verdict.
    color: coverage >= 80 ? "2f855a" : coverage >= 40 ? "d69e2e" : "718096",
    cacheSeconds: 3600,
  };
}

export function formatLoadoutBadgeUsage(outputPath: string): string {
  return [
    `Wrote a telemetry-free Shields endpoint artifact to ${outputPath}.`,
    "After publishing that JSON at a stable public URL, render it with:",
    `https://img.shields.io/endpoint?url=<URL-ENCODED-ARTIFACT-URL>`,
    "The evidence badge is not a universal quality or task-improvement claim.",
  ].join("\n");
}
