/**
 * Discussion → implementation pipeline.
 *
 * Takes a closed discussion's decision, cross-references with file ownership,
 * and creates handoff tasks assigned to the right agents.
 */

import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { posix, relative, resolve, sep } from "node:path";
import { getDiscussion, type DiscussionState } from "./discussion.js";
import { emit, getOwnership, readCoordLog } from "./coordinator.js";
import {
  applyPickup,
  getHandoffState,
  initHandoff,
  isHandoffInitialized,
  isPickupTarget,
  planPickup,
  sendHandoffUnlocked,
  withHandoffLock,
} from "../delegation/handoff.js";
import {
  createHandoffBundle,
  removeHandoffBundle,
} from "../delegation/handoff-bundle.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface ImplementationTask {
  agent: string;
  description: string;
  context: string;
  paths: string[];
}

export interface ImplementationPlan {
  planId: string;
  threadId: string;
  decision: string;
  tasks: ImplementationTask[];
  unassigned: string[];
}

export interface PipelineResult {
  plan: ImplementationPlan;
  handoffsSent: number;
  handoffIds: string[];
  reused: boolean;
}

// ── Task extraction ────────────────────────────────────────────────────

/**
 * Parse a discussion's decision + transcript into implementation tasks.
 *
 * Strategy: extract file/directory references from the transcript, match
 * them against ownership, and group work by agent. Falls back to assigning
 * everything to the participants if no paths are mentioned.
 */
export async function buildImplementationPlan(
  projectRoot: string,
  threadId: string,
): Promise<ImplementationPlan> {
  const discussion = await getDiscussion(projectRoot, threadId);
  if (!discussion) {
    throw new Error(`Discussion '${threadId}' not found`);
  }
  if (discussion.status !== "closed") {
    throw new Error(
      `Discussion '${threadId}' is ${discussion.status} — only closed discussions can be implemented`,
    );
  }
  if (!discussion.finalDecision) {
    throw new Error(`Discussion '${threadId}' has no final decision`);
  }

  const ownership = await getOwnership(projectRoot);
  const mentionedPaths = extractPaths(discussion);
  const [proposer, reviewer] = discussion.participants;

  // Group mentioned paths by owning agent
  const agentPaths = new Map<string, string[]>();
  const unassigned: string[] = [];

  for (const path of mentionedPaths) {
    const owner = findOwnerForPath(path, ownership);
    if (owner) {
      const existing = agentPaths.get(owner) ?? [];
      existing.push(path);
      agentPaths.set(owner, existing);
    } else {
      unassigned.push(path);
    }
  }

  const tasks: ImplementationTask[] = [];

  if (agentPaths.size > 0) {
    // Build tasks based on ownership
    for (const [agent, paths] of agentPaths) {
      tasks.push({
        agent,
        description: buildTaskDescription(discussion.finalDecision, paths),
        context: buildTaskContext(discussion),
        paths,
      });
    }
  } else {
    // No paths detected or no ownership → split between participants
    // Proposer implements the decision, reviewer validates
    tasks.push({
      agent: proposer,
      description: `Implement: ${discussion.finalDecision}`,
      context: buildTaskContext(discussion),
      paths: [],
    });
    tasks.push({
      agent: reviewer,
      description: `Review and validate: ${discussion.finalDecision}`,
      context: buildTaskContext(discussion),
      paths: [],
    });
  }

  const planIdentity = JSON.stringify({
    threadId,
    decision: discussion.finalDecision,
    tasks: tasks.map(({ agent, description, paths }) => ({
      agent,
      description,
      paths,
    })),
  });
  return {
    planId: createHash("sha256")
      .update(planIdentity)
      .digest("hex")
      .slice(0, 16),
    threadId,
    decision: discussion.finalDecision,
    tasks,
    unassigned,
  };
}

// ── Handoff creation ───────────────────────────────────────────────────

export async function executeImplementationPlan(
  projectRoot: string,
  plan: ImplementationPlan,
): Promise<PipelineResult> {
  if (plan.unassigned.length > 0)
    throw new Error(
      `Implementation plan has unassigned paths: ${plan.unassigned.join(", ")}. Claim ownership and preview again.`,
    );
  // Re-read and append under the same cross-process lock. Keep setup and the
  // summary inside it as well, so concurrent applies cannot race either step.
  return withHandoffLock(projectRoot, async () => {
    if (!(await isHandoffInitialized(projectRoot))) {
      await initHandoff(projectRoot);
    }
    for (const agent of new Set(plan.tasks.map((task) => task.agent))) {
      if (!isPickupTarget(agent)) continue;
      const pickup = await planPickup(projectRoot, agent);
      if (!pickup.replacing) await applyPickup(pickup);
    }
    const marker = `[loadout-implementation:${plan.planId}]`;
    const initialState = await getHandoffState(projectRoot);
    let sent = 0;
    const handoffIds: string[] = [];
    for (const task of plan.tasks) {
      const existing = initialState.messages.find(
        (message) =>
          message.type === "task" &&
          message.to === task.agent &&
          message.context?.includes(marker),
      );
      if (existing) {
        handoffIds.push(existing.id);
        continue;
      }
      const bundlePaths: string[] = [];
      for (const path of task.paths) {
        try {
          const root = resolve(projectRoot);
          const absolute = resolve(root, path);
          const local = relative(root, absolute);
          if (
            local &&
            local !== ".." &&
            !local.startsWith(`..${sep}`) &&
            (await lstat(absolute)).isFile()
          )
            bundlePaths.push(path);
        } catch {
          // A discussed path may be planned but not created yet.
        }
      }
      const bundle = bundlePaths.length
        ? await createHandoffBundle(projectRoot, bundlePaths)
        : undefined;
      let message;
      try {
        message = await sendHandoffUnlocked(
          projectRoot,
          task.agent,
          task.description,
          {
            from: "loadout",
            type: "task",
            context: `${marker}\n${task.context}`,
            ...(bundle ? { bundle } : {}),
            verification: {
              criteria:
                "Implementation matches the recorded discussion decision and reported checks pass",
            },
          },
        );
      } catch (error) {
        if (bundle) await removeHandoffBundle(projectRoot, bundle);
        throw error;
      }
      handoffIds.push(message.id);
      sent++;
    }

    const eventDescription = `Implementation plan ${plan.planId} dispatched`;
    const log = await readCoordLog(projectRoot);
    if (!log.events.some((event) => event.description === eventDescription)) {
      await emit(projectRoot, {
        from: "loadout",
        to: "*",
        type: "update",
        description: eventDescription,
        payload: {
          note: `Discussion ${plan.threadId} created handoffs: ${handoffIds.join(", ")}`,
          files: plan.tasks.flatMap((task) => task.paths),
        },
      });
    }
    return { plan, handoffsSent: sent, handoffIds, reused: sent === 0 };
  });
}

/** Build plan + send handoffs in one call. */
export async function runPipeline(
  projectRoot: string,
  threadId: string,
  options: { dryRun?: boolean } = {},
): Promise<PipelineResult> {
  const plan = await buildImplementationPlan(projectRoot, threadId);
  if (options.dryRun) {
    return { plan, handoffsSent: 0, handoffIds: [], reused: false };
  }
  return executeImplementationPlan(projectRoot, plan);
}

// ── Path extraction ────────────────────────────────────────────────────

// Matches file-like references: src/foo/bar.ts, lib/utils, ./components
const PATH_PATTERN =
  /(?:^|\s|`)((?:\.\/|src\/|lib\/|app\/|packages\/|server\/|client\/|tests\/|test\/)[a-zA-Z0-9_\-/.]+)/g;
const MAX_IMPLEMENTATION_PATHS = 256;

function addImplementationPath(paths: Set<string>, candidate: string): void {
  let path = candidate.trim().replace(/[.,;:!?)]+$/, "");
  if (path.startsWith("./")) path = path.slice(2);
  const normalized = posix.normalize(path);
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    posix.isAbsolute(normalized)
  )
    return;
  paths.add(normalized);
  if (paths.size > MAX_IMPLEMENTATION_PATHS) {
    throw new Error(
      `Discussion references more than ${MAX_IMPLEMENTATION_PATHS} unique paths; narrow the decision before implementation`,
    );
  }
}

function extractPaths(discussion: DiscussionState): string[] {
  const paths = new Set<string>();

  // Scan all discussion event content
  for (const event of discussion.events) {
    const payload = event.payload as { content?: string } | undefined;
    if (!payload?.content) continue;

    PATH_PATTERN.lastIndex = 0;
    let match;
    while ((match = PATH_PATTERN.exec(payload.content)) !== null) {
      addImplementationPath(paths, match[1]);
    }
  }

  // Also scan the decision itself
  if (discussion.finalDecision) {
    PATH_PATTERN.lastIndex = 0;
    let match;
    while ((match = PATH_PATTERN.exec(discussion.finalDecision)) !== null) {
      addImplementationPath(paths, match[1]);
    }
  }

  return [...paths];
}

function findOwnerForPath(
  filePath: string,
  ownership: Map<string, { agent: string; paths: string[] }>,
): string | undefined {
  let bestMatch = "";
  let bestAgent: string | undefined;

  for (const [, claim] of ownership) {
    for (const ownedPath of claim.paths) {
      const normalized = ownedPath.endsWith("/")
        ? ownedPath.slice(0, -1)
        : ownedPath;
      if (
        (filePath === normalized ||
          filePath.startsWith(normalized + "/") ||
          normalized === ".") &&
        normalized.length > bestMatch.length
      ) {
        bestMatch = normalized;
        bestAgent = claim.agent;
      }
    }
  }

  return bestAgent;
}

// ── Task description builders ──────────────────────────────────────────

function buildTaskDescription(decision: string, paths: string[]): string {
  const pathList = paths.slice(0, 5).join(", ");
  const more = paths.length > 5 ? ` (+${paths.length - 5} more)` : "";
  return `Implement in ${pathList}${more}: ${decision}`;
}

function buildTaskContext(discussion: DiscussionState): string {
  const lines: string[] = [
    `From discussion ${discussion.threadId}: ${discussion.topic}`,
    `Decision: ${discussion.finalDecision}`,
  ];

  if (discussion.alternatives.length > 0) {
    lines.push(
      `Alternatives considered: ${discussion.alternatives.join("; ")}`,
    );
  }
  if (discussion.unresolved.length > 0) {
    lines.push(`Unresolved: ${discussion.unresolved.join("; ")}`);
  }

  // Include last round's content for implementation context
  const lastEvents = discussion.events.slice(-4);
  for (const event of lastEvents) {
    const payload = event.payload as {
      kind?: string;
      content?: string;
      round?: number;
    };
    if (payload?.content) {
      const preview = payload.content.slice(0, 500);
      lines.push(
        `[${payload.kind} r${payload.round}] ${event.from}: ${preview}`,
      );
    }
  }

  return lines.join("\n");
}

// ── Terminal formatting ────────────────────────────────────────────────

export function formatPlan(
  plan: ImplementationPlan,
  dryRun: boolean,
  handoffsSent = plan.tasks.length,
  reused = false,
): string {
  const lines: string[] = [];

  lines.push(
    `\x1b[1mImplementation plan\x1b[0m from discussion ${plan.threadId}`,
  );
  lines.push(`Plan ID: \x1b[90m${plan.planId}\x1b[0m`);
  lines.push(`Decision: \x1b[36m${plan.decision}\x1b[0m`);
  lines.push("");

  for (let i = 0; i < plan.tasks.length; i++) {
    const task = plan.tasks[i];
    const color = i === 0 ? "\x1b[36m" : "\x1b[33m";
    lines.push(`  ${color}${task.agent}\x1b[0m`);
    lines.push(`    ${task.description}`);
    if (task.paths.length > 0) {
      lines.push(`    Paths: ${task.paths.join(", ")}`);
    }
    lines.push("");
  }

  if (plan.unassigned.length > 0) {
    lines.push(
      `\x1b[90mUnassigned paths: ${plan.unassigned.join(", ")}\x1b[0m`,
    );
    lines.push("");
  }

  if (dryRun) {
    lines.push(
      "\x1b[90mDry run — no handoffs sent. Add --yes to send tasks.\x1b[0m",
    );
  } else if (reused) {
    lines.push(
      "\x1b[32m✓ This plan was already dispatched; no duplicate tasks were created.\x1b[0m",
    );
  } else {
    lines.push(`\x1b[32m✓ ${handoffsSent} handoff task(s) sent.\x1b[0m`);
    lines.push(
      "  Each agent will see the task on their next `loadout handoff <agent>` check.",
    );
  }

  return lines.join("\n");
}
