import { describe, expect, it } from "vitest";
import { ADAPTER_CAPABILITIES, adapterCapabilities, formatCapabilityMatrix } from "../src/core/adapters.js";
import type { AgentId, ComponentType } from "../src/shared/types.js";

describe("adapter conformance declarations", () => {
  it("declares every component for every advertised agent", () => {
    const agents: AgentId[] = ["claude-code", "codex", "cursor", "gemini-cli", "opencode", "hermes"];
    const components: ComponentType[] = ["skill", "rule", "command", "agent", "mcp", "plugin", "root"];
    expect(ADAPTER_CAPABILITIES.map((entry) => entry.agent)).toEqual(agents);
    for (const agent of agents) {
      const capabilities = adapterCapabilities(agent);
      expect(Object.keys(capabilities.components).sort()).toEqual([...components].sort());
      for (const component of components) expect(["native", "adapted", "unsupported"]).toContain(capabilities.components[component]);
    }
    expect(formatCapabilityMatrix()).toContain("Codex | native | unsupported | adapted");
  });

  it("does not claim unsupported Codex TOML MCP mutation", () => {
    expect(adapterCapabilities("codex").components.mcp).toBe("unsupported");
    expect(adapterCapabilities("claude-code").components.mcp).toBe("adapted");
  });
});
