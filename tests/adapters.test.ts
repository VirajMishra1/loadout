import { describe, expect, it } from "vitest";
import {
  ADAPTER_CAPABILITIES,
  COMPATIBILITY_RULES,
  adapterCapabilities,
  compatibilityRule,
  formatCapabilityMatrix,
} from "../src/core/adapters.js";
import type { AgentId, ComponentType } from "../src/shared/types.js";

describe("adapter conformance declarations", () => {
  it("declares every component for every advertised agent", () => {
    const agents: AgentId[] = [
      "claude-code",
      "codex",
      "cursor",
      "gemini-cli",
      "opencode",
      "hermes",
    ];
    const components: ComponentType[] = [
      "skill",
      "rule",
      "command",
      "agent",
      "mcp",
      "plugin",
      "root",
    ];
    expect(ADAPTER_CAPABILITIES.map((entry) => entry.agent)).toEqual(agents);
    for (const agent of agents) {
      const capabilities = adapterCapabilities(agent);
      expect(Object.keys(capabilities.components).sort()).toEqual(
        [...components].sort(),
      );
      for (const component of components)
        expect(["native", "adapted", "unsupported"]).toContain(
          capabilities.components[component],
        );
    }
    expect(formatCapabilityMatrix()).toContain(
      "Codex | native | unsupported | adapted",
    );
  });

  it("claims only the bounded Codex TOML MCP mutation it supports", () => {
    expect(adapterCapabilities("codex").components.mcp).toBe("adapted");
    expect(adapterCapabilities("codex").notes.join(" ")).toContain(
      "never rewritten",
    );
    expect(adapterCapabilities("claude-code").components.mcp).toBe("adapted");
  });

  it("defines conservative native, adapted, and unsupported behavior for every platform adapter", () => {
    expect(COMPATIBILITY_RULES.native).toMatch(/documented, agent-owned/);
    expect(compatibilityRule("adapted")).toMatch(/reviewed agent-specific/);
    expect(compatibilityRule("unsupported")).toMatch(/does not guess/);
    expect(adapterCapabilities("hermes").components.command).toBe(
      "unsupported",
    );
  });
});
