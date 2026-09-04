import { describe, expect, it } from "vitest";
import { parseProviderSessionRef } from "../src/commands/coordination-sessions.js";

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
