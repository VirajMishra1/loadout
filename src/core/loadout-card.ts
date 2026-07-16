import type { AgentHealthScore } from "./agent-health-score.js";
import { buildLocalAgentHealthScores } from "./health-score-evidence.js";
import {
  buildPrivacySafeReport,
  type PrivacySafeLoadoutReport,
} from "./share-report.js";

export interface LoadoutCard {
  schemaVersion: 1;
  generatedAt: string;
  agents: Array<{
    id: string;
    health: number;
    rating: AgentHealthScore["rating"];
    evidenceCoverage: number;
    knownDimensions: number;
  }>;
  totals: {
    managedPackages: number;
    activeSkills: number;
    disabledSkills: number;
    mcpEntries: number;
  };
  claimBoundary: string;
  privacy: string;
}

export async function buildLoadoutCard(
  options: {
    report?: PrivacySafeLoadoutReport;
    scores?: AgentHealthScore[];
    now?: Date;
  } = {},
): Promise<LoadoutCard> {
  const [report, scores] = await Promise.all([
    options.report ? Promise.resolve(options.report) : buildPrivacySafeReport(),
    options.scores
      ? Promise.resolve(options.scores)
      : buildLocalAgentHealthScores({ asOf: options.now }),
  ]);
  return {
    schemaVersion: 1,
    generatedAt: (options.now ?? new Date()).toISOString(),
    agents: scores
      .map((score) => ({
        id: score.agent,
        health: score.score,
        rating: score.rating,
        evidenceCoverage: score.evidenceCoverage,
        knownDimensions: score.knownDimensions,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    totals: {
      managedPackages: report.packages.length,
      activeSkills: report.packages.reduce(
        (total, item) => total + item.activeSkills,
        0,
      ),
      disabledSkills: report.packages.reduce(
        (total, item) => total + item.disabledSkills,
        0,
      ),
      mcpEntries: report.mcp.length,
    },
    claimBoundary:
      "Health summarizes available local evidence; it is not a universal quality score or proof of task improvement.",
    privacy:
      "Contains no project paths, project names, prompts, source code, filenames, repository names, or credential values.",
  };
}

export function formatLoadoutCard(card: LoadoutCard): string {
  const agentCells = card.agents.length
    ? card.agents
        .map(
          (agent) =>
            `| ${agent.id} | ${agent.health}/100 | ${agent.rating} | ${agent.evidenceCoverage}% |`,
        )
        .join("\n")
    : "| No detected agent | 0/100 | unknown | 0% |";
  return [
    "# My Loadout",
    "",
    `**${card.totals.activeSkills} active skills · ${card.totals.managedPackages} managed packages · ${card.totals.mcpEntries} MCP entries**`,
    "",
    "| Agent | Evidence health | Rating | Evidence coverage |",
    "| --- | ---: | --- | ---: |",
    agentCells,
    "",
    `Updated: ${card.generatedAt}`,
    "",
    `> ${card.claimBoundary}`,
    `> Privacy: ${card.privacy}`,
  ].join("\n");
}

export interface LoadoutComparison {
  schemaVersion: 1;
  leftGeneratedAt: string;
  rightGeneratedAt: string;
  delta: {
    managedPackages: number;
    activeSkills: number;
    disabledSkills: number;
    mcpEntries: number;
  };
  boundary: string;
}

function reportTotals(report: PrivacySafeLoadoutReport) {
  return {
    managedPackages: report.packages.length,
    activeSkills: report.packages.reduce(
      (total, item) => total + item.activeSkills,
      0,
    ),
    disabledSkills: report.packages.reduce(
      (total, item) => total + item.disabledSkills,
      0,
    ),
    mcpEntries: report.mcp.length,
  };
}

export function compareLoadoutReports(
  left: PrivacySafeLoadoutReport,
  right: PrivacySafeLoadoutReport,
): LoadoutComparison {
  const before = reportTotals(left);
  const after = reportTotals(right);
  return {
    schemaVersion: 1,
    leftGeneratedAt: left.generatedAt,
    rightGeneratedAt: right.generatedAt,
    delta: {
      managedPackages: after.managedPackages - before.managedPackages,
      activeSkills: after.activeSkills - before.activeSkills,
      disabledSkills: after.disabledSkills - before.disabledSkills,
      mcpEntries: after.mcpEntries - before.mcpEntries,
    },
    boundary:
      "This compares explicit privacy-safe inventory counts only; it does not rank users, agents, or task quality.",
  };
}

export function formatLoadoutComparison(value: LoadoutComparison): string {
  const signed = (number: number) => `${number >= 0 ? "+" : ""}${number}`;
  return [
    "Loadout comparison (right minus left)",
    `Managed packages: ${signed(value.delta.managedPackages)}`,
    `Active skills: ${signed(value.delta.activeSkills)}`,
    `Disabled skills: ${signed(value.delta.disabledSkills)}`,
    `MCP entries: ${signed(value.delta.mcpEntries)}`,
    value.boundary,
  ].join("\n");
}
