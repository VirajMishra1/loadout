import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { PackageInspection, PluginSummary, SkillSummary } from "../shared/types.js";
import { discoverSkillDirectories } from "./skills.js";
import { discoverMcpManifests } from "./mcp.js";
import { discoverResources } from "./components.js";

const portableRelative = (root: string, path: string): string => relative(root, path).split(/[\\/]/).join("/") || ".";

function frontmatter(path: string): Promise<Pick<SkillSummary, "name" | "description">> {
  return readFile(join(path, "SKILL.md"), "utf8").then((content) => {
    const name = content.match(/^name:\s*(\S.*)$/m)?.[1];
    const description = content.match(/^description:\s*(\S.*)$/m)?.[1];
    return { name: name ?? path.split(/[\\/]/).at(-1) ?? "unnamed", ...(description ? { description } : {}) };
  });
}

async function discoverPlugins(root: string): Promise<PluginSummary[]> {
  const plugins: PluginSummary[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 5) return;
    let entries; try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { await visit(path, depth + 1); continue; }
      if (!entry.isFile() || entry.name !== "plugin.json" || !directory.split(/[\\/]/).includes(".claude-plugin")) continue;
      try {
        const value = JSON.parse(await readFile(path, "utf8")) as { name?: unknown };
        plugins.push({ type: "plugin", name: typeof value.name === "string" && value.name ? value.name : relative(root, dirname(path)).split(/[\\/]/).at(-2) ?? "unnamed", path: portableRelative(root, path) });
      } catch { plugins.push({ type: "plugin", name: "invalid", path: portableRelative(root, path) }); }
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
  try { skillPaths = await discoverSkillDirectories(resolvedRoot); }
  catch (error) { warnings.push(error instanceof Error ? error.message : String(error)); }
  const skills: SkillSummary[] = [];
  for (const path of skillPaths) {
    try {
      const meta = await frontmatter(path);
      skills.push({ type: "skill", ...meta, path: portableRelative(resolvedRoot, path) });
    } catch (error) { warnings.push(`Could not read skill metadata at ${portableRelative(resolvedRoot, path)}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const manifests = await discoverMcpManifests(resolvedRoot);
  const resources = await discoverResources(resolvedRoot);
  const plugins = await discoverPlugins(resolvedRoot);
  const mcpServers = manifests.flatMap((manifest) => manifest.servers.map((server) => ({
    type: "mcp" as const,
    name: server.name,
    transport: server.command ? "command" as const : server.url ? "url" as const : "unknown" as const,
    ...(server.command ? { command: server.command } : {}),
    ...(server.url ? { url: server.url } : {}),
    argumentCount: server.args.length,
    environmentVariableCount: Object.keys(server.env).length,
    path: portableRelative(resolvedRoot, manifest.path),
    warnings: server.warnings,
  })));
  for (const manifest of manifests) for (const warning of manifest.warnings) warnings.push(`${portableRelative(resolvedRoot, manifest.path)}: ${warning}`);
  return { root: resolvedRoot, skills, resources, plugins, mcpServers, counts: { skills: skills.length, rules: resources.filter((item) => item.type === "rule").length, commands: resources.filter((item) => item.type === "command").length, agents: resources.filter((item) => item.type === "agent").length, plugins: plugins.length, mcpServers: mcpServers.length, manifests: manifests.length }, warnings };
}

export function formatPackageInspection(result: PackageInspection): string {
  const lines = [`Package: ${result.root}`, `Skills: ${result.counts.skills}`, `Rules: ${result.counts.rules}`, `Commands: ${result.counts.commands}`, `Agents: ${result.counts.agents}`, `Plugins: ${result.counts.plugins}`, `MCP servers: ${result.counts.mcpServers}`, `Manifests: ${result.counts.manifests}`];
  for (const skill of result.skills) lines.push(`  skill: ${skill.name}${skill.description ? ` — ${skill.description}` : ""} (${skill.path})`);
  for (const resource of result.resources) lines.push(`  ${resource.type}: ${resource.name} (${resource.path})`);
  for (const plugin of result.plugins) lines.push(`  plugin: ${plugin.name} (${plugin.path})`);
  for (const server of result.mcpServers) lines.push(`  mcp: ${server.name} (${server.transport}${server.command ? ` ${server.command}` : server.url ? ` ${server.url}` : ""}; ${server.environmentVariableCount} env var(s))`);
  for (const warning of result.warnings) lines.push(`warning: ${warning}`);
  return lines.join("\n");
}
