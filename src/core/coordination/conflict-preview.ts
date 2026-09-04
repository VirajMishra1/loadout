/**
 * Conflict preview — detect and show what another agent changed in files
 * you're about to write, before you write them.
 *
 * Uses the ownership map + git diff to surface inter-agent conflicts
 * before they become merge problems.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getOwnership } from "./coordinator.js";

const exec = promisify(execFile);

export interface FileConflict {
  path: string;
  owner: string;
  ownerMode: "exclusive" | "shared";
  /** Git diff of what the owner changed (empty if no changes). */
  diff: string;
  /** Number of lines changed by the owner. */
  linesChanged: number;
  /** Whether the file was added, modified, or deleted by the owner. */
  status: "added" | "modified" | "deleted" | "unchanged";
}

export interface ConflictPreview {
  agent: string;
  requestedPaths: string[];
  conflicts: FileConflict[];
  safe: string[];
  timestamp: string;
}

/**
 * Preview conflicts before writing to files.
 *
 * Checks the ownership map and git status to show what another agent
 * has changed in files you want to write. Call this before claiming
 * ownership or writing.
 */
export async function previewConflicts(
  projectRoot: string,
  agent: string,
  paths: string[],
): Promise<ConflictPreview> {
  const ownership = await getOwnership(projectRoot);
  const conflicts: FileConflict[] = [];
  const safe: string[] = [];

  for (const path of paths) {
    // Check if any ownership claim covers this path
    let conflicting: { agent: string; mode: "exclusive" | "shared" } | null =
      null;

    for (const claim of ownership.values()) {
      if (claim.agent === agent) continue; // Skip own claims

      for (const ownedPath of claim.paths) {
        if (pathOverlaps(path, ownedPath)) {
          conflicting = { agent: claim.agent, mode: claim.mode };
          break;
        }
      }
      if (conflicting) break;
    }

    if (!conflicting) {
      safe.push(path);
      continue;
    }

    // Get git diff for what the other agent changed
    const { diff, linesChanged, status } = await getGitDiff(projectRoot, path);

    conflicts.push({
      path,
      owner: conflicting.agent,
      ownerMode: conflicting.mode,
      diff,
      linesChanged,
      status,
    });
  }

  return {
    agent,
    requestedPaths: paths,
    conflicts,
    safe,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format conflict preview for terminal display.
 */
export function formatConflictPreview(preview: ConflictPreview): string {
  const lines: string[] = [];

  if (preview.conflicts.length === 0) {
    lines.push(
      `\x1b[32m✓\x1b[0m No conflicts — ${preview.safe.length} path(s) safe to write.`,
    );
    return lines.join("\n");
  }

  lines.push(
    `\x1b[33m⚠ ${preview.conflicts.length} conflict(s) detected\x1b[0m`,
  );
  lines.push("");

  for (const c of preview.conflicts) {
    const modeIcon = c.ownerMode === "exclusive" ? "🔒" : "🔓";
    lines.push(
      `${modeIcon} \x1b[1m${c.path}\x1b[0m — owned by \x1b[36m${c.owner}\x1b[0m (${c.ownerMode})`,
    );

    if (c.status !== "unchanged") {
      lines.push(
        `  ${c.status === "added" ? "➕" : c.status === "deleted" ? "➖" : "✏️"} ${c.linesChanged} line(s) ${c.status}`,
      );
    }

    if (c.diff) {
      // Show first 20 lines of diff
      const diffLines = c.diff.split("\n").slice(0, 20);
      for (const dl of diffLines) {
        if (dl.startsWith("+") && !dl.startsWith("+++")) {
          lines.push(`  \x1b[32m${dl}\x1b[0m`);
        } else if (dl.startsWith("-") && !dl.startsWith("---")) {
          lines.push(`  \x1b[31m${dl}\x1b[0m`);
        } else if (dl.startsWith("@@")) {
          lines.push(`  \x1b[36m${dl}\x1b[0m`);
        }
      }
      if (c.diff.split("\n").length > 20) {
        lines.push(`  ... (${c.diff.split("\n").length - 20} more lines)`);
      }
    }

    lines.push("");
  }

  if (preview.safe.length > 0) {
    lines.push(
      `\x1b[32m✓\x1b[0m ${preview.safe.length} path(s) safe: ${preview.safe.join(", ")}`,
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pathOverlaps(requested: string, owned: string): boolean {
  // Normalize trailing slashes
  const r = requested.replace(/\/$/, "");
  const o = owned.replace(/\/$/, "");

  // Exact match
  if (r === o) return true;

  // Owned is a directory containing the requested path
  if (r.startsWith(o + "/")) return true;

  // Requested is a directory containing the owned path
  if (o.startsWith(r + "/")) return true;

  return false;
}

async function getGitDiff(
  projectRoot: string,
  path: string,
): Promise<{
  diff: string;
  linesChanged: number;
  status: FileConflict["status"];
}> {
  try {
    // Check if path has uncommitted changes
    const { stdout: statusOut } = await exec(
      "git",
      ["status", "--porcelain", "--", path],
      { cwd: projectRoot, timeout: 5000 },
    );

    if (!statusOut.trim()) {
      // Check for committed changes vs main
      try {
        const { stdout: diffOut } = await exec(
          "git",
          ["diff", "HEAD~5..HEAD", "--", path],
          { cwd: projectRoot, timeout: 5000 },
        );
        if (diffOut.trim()) {
          const added = (diffOut.match(/^\+[^+]/gm) ?? []).length;
          const removed = (diffOut.match(/^-[^-]/gm) ?? []).length;
          return {
            diff: diffOut,
            linesChanged: added + removed,
            status: "modified",
          };
        }
      } catch {
        // Not enough history
      }
      return { diff: "", linesChanged: 0, status: "unchanged" };
    }

    const statusCode = statusOut.trim().slice(0, 2);

    if (statusCode.includes("A") || statusCode === "??") {
      return { diff: "", linesChanged: 0, status: "added" };
    }
    if (statusCode.includes("D")) {
      return { diff: "", linesChanged: 0, status: "deleted" };
    }

    // Get the actual diff
    const { stdout: diffOut } = await exec("git", ["diff", "--", path], {
      cwd: projectRoot,
      timeout: 5000,
    });

    const added = (diffOut.match(/^\+[^+]/gm) ?? []).length;
    const removed = (diffOut.match(/^-[^-]/gm) ?? []).length;

    return {
      diff: diffOut,
      linesChanged: added + removed,
      status: "modified",
    };
  } catch {
    return { diff: "", linesChanged: 0, status: "unchanged" };
  }
}
