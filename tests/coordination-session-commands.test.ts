import { describe, expect, it } from "vitest";
import { parseProviderSessionRef } from "../src/commands/coordination-sessions.js";
import {
  parseDiscussionAgents,
  parseDiscussionSessions,
  resolveDiscussionSelection,
  createSessionParticipant,
  discussionTimeoutMs,
} from "../src/commands/coordination-discussions.js";

describe("provider session references", () => {
  it("accepts the supported provider names and preserves host session ids", () => {
    expect(parseProviderSessionRef("codex:thread-123")).toEqual({
      provider: "codex",
      sessionId: "thread-123",
    });
    expect(parseProviderSessionRef("claude-code:session:with:colons")).toEqual({
      provider: "claude-code",
      sessionId: "session:with:colons",
    });
  });

  it("rejects malformed and unsupported references", () => {
    expect(() => parseProviderSessionRef("codex")).toThrow(/provider:session/i);
    expect(() => parseProviderSessionRef("cursor:abc")).toThrow(
      /supported providers/i,
    );
    expect(() => parseProviderSessionRef("codex:")).toThrow(/session id/i);
  });
});

describe("discussion participant selection", () => {
  it("accepts exactly Claude Code and Codex and preserves proposer order", () => {
    expect(parseDiscussionAgents("claude-code,codex")).toEqual([
      "claude-code",
      "codex",
    ]);
    expect(parseDiscussionAgents("codex, claude-code")).toEqual([
      "codex",
      "claude-code",
    ]);
    expect(
      parseDiscussionSessions(["claude-code:session-1", "codex:thread-1"]),
    ).toEqual([
      { provider: "claude-code", sessionId: "session-1" },
      { provider: "codex", sessionId: "thread-1" },
    ]);
  });

  it("rejects duplicates, missing providers, and mixed fresh/resumed modes", () => {
    expect(() => parseDiscussionAgents("codex,codex")).toThrow(
      /exactly claude-code and codex/i,
    );
    expect(() => parseDiscussionSessions(["codex:one"])).toThrow(
      /exactly two/i,
    );
    expect(() =>
      resolveDiscussionSelection({
        agents: "claude-code,codex",
        sessions: ["claude-code:one", "codex:two"],
      }),
    ).toThrow(/choose either/i);
    expect(() => resolveDiscussionSelection({})).toThrow(
      /requires --agents or --sessions/i,
    );
  });

  it("bounds the per-turn provider timeout", () => {
    expect(discussionTimeoutMs(120)).toBe(120_000);
    expect(() => discussionTimeoutMs(9)).toThrow(/between 10 and 600/i);
    expect(() => discussionTimeoutMs(Number.NaN)).toThrow(
      /between 10 and 600/i,
    );
  });

  it("moves the requested proposer to the first participant slot", () => {
    expect(
      resolveDiscussionSelection({
        agents: "claude-code,codex",
        proposer: "codex",
      }),
    ).toEqual({
      mode: "fresh",
      participants: [{ provider: "codex" }, { provider: "claude-code" }],
    });
    expect(() =>
      resolveDiscussionSelection({
        agents: "claude-code,codex",
        proposer: "cursor",
      }),
    ).toThrow(/proposer must be/i);
  });

  it("uses the first fresh response as a discussion turn and resumes existing sessions", async () => {
    const calls: string[] = [];
    const responses = new Map<string, string>();
    const sessions = {
      async startSession(
        provider: string,
        _cwd: string,
        prompt?: string,
        timeout?: number,
      ) {
        calls.push(`start:${provider}:${prompt}:${timeout}`);
        responses.set(`${provider}-new`, `${provider} initial response`);
        return { sessionId: `${provider}-new` };
      },
      async submitTurn(sessionId: string, prompt: string, timeout?: number) {
        calls.push(`submit:${sessionId}:${prompt}:${timeout}`);
        responses.set(sessionId, `${sessionId} follow-up response`);
        return true;
      },
      getLastResponse(sessionId: string) {
        return responses.get(sessionId);
      },
    };

    const fresh = createSessionParticipant(
      sessions,
      { provider: "claude-code" },
      "proposer",
      "/repo",
      120_000,
    );
    const resumed = createSessionParticipant(
      sessions,
      { provider: "codex", sessionId: "existing-thread" },
      "reviewer",
      "/repo",
      120_000,
    );

    await expect(fresh.respond("initial prompt")).resolves.toBe(
      "claude-code initial response",
    );
    await expect(fresh.respond("revision prompt")).resolves.toBe(
      "claude-code-new follow-up response",
    );
    await expect(resumed.respond("critique prompt")).resolves.toBe(
      "existing-thread follow-up response",
    );
    expect(calls).toEqual([
      "start:claude-code:initial prompt:120000",
      "submit:claude-code-new:revision prompt:120000",
      "submit:existing-thread:critique prompt:120000",
    ]);
  });
});
