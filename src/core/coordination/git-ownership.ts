/**
 * Git-aware auto-ownership — infer directory ownership from git history.
 *
 * Scans recent commits to find which agent (author) has been working
 * in which directories, then suggests or applies ownership claims.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  claimOwnership,
  getOwnership,
  type ClaimOwnershipOptions,
} from "./coordinator.js";

const execFileAsync = promisify(execFile);

// ── Types ──────────────────────────────────────────────────────────────

export interface GitAuthorStats {
  /** Author name from git log. */
  author: string;
  /** Directories this author has committed to. */
  directories: Map<string, number>; // dir → commit count
  /** Total commits in the analyzed range. */
  totalCommits: number;
}

export interface OwnershipSuggestion {
  /** Directory path relative to project root. */
  directory: string;
  /** Suggested agent/author to own it. */
  suggestedOwner: string;
  /** How many commits this author has in this directory. */
  commits: number;
  /** Percentage of total directory commits by this author. */
  percentage: number;
  /** Whether ownership is already claimed. */
  alreadyClaimed: boolean;
}

export interface GitOwnershipResult {
  suggestions: OwnershipSuggestion[];
  authorStats: GitAuthorStats[];
  ownershipApplied: boolean;
}

interface AgentAuthorMapping {
  agent: string;
  author: string;
}

function parseAgentAuthorMappings(values: string[]): AgentAuthorMapping[] {
  const mappings = values.map((value) => {
    const separator = value.indexOf("=");
    const agent = (separator >= 0 ? value.slice(0, separator) : value).trim();
    const author = (separator >= 0 ? value.slice(separator + 1) : value).trim();
    if (!agent || !author)
      throw new Error(
        `Invalid agent/author mapping '${value}'; use agent=Git Author`,
      );
    return { agent, author };
  });
  if (
    new Set(mappings.map((mapping) => mapping.agent)).size !== mappings.length
  )
    throw new Error("Each agent may have only one Git author mapping");
  return mappings;
}

// ── Git scanning ───────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  ".git",
  ".handoff",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
]);

/**
 * Scan git log for directory-level author stats.
 *
 * Uses `git log --name-only` to get file paths per commit, groups by
 * top-level directory, and counts commits per author per directory.
 */
export async function scanGitHistory(
  projectRoot: string,
  options: {
    /** Max commits to scan (default 200). */
    maxCommits?: number;
    /** Only consider these authors (agent names). */
    authors?: string[];
    /** Directory depth to group at (default 1 for top-level). */
    depth?: number;
  } = {},
): Promise<GitAuthorStats[]> {
  const maxCommits = options.maxCommits ?? 200;
  const depth = options.depth ?? 1;
  if (!Number.isInteger(maxCommits) || maxCommits < 1 || maxCommits > 10_000)
    throw new Error("Max commits must be an integer from 1 to 10000");
  if (!Number.isInteger(depth) || depth < 1 || depth > 20)
    throw new Error("Directory depth must be an integer from 1 to 20");

  let stdout: string;
  try {
    const result = await execFileAsync(
      "git",
      [
        "log",
        `--max-count=${maxCommits}`,
        "--name-only",
        "--format=COMMIT:%aN",
        "--no-merges",
      ],
      { cwd: projectRoot, maxBuffer: 5 * 1024 * 1024 },
    );
    stdout = result.stdout;
  } catch {
    return []; // Not a git repo or no commits
  }

  // Parse: each commit starts with "COMMIT:<author>", followed by file paths
  const authorDirCommits = new Map<
    string,
    { dirs: Map<string, number>; total: number }
  >();

  const blocks = stdout.split("COMMIT:").filter(Boolean);
  for (const block of blocks) {
    const lines = block.split("\n").filter(Boolean);
    if (lines.length < 1) continue;

    const author = lines[0].trim();
    if (!author) continue;
    if (options.authors && !options.authors.includes(author)) continue;

    const dirs = new Set<string>();
    for (let i = 1; i < lines.length; i++) {
      const filePath = lines[i].trim();
      if (!filePath) continue;
      const dir = extractDirectory(filePath, depth);
      if (dir && !SKIP_DIRS.has(dir.split("/")[0])) {
        dirs.add(dir);
      }
    }

    const stats = authorDirCommits.get(author) ?? {
      dirs: new Map<string, number>(),
      total: 0,
    };
    stats.total++;
    for (const dir of dirs) {
      stats.dirs.set(dir, (stats.dirs.get(dir) ?? 0) + 1);
    }
    authorDirCommits.set(author, stats);
  }

  return [...authorDirCommits.entries()].map(
    ([author, stats]): GitAuthorStats => ({
      author,
      directories: stats.dirs,
      totalCommits: stats.total,
    }),
  );
}

function extractDirectory(filePath: string, depth: number): string | null {
  const parts = filePath.split("/");
  if (parts.length <= depth) return null; // File at root level
  return parts.slice(0, depth).join("/");
}

// ── Suggestion generation ──────────────────────────────────────────────

export async function suggestOwnership(
  projectRoot: string,
  agents: string[],
  options: {
    maxCommits?: number;
    depth?: number;
    /** Minimum percentage to suggest ownership (default 60). */
    threshold?: number;
  } = {},
): Promise<GitOwnershipResult> {
  const threshold = options.threshold ?? 60;
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100)
    throw new Error("Ownership threshold must be an integer from 1 to 100");
  const mappings = parseAgentAuthorMappings(agents);
  const agentForAuthor = new Map(
    mappings.map((mapping) => [mapping.author, mapping.agent]),
  );
  const stats = await scanGitHistory(projectRoot, {
    maxCommits: options.maxCommits,
    depth: options.depth,
  });

  const existingOwnership = await getOwnership(projectRoot);

  // Collect all directories across all authors
  const allDirs = new Set<string>();
  for (const s of stats) {
    for (const dir of s.directories.keys()) {
      allDirs.add(dir);
    }
  }

  const suggestions: OwnershipSuggestion[] = [];

  for (const dir of allDirs) {
    // Find commit counts per author for this directory
    const authorCounts: { author: string; count: number }[] = [];
    let totalDirCommits = 0;

    for (const s of stats) {
      const count = s.directories.get(dir) ?? 0;
      if (count > 0) {
        authorCounts.push({ author: s.author, count });
        totalDirCommits += count;
      }
    }

    if (totalDirCommits === 0) continue;

    // Find dominant author
    authorCounts.sort((a, b) => b.count - a.count);
    const dominant = authorCounts[0];
    const percentage = Math.round((dominant.count / totalDirCommits) * 100);
    const suggestedOwner = agentForAuthor.get(dominant.author);

    if (percentage < threshold || !suggestedOwner) continue;

    const alreadyClaimed = [...existingOwnership.values()].some(
      (claim) =>
        claim.agent === suggestedOwner &&
        claim.paths.some((p) => p === dir || dir.startsWith(p + "/")),
    );

    suggestions.push({
      directory: dir,
      suggestedOwner,
      commits: dominant.count,
      percentage,
      alreadyClaimed,
    });
  }

  // Sort by confidence (percentage) descending
  suggestions.sort((a, b) => b.percentage - a.percentage);

  return { suggestions, authorStats: stats, ownershipApplied: false };
}

// ── Apply suggestions ──────────────────────────────────────────────────

export async function applyGitOwnership(
  projectRoot: string,
  agents: string[],
  options: {
    maxCommits?: number;
    depth?: number;
    threshold?: number;
    dryRun?: boolean;
  } = {},
): Promise<GitOwnershipResult> {
  const result = await suggestOwnership(projectRoot, agents, options);

  if (options.dryRun) return result;

  const unclaimed = result.suggestions.filter((s) => !s.alreadyClaimed);
  if (unclaimed.length === 0) return result;

  // Group by agent
  const agentPaths = new Map<string, string[]>();
  for (const s of unclaimed) {
    const paths = agentPaths.get(s.suggestedOwner) ?? [];
    paths.push(s.directory);
    agentPaths.set(s.suggestedOwner, paths);
  }

  for (const [agent, paths] of agentPaths) {
    const claim: ClaimOwnershipOptions = {
      agent,
      paths,
      mode: "exclusive",
      reason: "Auto-assigned from git history",
    };
    await claimOwnership(projectRoot, claim);
  }

  result.ownershipApplied = true;
  return result;
}

// ── Terminal formatting ────────────────────────────────────────────────

export function formatGitOwnership(
  result: GitOwnershipResult,
  dryRun: boolean,
): string {
  const lines: string[] = [];

  if (result.suggestions.length === 0) {
    lines.push("No ownership suggestions from git history.");
    if (result.authorStats.length === 0) {
      lines.push(
        "\x1b[90mNo matching commits found. Are the agent names the same as git author names?\x1b[0m",
      );
    }
    return lines.join("\n");
  }

  lines.push(
    `\x1b[1mGit-based ownership suggestions\x1b[0m (${result.suggestions.length})`,
  );
  lines.push("");

  for (const s of result.suggestions) {
    const status = s.alreadyClaimed
      ? "\x1b[32m✓ claimed\x1b[0m"
      : "\x1b[33m⚠ unclaimed\x1b[0m";
    lines.push(
      `  ${s.directory}/  →  \x1b[36m${s.suggestedOwner}\x1b[0m  ${s.percentage}% (${s.commits} commits)  ${status}`,
    );
  }

  lines.push("");

  const unclaimed = result.suggestions.filter((s) => !s.alreadyClaimed);
  if (unclaimed.length === 0) {
    lines.push("\x1b[32mAll suggested directories already claimed.\x1b[0m");
  } else if (dryRun) {
    lines.push(
      `\x1b[90m${unclaimed.length} unclaimed. Add --yes to apply.\x1b[0m`,
    );
  } else if (result.ownershipApplied) {
    lines.push(
      `\x1b[32m✓ Applied ${unclaimed.length} ownership claim(s).\x1b[0m`,
    );
  }

  return lines.join("\n");
}
