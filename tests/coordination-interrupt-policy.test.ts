import { describe, it, expect } from "vitest";
import {
  evaluatePolicy,
  categorizeEvents,
} from "../src/core/coordination/interrupt-policy.js";
import type { CoordinationEvent } from "../src/core/coordination/events.js";

function makeEvent(type: string, from: string, seq = 0): CoordinationEvent {
  return {
    id: `test-${seq}`,
    seq,
    type: type as CoordinationEvent["type"],
    from,
    to: "*",
    description: `test ${type}`,
    timestamp: new Date().toISOString(),
  };
}

describe("evaluatePolicy", () => {
  it("ownership events are immediate", () => {
    expect(evaluatePolicy(makeEvent("ownership", "codex"))).toBe("immediate");
  });

  it("error events are immediate", () => {
    expect(evaluatePolicy(makeEvent("error", "codex"))).toBe("immediate");
  });

  it("contract events are boundary", () => {
    expect(evaluatePolicy(makeEvent("contract", "codex"))).toBe("boundary");
  });

  it("task events are boundary", () => {
    expect(evaluatePolicy(makeEvent("task", "claude-code"))).toBe("boundary");
  });

  it("update events are passive", () => {
    expect(evaluatePolicy(makeEvent("update", "codex"))).toBe("passive");
  });

  it("ack events are passive", () => {
    expect(evaluatePolicy(makeEvent("ack", "codex"))).toBe("passive");
  });

  it("uses default level for unknown types", () => {
    expect(
      evaluatePolicy(makeEvent("unknown-type", "codex"), {
        defaultLevel: "passive",
        rules: [],
      }),
    ).toBe("passive");
  });

  it("custom rules override defaults", () => {
    const policy = {
      defaultLevel: "passive" as const,
      rules: [{ type: "update", from: "codex", level: "immediate" as const }],
    };
    expect(evaluatePolicy(makeEvent("update", "codex"), policy)).toBe(
      "immediate",
    );
    // Different agent — falls through to default
    expect(evaluatePolicy(makeEvent("update", "claude-code"), policy)).toBe(
      "passive",
    );
  });
});

describe("categorizeEvents", () => {
  it("splits events by interrupt level", () => {
    const events = [
      makeEvent("ownership", "codex", 0),
      makeEvent("contract", "codex", 1),
      makeEvent("update", "codex", 2),
      makeEvent("ack", "codex", 3),
      makeEvent("error", "codex", 4),
    ];

    const result = categorizeEvents(events);
    expect(result.immediate).toHaveLength(2); // ownership + error
    expect(result.boundary).toHaveLength(1); // contract
    expect(result.passive).toHaveLength(2); // update + ack
  });

  it("handles empty events", () => {
    const result = categorizeEvents([]);
    expect(result.immediate).toHaveLength(0);
    expect(result.boundary).toHaveLength(0);
    expect(result.passive).toHaveLength(0);
  });
});
