/**
 * One-command coordination setup.
 *
 * `loadout coord start --agents claude-code,codex` detects the project
 * structure, assigns file ownership, and prints a ready-to-go status —
 * replacing the 6-command manual setup.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  claimOwnership,
  getOwnership,
  snapshot,
  type ClaimOwnershipOptions,
} from "./coordinator.js";

// ── Directory pattern detection ─────────────────────────────────────

export interface DirectorySplit {
  /** Agent → directories it will own. */
  assignments: Map<string, string[]>;
  /** Directories that exist but weren't assigned. */
  unassigned: string[];
  /** Which split strategy was used. */
  strategy: string;
}

/** Well-known directory groupings. Order matters — first match wins. */
const SPLIT_PATTERNS: Record<
  string,
  { label: string; groups: [RegExp, RegExp] }
> = {
  "backend/frontend": {
    label: "backend / frontend",
    groups: [
      /^(server|backend|api|src\/api|src\/server|src\/backend|app\/api|packages\/api|packages\/server|packages\/backend|lib|services)/,
      /^(client|frontend|web|app|src\/app|src\/web|src\/client|src\/frontend|src\/components|src\/pages|src\/views|packages\/web|packages\/client|packages\/frontend|components|pages|views|ui)/,
    ],
  },
  "core/tests": {
    label: "core / tests",
    groups: [
      /^(src|lib|app|packages)/,
      /^(tests|test|__tests__|spec|specs|e2e|cypress)/,
    ],
  },
};

async function listTopDirs(projectRoot: string): Promise<string[]> {
  const entries = await readdir(projectRoot, { withFileTypes: true });
  const dirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    if (
      ["dist", "build", "out", "coverage", "test-results", ".next"].includes(
        entry.name,
      )
    )
      continue;
    dirs.push(entry.name);
  }

  // Also check src/ subdirectories since many projects keep everything under src/
  try {
    const srcEntries = await readdir(join(projectRoot, "src"), {
      withFileTypes: true,
    });
    const nested: string[] = [];
    for (const entry of srcEntries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        nested.push(`src/${entry.name}`);
      }
    }
    if (nested.length > 0) {
      const srcIndex = dirs.indexOf("src");
      if (srcIndex >= 0) dirs.splice(srcIndex, 1);
      dirs.push(...nested);
    }
  } catch {
    // No src/ directory — that's fine.
  }

  return dirs;
}

function collapsePaths(paths: string[]): string[] {
  const sorted = [...new Set(paths)].sort(
    (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
  );
  return sorted.filter(
    (path, index) =>
      !sorted
        .slice(0, index)
        .some((parent) => path === parent || path.startsWith(`${parent}/`)),
  );
}

export async function detectSplit(
  projectRoot: string,
  agents: [string, string],
  preferredSplit?: string,
): Promise<DirectorySplit> {
  if (agents.some((agent) => !agent.trim()) || agents[0] === agents[1])
    throw new Error("Coordination requires two distinct, non-empty agents");
  if (preferredSplit && !SPLIT_PATTERNS[preferredSplit])
    throw new Error(`Unknown split strategy '${preferredSplit}'`);
  const dirs = await listTopDirs(projectRoot);

  // Try preferred split first, then all patterns
  const order = preferredSplit
    ? [
        preferredSplit,
        ...Object.keys(SPLIT_PATTERNS).filter((k) => k !== preferredSplit),
      ]
    : Object.keys(SPLIT_PATTERNS);

  for (const key of order) {
    const pattern = SPLIT_PATTERNS[key];
    if (!pattern) continue;

    const groupA = dirs.filter((d) => pattern.groups[0].test(d));
    const groupB = dirs.filter((d) => pattern.groups[1].test(d));

    if (groupA.length > 0 && groupB.length > 0) {
      const assigned = new Set([...groupA, ...groupB]);
      return {
        assignments: new Map([
          [agents[0], collapsePaths(groupA)],
          [agents[1], collapsePaths(groupB)],
        ]),
        unassigned: dirs.filter((d) => !assigned.has(d)),
        strategy: pattern.label,
      };
    }
  }

  // Fallback: even split by directory count
  const sorted = [...dirs].sort();
  const mid = Math.ceil(sorted.length / 2);
  return {
    assignments: new Map([
      [agents[0], collapsePaths(sorted.slice(0, mid))],
      [agents[1], collapsePaths(sorted.slice(mid))],
    ]),
    unassigned: [],
    strategy: "even split (no recognized pattern)",
  };
}

// ── Quick-start orchestration ───────────────────────────────────────

export interface QuickStartResult {
  split: DirectorySplit;
  ownershipClaimed: boolean;
  existingOwnership: boolean;
  snapshotSummary: string;
}

export async function quickStart(
  projectRoot: string,
  agents: [string, string],
  options: {
    split?: string;
    dryRun?: boolean;
  } = {},
): Promise<QuickStartResult> {
  const split = await detectSplit(projectRoot, agents, options.split);

  // Check existing ownership
  const existing = await getOwnership(projectRoot);
  const existingOwnership = existing.size > 0;

  let ownershipClaimed = false;

  if (!options.dryRun && !existingOwnership) {
    // Claim ownership for each agent
    for (const [agent, paths] of split.assignments) {
      if (paths.length === 0) continue;
      const claimOptions: ClaimOwnershipOptions = {
        agent,
        paths,
        mode: "exclusive",
        reason: `Auto-assigned by coord start (${split.strategy})`,
      };
      await claimOwnership(projectRoot, claimOptions);
    }
    ownershipClaimed = true;
  }

  // Get snapshot summary
  const snap = await snapshot(projectRoot, agents[1]);
  const lines: string[] = [];
  if (snap.activeContracts.length > 0) {
    lines.push(
      `${snap.activeContracts.length} contract(s): ${snap.activeContracts.map((c) => `${c.name} rev${c.revision}`).join(", ")}`,
    );
  }
  if (snap.ownership.length > 0) {
    lines.push(`${snap.ownership.length} owned path(s)`);
  }
  if (snap.unackedForAgent.length > 0) {
    lines.push(`${snap.unackedForAgent.length} unacknowledged event(s)`);
  }

  return {
    split,
    ownershipClaimed,
    existingOwnership,
    snapshotSummary: lines.join(" · ") || "empty — ready for first events",
  };
}

// ── Terminal formatting ─────────────────────────────────────────────

export function formatQuickStart(result: QuickStartResult): string {
  const lines: string[] = [];

  lines.push("\x1b[1m╔══════════════════════════════════════════╗\x1b[0m");
  lines.push("\x1b[1m║       COORDINATION READY                 ║\x1b[0m");
  lines.push("\x1b[1m╚══════════════════════════════════════════╝\x1b[0m");
  lines.push("");

  lines.push(`  Strategy: \x1b[36m${result.split.strategy}\x1b[0m`);
  lines.push("");

  for (const [agent, paths] of result.split.assignments) {
    const color = agent.includes("claude") ? "\x1b[36m" : "\x1b[33m";
    lines.push(`  ${color}${agent}\x1b[0m`);
    for (const p of paths) {
      lines.push(`    \x1b[90m└─\x1b[0m ${p}/`);
    }
    lines.push("");
  }

  if (result.split.unassigned.length > 0) {
    lines.push("  \x1b[90mUnassigned (shared):\x1b[0m");
    for (const p of result.split.unassigned) {
      lines.push(`    \x1b[90m└─\x1b[0m ${p}/`);
    }
    lines.push("");
  }

  if (result.existingOwnership) {
    lines.push(
      "  \x1b[33m⚠ Existing ownership detected — skipped auto-assignment.\x1b[0m",
    );
    lines.push(
      "    Run \x1b[90mloadout coord status\x1b[0m to see current ownership.",
    );
  } else if (result.ownershipClaimed) {
    lines.push("  \x1b[32m✓ Ownership claimed for both agents.\x1b[0m");
  } else {
    lines.push(
      "  \x1b[90mDry run — no ownership claimed. Add --yes to apply.\x1b[0m",
    );
  }

  lines.push("");
  lines.push("\x1b[90m─────────────────────────────────────────────\x1b[0m");
  lines.push("");
  lines.push("  \x1b[1mWhat each agent should do now:\x1b[0m");
  lines.push("");

  const agentList = [...result.split.assignments.keys()];
  lines.push(
    `  1. Open \x1b[36m${agentList[0]}\x1b[0m → it checks its snapshot and starts working`,
  );
  lines.push(
    `  2. Open \x1b[33m${agentList[1]}\x1b[0m → it sees the ownership split and builds against contracts`,
  );
  lines.push(
    "  3. When either creates/changes a shared interface → it publishes a contract",
  );
  lines.push(
    "  4. The other agent sees the contract on its next snapshot check",
  );
  lines.push("");
  lines.push(
    "  The \x1b[90mloadout-handoff\x1b[0m skill handles steps 1-4 automatically.",
  );
  lines.push(
    "  Just tell each agent what to build — it runs the coord commands for you.",
  );

  return lines.join("\n");
}
