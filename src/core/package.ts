import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type {
  ComponentType,
  PackageInspection,
  PluginSummary,
  SkillSummary,
} from "../shared/types.js";
import { discoverSkillDirectories } from "./skills.js";
import { discoverMcpManifests } from "./mcp.js";
import { discoverResources } from "./components.js";

const portableRelative = (root: string, path: string): string =>
  relative(root, path).split(/[\\/]/).join("/") || ".";

function frontmatter(
  path: string,
): Promise<Pick<SkillSummary, "name" | "description">> {
  return readFile(join(path, "SKILL.md"), "utf8").then((content) => {
    const name = content.match(/^name:\s*(\S.*)$/m)?.[1];
    const description = content.match(/^description:\s*(\S.*)$/m)?.[1];
    return {
      name: name ?? path.split(/[\\/]/).at(-1) ?? "unnamed",
      ...(description ? { description } : {}),
    };
  });
}

async function discoverPlugins(root: string): Promise<PluginSummary[]> {
  const plugins: PluginSummary[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 5) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path, depth + 1);
        continue;
      }
      // Claude and Codex use the same plugin.json convention but different
      // manifest directories. We parse declarations only; lifecycle code and
      // hooks are deliberately never loaded or executed.
      const pathParts = directory.split(/[\\/]/);
      if (
        !entry.isFile() ||
        entry.name !== "plugin.json" ||
        (!pathParts.includes(".claude-plugin") &&
          !pathParts.includes(".codex-plugin"))
      )
        continue;
      try {
        const value = JSON.parse(await readFile(path, "utf8")) as Record<
          string,
          unknown
        >;
        const name =
          typeof value.name === "string" && value.name
            ? value.name
            : (relative(root, dirname(path)).split(/[\\/]/).at(-2) ??
              "unnamed");
        const components = new Set<ComponentType>();
        const warnings: string[] = [];
        const names = (field: string): string[] => {
          const item = value[field];
          if (typeof item === "string" && item) return [item];
          if (Array.isArray(item))
            return item.filter(
              (entry): entry is string =>
                typeof entry === "string" && entry.length > 0,
            );
          if (item !== undefined)
            warnings.push(`plugin field '${field}' has an unsupported shape`);
          return [];
        };
        const commandPaths = names("commands");
        if (commandPaths.length) components.add("command");
        const agentPaths = names("agents");
        if (agentPaths.length) components.add("agent");
        const skillPaths = names("skills");
        if (skillPaths.length) components.add("skill");
        const hookEvents =
          value.hooks &&
          typeof value.hooks === "object" &&
          !Array.isArray(value.hooks)
            ? Object.keys(value.hooks as Record<string, unknown>).sort()
            : value.hooks === undefined
              ? []
              : (warnings.push("plugin field 'hooks' has an unsupported shape"),
                []);
        if (hookEvents.length)
          warnings.push("hooks are inspected but never executed by Loadout");
        const mcpServers =
          value.mcpServers &&
          typeof value.mcpServers === "object" &&
          !Array.isArray(value.mcpServers)
            ? Object.keys(value.mcpServers as Record<string, unknown>).sort()
            : value.mcpServers === undefined
              ? []
              : (warnings.push(
                  "plugin field 'mcpServers' has an unsupported shape",
                ),
                []);
        if (mcpServers.length) components.add("mcp");
        plugins.push({
          type: "plugin",
          name,
          path: portableRelative(root, path),
          ...(typeof value.description === "string"
            ? { description: value.description }
            : {}),
          ...(typeof value.version === "string"
            ? { version: value.version }
            : {}),
          ...(typeof value.author === "string" ? { author: value.author } : {}),
          components: [...components].sort(),
          hookEvents,
          mcpServers,
          warnings,
        });
      } catch (error) {
        plugins.push({
          type: "plugin",
          name: "invalid",
          path: portableRelative(root, path),
          components: [],
          hookEvents: [],
          mcpServers: [],
          warnings: [
            `invalid plugin manifest: ${error instanceof Error ? error.message : String(error)}`,
          ],
        });
      }
    }
  }
  await visit(root, 0);
  return plugins;
}

/** Inspect a real package without running scripts or exposing environment values. */
export async function inspectPackage(root: string): Promise<PackageInspection> {
  const resolvedRoot = resolve(root);
  const warnings: string[] = [];
  let skillPaths: string[] = [];
  try {
    skillPaths = await discoverSkillDirectories(resolvedRoot);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
  }
  const skills: SkillSummary[] = [];
  for (const path of skillPaths) {
    try {
      const meta = await frontmatter(path);
      skills.push({
        type: "skill",
        ...meta,
        path: portableRelative(resolvedRoot, path),
      });
    } catch (error) {
      warnings.push(
        `Could not read skill metadata at ${portableRelative(resolvedRoot, path)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const manifests = await discoverMcpManifests(resolvedRoot);
  const resources = await discoverResources(resolvedRoot);
  const plugins = await discoverPlugins(resolvedRoot);
  plugins.sort((a, b) => a.path.localeCompare(b.path));
  const mcpServers = manifests.flatMap((manifest) =>
    manifest.servers.map((server) => ({
      type: "mcp" as const,
      name: server.name,
      transport: server.command
        ? ("command" as const)
        : server.url
          ? ("url" as const)
          : ("unknown" as const),
      ...(server.command ? { command: server.command } : {}),
      ...(server.url ? { url: server.url } : {}),
      argumentCount: server.args.length,
      environmentVariableCount: Object.keys(server.env).length,
      path: portableRelative(resolvedRoot, manifest.path),
      warnings: server.warnings,
    })),
  );
  for (const manifest of manifests)
    for (const warning of manifest.warnings)
      warnings.push(
        `${portableRelative(resolvedRoot, manifest.path)}: ${warning}`,
      );
  return {
    root: resolvedRoot,
    skills,
    resources,
    plugins,
    mcpServers,
    counts: {
      skills: skills.length,
      rules: resources.filter((item) => item.type === "rule").length,
      commands: resources.filter((item) => item.type === "command").length,
      agents: resources.filter((item) => item.type === "agent").length,
      plugins: plugins.length,
      mcpServers: mcpServers.length,
      manifests: manifests.length,
    },
    warnings,
  };
}

export function formatPackageInspection(result: PackageInspection): string {
  const lines = [
    `Package: ${result.root}`,
    `Skills: ${result.counts.skills}`,
    `Rules: ${result.counts.rules}`,
    `Commands: ${result.counts.commands}`,
    `Agents: ${result.counts.agents}`,
    `Plugins: ${result.counts.plugins}`,
    `MCP servers: ${result.counts.mcpServers}`,
    `Manifests: ${result.counts.manifests}`,
  ];
  for (const skill of result.skills)
    lines.push(
      `  skill: ${skill.name}${skill.description ? ` — ${skill.description}` : ""} (${skill.path})`,
    );
  for (const resource of result.resources)
    lines.push(`  ${resource.type}: ${resource.name} (${resource.path})`);
  for (const plugin of result.plugins) {
    const declared = plugin.components.length
      ? `; declares ${plugin.components.join(", ")}`
      : "";
    lines.push(
      `  plugin: ${plugin.name}${plugin.version ? ` v${plugin.version}` : ""}${plugin.description ? ` — ${plugin.description}` : ""} (${plugin.path}${declared})`,
    );
    if (plugin.hookEvents.length)
      lines.push(`    hooks: ${plugin.hookEvents.join(", ")} (not executed)`);
    if (plugin.mcpServers.length)
      lines.push(`    mcp servers: ${plugin.mcpServers.join(", ")}`);
    for (const warning of plugin.warnings)
      lines.push(`    warning: ${warning}`);
  }
  for (const server of result.mcpServers)
    lines.push(
      `  mcp: ${server.name} (${server.transport}${server.command ? ` ${server.command}` : server.url ? ` ${server.url}` : ""}; ${server.environmentVariableCount} env var(s))`,
    );
  for (const warning of result.warnings) lines.push(`warning: ${warning}`);
  return lines.join("\n");
}
