import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { PackageInspection, SkillSummary } from "../shared/types.js";
import { discoverSkillDirectories } from "./skills.js";
import { discoverMcpManifests } from "./mcp.js";
import { discoverResources } from "./components.js";

function frontmatter(path: string): Promise<Pick<SkillSummary, "name" | "description">> {
  return readFile(join(path, "SKILL.md"), "utf8").then((content) => {
    const name = content.match(/^name:\s*(\S.*)$/m)?.[1];
    const description = content.match(/^description:\s*(\S.*)$/m)?.[1];
    return { name: name ?? path.split(/[\\/]/).at(-1) ?? "unnamed", ...(description ? { description } : {}) };
  });
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
      skills.push({ type: "skill", ...meta, path: relative(resolvedRoot, path) || "." });
    } catch (error) { warnings.push(`Could not read skill metadata at ${relative(resolvedRoot, path)}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const manifests = await discoverMcpManifests(resolvedRoot);
  const resources = await discoverResources(resolvedRoot);
  const mcpServers = manifests.flatMap((manifest) => manifest.servers.map((server) => ({
    type: "mcp" as const,
    name: server.name,
    transport: server.command ? "command" as const : server.url ? "url" as const : "unknown" as const,
    ...(server.command ? { command: server.command } : {}),
    ...(server.url ? { url: server.url } : {}),
    argumentCount: server.args.length,
    environmentVariableCount: Object.keys(server.env).length,
    path: relative(resolvedRoot, manifest.path) || ".",
    warnings: server.warnings,
  })));
  for (const manifest of manifests) for (const warning of manifest.warnings) warnings.push(`${relative(resolvedRoot, manifest.path)}: ${warning}`);
  return { root: resolvedRoot, skills, resources, mcpServers, counts: { skills: skills.length, rules: resources.filter((item) => item.type === "rule").length, commands: resources.filter((item) => item.type === "command").length, agents: resources.filter((item) => item.type === "agent").length, mcpServers: mcpServers.length, manifests: manifests.length }, warnings };
}

export function formatPackageInspection(result: PackageInspection): string {
  const lines = [`Package: ${result.root}`, `Skills: ${result.counts.skills}`, `Rules: ${result.counts.rules}`, `Commands: ${result.counts.commands}`, `Agents: ${result.counts.agents}`, `MCP servers: ${result.counts.mcpServers}`, `Manifests: ${result.counts.manifests}`];
  for (const skill of result.skills) lines.push(`  skill: ${skill.name}${skill.description ? ` — ${skill.description}` : ""} (${skill.path})`);
  for (const resource of result.resources) lines.push(`  ${resource.type}: ${resource.name} (${resource.path})`);
  for (const server of result.mcpServers) lines.push(`  mcp: ${server.name} (${server.transport}${server.command ? ` ${server.command}` : server.url ? ` ${server.url}` : ""}; ${server.environmentVariableCount} env var(s))`);
  for (const warning of result.warnings) lines.push(`warning: ${warning}`);
  return lines.join("\n");
}
