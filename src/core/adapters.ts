import { dirname, join } from "node:path";
import type {
  AgentId,
  ComponentCompatibility,
  ComponentType,
  DetectedAgent,
  InstallPlan,
} from "../shared/types.js";
import { planSkillInstall } from "./skills.js";

export interface AdapterCapabilities {
  agent: AgentId;
  displayName: string;
  components: Record<ComponentType, ComponentCompatibility>;
  notes: string[];
}

/**
 * Rules shared by the CLI, planner, and documentation. A capability only
 * changes state when it is native or has this explicitly tested adaptation.
 */
export const COMPATIBILITY_RULES: Record<ComponentCompatibility, string> = {
  native:
    "Loadout writes the component in a documented, agent-owned layout without translating its format.",
  adapted:
    "Loadout uses a reviewed agent-specific layout or config writer and reports the adaptation; plugin runtime behavior is never inferred.",
  unsupported:
    "Loadout does not guess a path, translate the component, or write files for this agent/component combination.",
};

const unsupported: Record<ComponentType, ComponentCompatibility> = {
  skill: "unsupported",
  rule: "unsupported",
  command: "unsupported",
  agent: "unsupported",
  mcp: "unsupported",
  plugin: "unsupported",
  root: "native",
};

export const ADAPTER_CAPABILITIES: AdapterCapabilities[] = [
  {
    agent: "claude-code",
    displayName: "Claude Code",
    components: {
      ...unsupported,
      skill: "native",
      command: "native",
      agent: "native",
      plugin: "adapted",
      mcp: "adapted",
    },
    notes: [
      "Plugin contents are normalized; plugin-only runtime behavior is not converted.",
      "MCP requires an explicit JSON config path.",
    ],
  },
  {
    agent: "codex",
    displayName: "Codex",
    components: {
      ...unsupported,
      skill: "native",
      command: "adapted",
      agent: "native",
      plugin: "adapted",
      mcp: "adapted",
    },
    notes: [
      "Commands use the Codex prompts layout.",
      "Codex MCP support only appends new TOML tables; existing tables are never rewritten.",
    ],
  },
  {
    agent: "cursor",
    displayName: "Cursor",
    components: {
      ...unsupported,
      skill: "native",
      rule: "native",
      command: "native",
      agent: "native",
      plugin: "adapted",
      mcp: "adapted",
    },
    notes: ["MCP requires an explicit JSON config path."],
  },
  {
    agent: "gemini-cli",
    displayName: "Gemini CLI",
    components: {
      ...unsupported,
      skill: "native",
      command: "native",
      plugin: "adapted",
    },
    notes: ["Only tested filesystem-native components are enabled."],
  },
  {
    agent: "opencode",
    displayName: "OpenCode",
    components: {
      ...unsupported,
      skill: "native",
      command: "native",
      agent: "native",
      plugin: "adapted",
    },
    notes: ["Plugin contents are normalized into supported components."],
  },
  {
    agent: "hermes",
    displayName: "Hermes",
    components: { ...unsupported, skill: "native", plugin: "adapted" },
    notes: ["Only skill installation is currently claimed."],
  },
];

export function adapterCapabilities(agent: AgentId): AdapterCapabilities {
  const found = ADAPTER_CAPABILITIES.find((entry) => entry.agent === agent);
  if (!found)
    throw new Error(`No adapter capability declaration for '${agent}'`);
  return found;
}

/**
 * Produce a read-only native-skill plan for one agent.  This is deliberately
 * narrower than package normalization: adapters may only target a directory
 * declared by the capability matrix, and planning never creates that
 * directory or writes agent configuration.
 */
export async function planAdapterSkillInstall(
  source: string,
  packageId: string,
  agent: DetectedAgent,
): Promise<InstallPlan> {
  const capability = adapterCapabilities(agent.id).components.skill;
  if (capability !== "native") {
    throw new Error(
      `${agent.displayName} does not declare native skill installation support.`,
    );
  }
  const plan = await planSkillInstall(
    source,
    [agent.skillsDirectory],
    packageId,
  );
  return {
    ...plan,
    files: plan.files.map((file) => ({
      ...file,
      targetAgent: agent.id,
      componentType: "skill" as const,
      compatibility: capability,
    })),
    targetAgents: [agent.id],
  };
}

/**
 * Return only the filesystem directory that this adapter actually manages for
 * a component. Undefined is intentional for unsupported components and for
 * explicit/config-scoped features such as MCP; callers must not guess paths.
 */
export function agentComponentDirectory(
  agent: DetectedAgent,
  type: ComponentType,
): string | undefined {
  const compatibility = adapterCapabilities(agent.id).components[type];
  if (compatibility === "unsupported") return undefined;
  if (type === "skill") return agent.skillsDirectory;
  const skillBase = dirname(agent.skillsDirectory);
  if (
    agent.id === "claude-code" &&
    (type === "rule" || type === "command" || type === "agent")
  )
    return join(skillBase, `${type}s`);
  if (agent.id === "codex") {
    const home = dirname(dirname(agent.skillsDirectory));
    if (type === "command") return join(home, ".codex", "prompts");
    if (type === "agent") return join(home, ".codex", "agents");
  }
  if (
    agent.id === "cursor" &&
    (type === "rule" || type === "command" || type === "agent")
  )
    return join(skillBase, `${type}s`);
  if (agent.id === "gemini-cli" && type === "command")
    return join(skillBase, "commands");
  if (agent.id === "opencode" && (type === "command" || type === "agent"))
    return join(skillBase, `${type}s`);
  return undefined;
}

export function formatCapabilityMatrix(): string {
  const types: ComponentType[] = [
    "skill",
    "rule",
    "command",
    "agent",
    "mcp",
    "plugin",
    "root",
  ];
  return [
    "Agent | " + types.join(" | "),
    "--- | " + types.map(() => "---").join(" | "),
    ...ADAPTER_CAPABILITIES.map(
      (entry) =>
        `${entry.displayName} | ${types.map((type) => entry.components[type]).join(" | ")}`,
    ),
  ].join("\n");
}

export function compatibilityRule(
  compatibility: ComponentCompatibility,
): string {
  return COMPATIBILITY_RULES[compatibility];
}
