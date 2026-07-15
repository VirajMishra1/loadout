import { lstat, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type {
  AgentComponentInventory,
  AgentInventory,
  ComponentType,
  DetectedAgent,
  ManagedComponentEntry,
} from "../shared/types.js";
import { adapterCapabilities, agentComponentDirectory } from "./adapters.js";

const COMPONENT_TYPES: ComponentType[] = [
  "skill",
  "rule",
  "command",
  "agent",
  "mcp",
  "plugin",
  "root",
];
const MAX_DEPTH = 4;

async function scanDirectory(root: string): Promise<{
  exists: boolean;
  entries: ManagedComponentEntry[];
  warnings: string[];
}> {
  try {
    const info = await lstat(root);
    if (info.isSymbolicLink())
      return {
        exists: true,
        entries: [{ path: ".", kind: "symlink" }],
        warnings: [
          `Refusing to inspect symlinked component directory: ${root}`,
        ],
      };
    if (!info.isDirectory())
      return {
        exists: true,
        entries: [],
        warnings: [
          `Expected a directory but found a non-directory component path: ${root}`,
        ],
      };
  } catch {
    return { exists: false, entries: [], warnings: [] };
  }

  const entries: ManagedComponentEntry[] = [];
  const warnings: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    let children;
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch {
      warnings.push(`Could not read component directory: ${directory}`);
      return;
    }
    for (const child of children) {
      const path = relative(root, join(directory, child.name))
        .split(sep)
        .join("/");
      if (child.isSymbolicLink()) {
        entries.push({ path, kind: "symlink" });
        warnings.push(
          `Symlink was not followed: ${join(directory, child.name)}`,
        );
      } else if (child.isDirectory()) {
        entries.push({ path, kind: "directory" });
        if (depth < MAX_DEPTH)
          await visit(join(directory, child.name), depth + 1);
      } else if (child.isFile()) entries.push({ path, kind: "file" });
    }
  }
  await visit(root, 0);
  return {
    exists: true,
    entries: entries.sort((a, b) => a.path.localeCompare(b.path)),
    warnings,
  };
}

function unscannedInventory(
  agent: DetectedAgent,
  type: ComponentType,
): AgentComponentInventory {
  const compatibility = adapterCapabilities(agent.id).components[type];
  if (compatibility === "unsupported") {
    return {
      type,
      compatibility,
      scanned: false,
      entries: [],
      note: "Unsupported by this adapter; Loadout will not install or inspect it.",
    };
  }
  if (type === "mcp") {
    return {
      type,
      compatibility,
      scanned: false,
      entries: [],
      note: "MCP configuration is explicit and config-file scoped; no agent-wide MCP directory is assumed.",
    };
  }
  if (type === "plugin") {
    return {
      type,
      compatibility,
      scanned: false,
      entries: [],
      note: "Plugin manifests are normalized during package inspection; plugin runtime behavior is not inspected or converted.",
    };
  }
  return {
    type,
    compatibility,
    scanned: false,
    entries: [],
    note: "Root exports are manifest-scoped, not stored in an agent-owned Loadout directory.",
  };
}

/**
 * Read agent-owned component directories without executing agent code or
 * following symlinks. Only locations declared by the adapter matrix are
 * scanned; unsupported capabilities stay explicitly unscanned.
 */
export async function inspectAgent(
  agent: DetectedAgent,
): Promise<AgentInventory> {
  const components: AgentComponentInventory[] = [];
  const warnings: string[] = [];
  for (const type of COMPONENT_TYPES) {
    const directory = agentComponentDirectory(agent, type);
    if (!directory) {
      components.push(unscannedInventory(agent, type));
      continue;
    }
    const result = await scanDirectory(directory);
    warnings.push(...result.warnings);
    components.push({
      type,
      compatibility: adapterCapabilities(agent.id).components[type],
      scanned: true,
      directory,
      directoryExists: result.exists,
      entries: result.entries,
    });
  }
  return { agent, components, warnings };
}

export async function inspectAgents(
  agents: DetectedAgent[],
): Promise<AgentInventory[]> {
  return Promise.all(agents.map(inspectAgent));
}

export function formatAgentInventory(inventory: AgentInventory): string {
  const lines = [
    `${inventory.agent.installed ? "✓" : "○"} ${inventory.agent.displayName}`,
  ];
  for (const component of inventory.components) {
    const state = component.scanned
      ? `${component.directoryExists ? `${component.entries.length} filesystem item(s)` : "not created"} — ${component.directory}`
      : (component.note ?? "not inspected");
    lines.push(`  ${component.type}: ${component.compatibility}; ${state}`);
  }
  for (const warning of inventory.warnings) lines.push(`  ! ${warning}`);
  return lines.join("\n");
}
