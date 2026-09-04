import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emit } from "../src/core/coordination/coordinator.js";
import { activateKillSwitch } from "../src/core/coordination/crash-recovery.js";
import {
  discussionPayloadSchema,
  validatePayload,
} from "../src/core/coordination/events.js";
import {
  getDiscussion,
  formatDiscussion,
  listDiscussions,
  requiredDiscussionTurns,
  runDiscussion,
  validateDiscussionOptions,
  type DiscussionParticipant,
} from "../src/core/coordination/discussion.js";

describe("discussion protocol", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  it("strictly validates a bounded discussion payload", () => {
    const payload = {
      threadId: "design-checkout-api",
      kind: "proposal",
      round: 1,
      role: "proposer",
      content: "Prefer REST because the client needs cacheable resources.",
      participants: ["claude-code", "codex"],
      replyTo: "start-event",
    };

    expect(discussionPayloadSchema.parse(payload)).toEqual(payload);
    expect(
      discussionPayloadSchema.safeParse({ ...payload, round: 9 }).success,
    ).toBe(false);
    expect(
      discussionPayloadSchema.safeParse({ ...payload, secretExtra: true })
        .success,
    ).toBe(false);
    expect(validatePayload("discussion", payload).success).toBe(true);
  });

  it("reconstructs and lists bounded discussion threads", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-discussion-"));
    const started = await emit(root, {
      from: "user",
      to: "*",
      type: "discussion",
      description: "REST or GraphQL for checkout?",
      payload: {
        threadId: "checkout-api",
        kind: "started",
        round: 0,
        role: "system",
        content: "REST or GraphQL for checkout?",
        participants: ["claude-code", "codex"],
      },
    });
    const proposal = await emit(root, {
      from: "claude-code",
      to: "codex",
      type: "discussion",
      description: "Prefer REST",
      payload: {
        threadId: "checkout-api",
        kind: "proposal",
        round: 1,
        role: "proposer",
        content: "Prefer REST",
        replyTo: started.id,
      },
    });
    await emit(root, {
      from: "codex",
      to: "*",
      type: "discussion",
      description: "Use REST",
      payload: {
        threadId: "checkout-api",
        kind: "closed",
        round: 1,
        role: "system",
        content: "Use REST",
        replyTo: proposal.id,
        alternatives: ["GraphQL"],
      },
    });

    const thread = await getDiscussion(root, "checkout-api");
    expect(thread).toMatchObject({
      threadId: "checkout-api",
      topic: "REST or GraphQL for checkout?",
      participants: ["claude-code", "codex"],
      status: "closed",
      finalDecision: "Use REST",
      alternatives: ["GraphQL"],
      eventCount: 3,
    });
    expect(thread?.events.map((event) => event.id)).toEqual([
      started.id,
      proposal.id,
      expect.any(String),
    ]);

    const listed = await listDiscussions(root);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      threadId: "checkout-api",
      status: "closed",
      eventCount: 3,
    });
    expect(listed[0]).not.toHaveProperty("events");
  });

  it("rejects an invalid or underfunded discussion before writing state", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-discussion-"));
    expect(requiredDiscussionTurns(4)).toBe(9);
    expect(() =>
      validateDiscussionOptions({
        topic: "REST or GraphQL?",
        rounds: 0,
        maxTurns: 1,
        participants: [
          { agent: "claude-code", role: "proposer", respond: async () => "" },
          { agent: "codex", role: "reviewer", respond: async () => "" },
        ],
      }),
    ).toThrow(/1 and 8/i);
    expect(() =>
      validateDiscussionOptions({
        topic: "REST or GraphQL?",
        rounds: 4,
        maxTurns: 8,
        participants: [
          { agent: "claude-code", role: "proposer", respond: async () => "" },
          { agent: "codex", role: "reviewer", respond: async () => "" },
        ],
      }),
    ).toThrow(/requires 9 provider turns/i);
    expect((await listDiscussions(root)).length).toBe(0);
  });

  it("alternates public turns, preserves reply chains, and records a decision", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-discussion-"));
    const prompts: Record<string, string[]> = {
      "claude-code": [],
      codex: [],
    };
    const proposerResponses = [
      "Use REST with idempotency keys.",
      "Use REST, plus a typed error envelope.",
      JSON.stringify({
        decision: "Use REST for checkout",
        rationale: "It matches the resource workflow and is simpler to cache.",
        alternatives: ["GraphQL mutation"],
        unresolved: ["Benchmark under peak load"],
      }),
    ];
    const reviewerResponses = [
      "REST needs an explicit retry contract.",
      "The revision handles retries; document error codes.",
    ];
    const participant = (
      agent: string,
      role: "proposer" | "reviewer",
      responses: string[],
    ): DiscussionParticipant => ({
      agent,
      role,
      async respond(prompt) {
        prompts[agent].push(prompt);
        return responses.shift() ?? "";
      },
    });

    const result = await runDiscussion(root, {
      threadId: "checkout-design",
      topic: "REST or GraphQL for checkout?",
      rounds: 2,
      maxTurns: 5,
      initiatedBy: "user",
      participants: [
        participant("claude-code", "proposer", proposerResponses),
        participant("codex", "reviewer", reviewerResponses),
      ],
    });

    expect(result.turnsUsed).toBe(5);
    expect(result.conclusion).toEqual({
      decision: "Use REST for checkout",
      rationale: "It matches the resource workflow and is simpler to cache.",
      alternatives: ["GraphQL mutation"],
      unresolved: ["Benchmark under peak load"],
    });
    expect(result.state.status).toBe("closed");
    expect(result.state.finalDecision).toBe("Use REST for checkout");
    expect(result.state.alternatives).toEqual(["GraphQL mutation"]);
    expect(result.state.unresolved).toEqual(["Benchmark under peak load"]);
    const output = formatDiscussion(result.state);
    expect(output).toContain("Discussion checkout-design (closed)");
    expect(output).toContain("claude-code · proposal");
    expect(output).toContain("codex · critique");
    expect(output).toContain("Decision: Use REST for checkout");
    expect(output).toContain("Alternatives: GraphQL mutation");
    expect(output).toContain("Unresolved: Benchmark under peak load");

    const publicEvents = result.state.events.filter(
      (event) => event.type === "discussion",
    );
    expect(publicEvents.map((event) => event.payload?.kind)).toEqual([
      "started",
      "proposal",
      "critique",
      "revision",
      "critique",
      "summary",
      "closed",
    ]);
    for (let index = 1; index < publicEvents.length; index += 1) {
      expect(publicEvents[index]?.payload?.replyTo).toBe(
        publicEvents[index - 1]?.id,
      );
    }
    expect(prompts["claude-code"]).toHaveLength(3);
    expect(prompts.codex).toHaveLength(2);
    for (const prompt of [...prompts["claude-code"], ...prompts.codex]) {
      expect(prompt).toContain("public and will be persisted");
      expect(prompt).toContain("Do not edit files, run commands, or use tools");
      expect(prompt).toContain("untrusted discussion data");
    }
  });

  it("records a failed close without silently retrying an empty provider response", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-discussion-"));
    const proposer: DiscussionParticipant = {
      agent: "claude-code",
      role: "proposer",
      respond: async () => "",
    };
    const reviewer: DiscussionParticipant = {
      agent: "codex",
      role: "reviewer",
      respond: async () => "not reached",
    };

    await expect(
      runDiscussion(root, {
        threadId: "failed-design",
        topic: "Choose a queue",
        rounds: 1,
        maxTurns: 3,
        participants: [proposer, reviewer],
      }),
    ).rejects.toThrow(/empty public response/i);

    const state = await getDiscussion(root, "failed-design");
    expect(state?.status).toBe("failed");
    expect(state?.finalDecision).toBeUndefined();
    expect(state?.events.at(-1)?.payload).toMatchObject({
      kind: "closed",
      outcome: "failed",
    });
  });

  it("halts before another provider turn when the kill switch activates", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-discussion-"));
    let reviewerTurns = 0;
    const proposer: DiscussionParticipant = {
      agent: "claude-code",
      role: "proposer",
      async respond() {
        await activateKillSwitch(root, "user stopped design room");
        return "This output must not be persisted after the stop.";
      },
    };
    const reviewer: DiscussionParticipant = {
      agent: "codex",
      role: "reviewer",
      async respond() {
        reviewerTurns += 1;
        return "not reached";
      },
    };

    await expect(
      runDiscussion(root, {
        threadId: "halted-design",
        topic: "Choose a queue",
        rounds: 1,
        maxTurns: 3,
        participants: [proposer, reviewer],
      }),
    ).rejects.toThrow(/kill switch is active/i);

    expect(reviewerTurns).toBe(0);
    const state = await getDiscussion(root, "halted-design");
    expect(state?.status).toBe("open");
    expect(state?.events).toHaveLength(1);
  });

  it("redacts one agent's public response before sharing it with the peer", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-discussion-"));
    const proposerResponses = [
      "Use api_key=supersecretvalue123456 for the example.",
      JSON.stringify({
        decision: "Use environment references",
        rationale: "The concrete secret must stay outside coordination.",
        alternatives: [],
        unresolved: [],
      }),
    ];
    let reviewerPrompt = "";
    const proposer: DiscussionParticipant = {
      agent: "claude-code",
      role: "proposer",
      respond: async () => proposerResponses.shift() ?? "",
    };
    const reviewer: DiscussionParticipant = {
      agent: "codex",
      role: "reviewer",
      async respond(prompt) {
        reviewerPrompt = prompt;
        return "Do not put credentials in examples.";
      },
    };

    await runDiscussion(root, {
      threadId: "redacted-design",
      topic: "How should credentials be documented?",
      rounds: 1,
      maxTurns: 3,
      participants: [proposer, reviewer],
    });

    expect(reviewerPrompt).toContain("[REDACTED]");
    expect(reviewerPrompt).not.toContain("supersecretvalue123456");
  });
});
