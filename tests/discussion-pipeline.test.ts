import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { emit, readCoordLog } from "../src/core/coordination/coordinator.js";
import { claimOwnership } from "../src/core/coordination/coordinator.js";
import {
  getHandoffState,
  initHandoff,
} from "../src/core/delegation/handoff.js";
import {
  buildImplementationPlan,
  executeImplementationPlan,
  runPipeline,
  formatPlan,
} from "../src/core/coordination/discussion-pipeline.js";

/**
 * Helper: create a minimal closed discussion in the coordination log.
 */
async function createClosedDiscussion(
  root: string,
  threadId: string,
  options: {
    topic: string;
    decision: string;
    participants?: [string, string];
    proposalContent?: string;
    critiqueContent?: string;
    alternatives?: string[];
    unresolved?: string[];
  },
) {
  const [proposer, reviewer] = options.participants ?? ["claude-code", "codex"];

  // started
  await emit(root, {
    from: "user",
    to: "*",
    type: "discussion",
    description: options.topic,
    payload: {
      threadId,
      kind: "started",
      round: 0,
      role: "system",
      content: options.topic,
      participants: [proposer, reviewer],
    },
  });

  // proposal
  await emit(root, {
    from: proposer,
    to: reviewer,
    type: "discussion",
    description: "proposal",
    payload: {
      threadId,
      kind: "proposal",
      round: 1,
      role: "proposer",
      content:
        options.proposalContent ?? "We should refactor src/api/handler.ts",
      replyTo: "started",
    },
  });

  // critique
  await emit(root, {
    from: reviewer,
    to: proposer,
    type: "discussion",
    description: "critique",
    payload: {
      threadId,
      kind: "critique",
      round: 1,
      role: "reviewer",
      content:
        options.critiqueContent ??
        "Agree but also update src/client/types.ts for consistency",
      replyTo: "proposal",
    },
  });

  // summary
  await emit(root, {
    from: proposer,
    to: "*",
    type: "discussion",
    description: options.decision,
    payload: {
      threadId,
      kind: "summary",
      round: 1,
      role: "proposer",
      content: "rationale here",
      replyTo: "critique",
      alternatives: options.alternatives ?? [],
      unresolved: options.unresolved ?? [],
    },
  });

  // closed
  await emit(root, {
    from: "user",
    to: "*",
    type: "discussion",
    description: options.decision,
    payload: {
      threadId,
      kind: "closed",
      round: 1,
      role: "system",
      content: options.decision,
      replyTo: "summary",
      alternatives: options.alternatives ?? [],
      unresolved: options.unresolved ?? [],
      outcome: "decided",
    },
  });
}

describe("discussion-pipeline", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-pipeline-"));
    await mkdir(join(root, ".handoff"), { recursive: true });
  });

  it("rejects non-existent discussion", async () => {
    await expect(buildImplementationPlan(root, "nope")).rejects.toThrow(
      "not found",
    );
  });

  it("rejects open discussion", async () => {
    // Only emit started event — still open
    await emit(root, {
      from: "user",
      to: "*",
      type: "discussion",
      description: "test topic",
      payload: {
        threadId: "open-one",
        kind: "started",
        round: 0,
        role: "system",
        content: "test topic",
        participants: ["claude-code", "codex"],
      },
    });

    await expect(buildImplementationPlan(root, "open-one")).rejects.toThrow(
      "only closed discussions",
    );
  });

  it("rejects discussions that exceed the coordination event file limit", async () => {
    const paths = Array.from(
      { length: 257 },
      (_, index) => `src/f${index}.ts`,
    ).join(" ");
    await createClosedDiscussion(root, "too-many-paths", {
      topic: "Large migration",
      decision: "Apply the migration",
      proposalContent: paths,
      critiqueContent: "Keep the migration bounded",
    });

    await expect(
      buildImplementationPlan(root, "too-many-paths"),
    ).rejects.toThrow(/more than 256 unique paths/i);
  });

  it("does not treat traversal-shaped references as owned project paths", async () => {
    await claimOwnership(root, {
      agent: "claude-code",
      paths: ["src"],
      mode: "exclusive",
    });
    await createClosedDiscussion(root, "unsafe-path", {
      topic: "Check a suspicious path",
      decision: "Do not escape the repository",
      proposalContent: "Inspect src/../../outside.txt",
      critiqueContent: "Keep all work in the project",
    });

    const plan = await buildImplementationPlan(root, "unsafe-path");
    expect(plan.tasks.every((task) => task.paths.length === 0)).toBe(true);
  });

  it("assigns tasks based on file ownership", async () => {
    await claimOwnership(root, {
      agent: "claude-code",
      paths: ["src/api"],
      mode: "exclusive",
    });
    await claimOwnership(root, {
      agent: "codex",
      paths: ["src/client"],
      mode: "exclusive",
    });

    await createClosedDiscussion(root, "split-work", {
      topic: "How to refactor auth",
      decision: "Refactor auth into shared module",
      proposalContent:
        "We should move auth logic from src/api/handler.ts to a shared module",
      critiqueContent: "Also update src/client/types.ts and src/client/auth.ts",
    });

    const plan = await buildImplementationPlan(root, "split-work");

    expect(plan.decision).toBe("Refactor auth into shared module");
    expect(plan.tasks.length).toBeGreaterThanOrEqual(2);

    const claudeTask = plan.tasks.find((t) => t.agent === "claude-code");
    const codexTask = plan.tasks.find((t) => t.agent === "codex");
    expect(claudeTask).toBeDefined();
    expect(codexTask).toBeDefined();
    expect(claudeTask!.paths).toContain("src/api/handler.ts");
    expect(codexTask!.paths.some((p) => p.startsWith("src/client/"))).toBe(
      true,
    );
  });

  it("falls back to participant split when no paths detected", async () => {
    await createClosedDiscussion(root, "no-paths", {
      topic: "Database migration strategy",
      decision: "Use online migration with dual-write",
      proposalContent: "Online migration is safer for production",
      critiqueContent: "Agree, dual-write minimizes risk",
    });

    const plan = await buildImplementationPlan(root, "no-paths");

    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0].agent).toBe("claude-code");
    expect(plan.tasks[0].description).toContain("Implement");
    expect(plan.tasks[1].agent).toBe("codex");
    expect(plan.tasks[1].description).toContain("Review and validate");
  });

  it("dry run does not send handoffs", async () => {
    // Initialize handoff directory
    await initHandoff(root);

    await createClosedDiscussion(root, "dry-run", {
      topic: "Test dry run",
      decision: "Do the thing",
    });

    const result = await runPipeline(root, "dry-run", { dryRun: true });
    expect(result.handoffsSent).toBe(0);
    expect(result.plan.tasks.length).toBeGreaterThan(0);
  });

  it("sends handoffs when not dry run", async () => {
    // Initialize handoff directory
    await initHandoff(root);

    await createClosedDiscussion(root, "send-it", {
      topic: "Test sending",
      decision: "Ship it",
      proposalContent: "Implement the accepted decision",
      critiqueContent: "Review the result after implementation",
    });

    const result = await runPipeline(root, "send-it", { dryRun: false });
    expect(result.handoffsSent).toBe(2);
    expect(result.handoffIds).toHaveLength(2);
    expect(
      (await getHandoffState(root)).messages
        .filter((message) => message.type === "task")
        .every((message) => !!message.verification),
    ).toBe(true);

    const repeated = await runPipeline(root, "send-it", { dryRun: false });
    expect(repeated.handoffsSent).toBe(0);
    expect(repeated.handoffIds).toEqual(result.handoffIds);
    expect(repeated.reused).toBe(true);
    expect(
      formatPlan(repeated.plan, false, repeated.handoffsSent, repeated.reused),
    ).toContain("already dispatched");
  });

  it("keeps a fresh preview read-only and sets up pickup instructions on apply", async () => {
    await writeFile(join(root, "AGENTS.md"), "# Project rules\nKeep this.\n");
    await createClosedDiscussion(root, "fresh-apply", {
      topic: "Fresh project",
      decision: "Implement the accepted decision",
      proposalContent: "Make the change",
      critiqueContent: "Validate the change",
    });
    const filesBefore = await readdir(root, { recursive: true });
    const logBefore = await readFile(
      join(root, ".handoff/coordination.jsonl"),
      "utf8",
    );

    const preview = await runPipeline(root, "fresh-apply", { dryRun: true });

    expect(await readdir(root, { recursive: true })).toEqual(filesBefore);
    expect(
      await readFile(join(root, ".handoff/coordination.jsonl"), "utf8"),
    ).toBe(logBefore);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(
      "# Project rules\nKeep this.\n",
    );
    expect((await getHandoffState(root)).initialized).toBe(false);

    const result = await executeImplementationPlan(root, preview.plan);

    expect(result.handoffsSent).toBe(2);
    expect((await getHandoffState(root)).initialized).toBe(true);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain(
      "# Project rules\nKeep this.",
    );
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain(
      "loadout handoff codex",
    );
    expect(await readFile(join(root, "CLAUDE.md"), "utf8")).toContain(
      "loadout handoff claude-code",
    );
  });

  it("concurrent applies reuse the same task IDs and dispatch summary", async () => {
    await initHandoff(root);
    await createClosedDiscussion(root, "concurrent-apply", {
      topic: "Concurrent dispatch",
      decision: "Implement the accepted decision",
      proposalContent: "Make the change",
      critiqueContent: "Validate the change",
    });
    const plan = await buildImplementationPlan(root, "concurrent-apply");

    const results = await Promise.all([
      executeImplementationPlan(root, plan),
      executeImplementationPlan(root, plan),
    ]);

    const tasks = (await getHandoffState(root)).messages.filter(
      (message) => message.type === "task",
    );
    expect(tasks).toHaveLength(2);
    expect(results[0].handoffIds).toEqual(results[1].handoffIds);
    expect(results.map((result) => result.handoffsSent).sort()).toEqual([0, 2]);
    expect(
      (await readCoordLog(root)).events.filter(
        (event) =>
          event.description === `Implementation plan ${plan.planId} dispatched`,
      ),
    ).toHaveLength(1);
  });

  it("retries a partial dispatch without replacing the first task or bundle", async () => {
    await initHandoff(root);
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/first.ts"), "export const first = true;\n");
    await writeFile(join(root, "src/second.ts"), Buffer.from([0, 1, 2]));
    await claimOwnership(root, {
      agent: "claude-code",
      paths: ["src/first.ts"],
      mode: "exclusive",
    });
    await claimOwnership(root, {
      agent: "codex",
      paths: ["src/second.ts"],
      mode: "exclusive",
    });
    await createClosedDiscussion(root, "partial-apply", {
      topic: "Partial dispatch",
      decision: "Update both files",
      proposalContent: "Update src/first.ts",
      critiqueContent: "Also update src/second.ts",
    });
    const plan = await buildImplementationPlan(root, "partial-apply");

    await expect(executeImplementationPlan(root, plan)).rejects.toThrow(
      /binary/i,
    );
    const firstTasks = (await getHandoffState(root)).messages;
    expect(firstTasks).toHaveLength(1);
    expect(firstTasks[0].bundle).toBeDefined();
    expect(
      (await readCoordLog(root)).events.filter(
        (event) =>
          event.description === `Implementation plan ${plan.planId} dispatched`,
      ),
    ).toHaveLength(0);

    await writeFile(
      join(root, "src/second.ts"),
      "export const second = true;\n",
    );
    const retried = await executeImplementationPlan(root, plan);
    const tasks = (await getHandoffState(root)).messages;
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual(firstTasks[0]);
    expect(retried.handoffIds).toEqual(tasks.map((task) => task.id));
    expect(retried.handoffsSent).toBe(1);
  });

  it("bundles existing owned files into implementation handoffs", async () => {
    await initHandoff(root);
    await mkdir(join(root, "src/api"), { recursive: true });
    await writeFile(
      join(root, "src/api/handler.ts"),
      "export const ok = true;\n",
    );
    await claimOwnership(root, {
      agent: "claude-code",
      paths: ["src/api"],
      mode: "exclusive",
    });
    await createClosedDiscussion(root, "bundle-work", {
      topic: "Refactor handler",
      decision: "Refactor the handler",
      proposalContent: "Update src/api/handler.ts",
      critiqueContent: "Keep its public behavior",
    });

    await runPipeline(root, "bundle-work", { dryRun: false });
    const task = (await getHandoffState(root)).messages.find(
      (message) => message.type === "task" && message.to === "claude-code",
    );
    expect(task?.bundle).toMatchObject({ fileCount: 1 });
  });

  it("refuses approved execution when discussed paths have no owner", async () => {
    await initHandoff(root);
    await createClosedDiscussion(root, "unowned-work", {
      topic: "Change an unowned file",
      decision: "Update the configuration",
      proposalContent: "Update src/unowned.ts",
      critiqueContent: "Keep it compatible",
    });

    await expect(
      runPipeline(root, "unowned-work", { dryRun: false }),
    ).rejects.toThrow(/unassigned/i);
    expect((await getHandoffState(root)).messages).toHaveLength(0);
  });

  it("includes context from discussion in tasks", async () => {
    await createClosedDiscussion(root, "ctx-test", {
      topic: "API versioning",
      decision: "Use URL path versioning",
      alternatives: ["Header versioning"],
      unresolved: ["Migration timeline"],
    });

    const plan = await buildImplementationPlan(root, "ctx-test");
    const context = plan.tasks[0].context;

    expect(context).toContain("API versioning");
    expect(context).toContain("Use URL path versioning");
    expect(context).toContain("Header versioning");
    expect(context).toContain("Migration timeline");
  });

  it("formats plan for terminal output", async () => {
    await createClosedDiscussion(root, "fmt-test", {
      topic: "Format test",
      decision: "Format it",
    });

    const plan = await buildImplementationPlan(root, "fmt-test");
    const output = formatPlan(plan, true);

    expect(output).toContain("Implementation plan");
    expect(output).toContain("fmt-test");
    expect(output).toContain("Dry run");
    expect(output).toContain("claude-code");
    expect(output).toContain("codex");
  });
});
