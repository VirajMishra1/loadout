import type { AgentId, ComponentCompatibility, ComponentType } from "../shared/types.js";

export interface AdapterCapabilities {
  agent: AgentId;
  displayName: string;
  components: Record<ComponentType, ComponentCompatibility>;
  notes: string[];
}

const unsupported: Record<ComponentType, ComponentCompatibility> = { skill: "unsupported", rule: "unsupported", command: "unsupported", agent: "unsupported", mcp: "unsupported", plugin: "unsupported", root: "native" };

export const ADAPTER_CAPABILITIES: AdapterCapabilities[] = [
  { agent: "claude-code", displayName: "Claude Code", components: { ...unsupported, skill: "native", command: "native", agent: "native", plugin: "adapted", mcp: "adapted" }, notes: ["Plugin contents are normalized; plugin-only runtime behavior is not converted.", "MCP requires an explicit JSON config path."] },
  { agent: "codex", displayName: "Codex", components: { ...unsupported, skill: "native", command: "adapted", agent: "native", plugin: "adapted", mcp: "adapted" }, notes: ["Commands use the Codex prompts layout.", "Codex MCP support only appends new TOML tables; existing tables are never rewritten."] },
  { agent: "cursor", displayName: "Cursor", components: { ...unsupported, skill: "native", rule: "native", command: "native", agent: "native", plugin: "adapted", mcp: "adapted" }, notes: ["MCP requires an explicit JSON config path."] },
  { agent: "gemini-cli", displayName: "Gemini CLI", components: { ...unsupported, skill: "native", command: "native", plugin: "adapted" }, notes: ["Only tested filesystem-native components are enabled."] },
  { agent: "opencode", displayName: "OpenCode", components: { ...unsupported, skill: "native", command: "native", agent: "native", plugin: "adapted" }, notes: ["Plugin contents are normalized into supported components."] },
  { agent: "hermes", displayName: "Hermes", components: { ...unsupported, skill: "native", plugin: "adapted" }, notes: ["Only skill installation is currently claimed."] },
];

export function adapterCapabilities(agent: AgentId): AdapterCapabilities {
  const found = ADAPTER_CAPABILITIES.find((entry) => entry.agent === agent);
  if (!found) throw new Error(`No adapter capability declaration for '${agent}'`);
  return found;
}

export function formatCapabilityMatrix(): string {
  const types: ComponentType[] = ["skill", "rule", "command", "agent", "mcp", "plugin", "root"];
  return ["Agent | " + types.join(" | "), "--- | " + types.map(() => "---").join(" | "), ...ADAPTER_CAPABILITIES.map((entry) => `${entry.displayName} | ${types.map((type) => entry.components[type]).join(" | ")}`)].join("\n");
}
