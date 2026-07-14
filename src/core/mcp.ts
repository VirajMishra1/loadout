import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { McpManifest, McpServer } from "../shared/types.js";

const MANIFEST_NAMES = new Set(["mcp.json", ".mcp.json", "claude_desktop_config.json"]);

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeServer(name: string, value: unknown, sourcePath: string): McpServer {
  const warnings: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { name, args: [], env: {}, sourcePath, warnings: ["server entry must be an object"] };
  }
  const raw = value as Record<string, unknown>;
  const command = asString(raw.command);
  const url = asString(raw.url) ?? asString(raw.endpoint);
  if (!command && !url) warnings.push("server has neither a command nor a URL");
  if (command && url) warnings.push("server has both command and URL; command will be preferred by clients");
  const args = Array.isArray(raw.args) ? raw.args.filter((arg): arg is string => typeof arg === "string") : [];
  if (raw.args !== undefined && (!Array.isArray(raw.args) || args.length !== raw.args.length)) warnings.push("non-string args were ignored");
  const env: Record<string, string> = {};
  if (raw.env && typeof raw.env === "object" && !Array.isArray(raw.env)) {
    for (const [key, entry] of Object.entries(raw.env as Record<string, unknown>)) {
      if (typeof entry === "string") env[key] = entry;
      else warnings.push(`environment value ${key} was ignored because it is not a string`);
    }
  } else if (raw.env !== undefined) warnings.push("env must be an object");
  return { name, command, url, args, env, sourcePath, warnings };
}

export function parseMcpManifest(value: unknown, sourcePath: string): McpManifest {
  const warnings: string[] = [];
  const root = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  if (root !== value) warnings.push("manifest root must be an object");
  const rawServers = root.mcpServers ?? root.servers;
  if (!rawServers || typeof rawServers !== "object" || Array.isArray(rawServers)) {
    warnings.push("manifest has no mcpServers object");
    return { path: sourcePath, servers: [], warnings };
  }
  const servers = Object.entries(rawServers as Record<string, unknown>).map(([name, server]) => normalizeServer(name, server, sourcePath));
  return { path: sourcePath, servers, warnings };
}

async function findManifestFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 5) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path, depth + 1);
      else if (entry.isFile() && MANIFEST_NAMES.has(entry.name)) found.push(path);
    }
  }
  await visit(resolve(root), 0);
  return found;
}

export async function discoverMcpManifests(root: string): Promise<McpManifest[]> {
  const manifests: McpManifest[] = [];
  for (const path of await findManifestFiles(root)) {
    try {
      manifests.push(parseMcpManifest(JSON.parse(await readFile(path, "utf8")), path));
    } catch (error) {
      manifests.push({ path, servers: [], warnings: [`invalid JSON: ${error instanceof Error ? error.message : String(error)}`] });
    }
  }
  return manifests;
}

/** Safe for terminal/UI output: never emits environment values or secrets. */
export function summarizeMcpManifest(manifest: McpManifest): string {
  const lines = [`${manifest.path}: ${manifest.servers.length} MCP server(s)`];
  for (const server of manifest.servers) {
    const transport = server.command ? `command ${server.command}` : server.url ? `URL ${server.url}` : "invalid transport";
    lines.push(`  - ${server.name} (${transport}${server.env ? `, ${Object.keys(server.env).length} env var(s)` : ""})`);
    for (const warning of server.warnings) lines.push(`    warning: ${warning}`);
  }
  for (const warning of manifest.warnings) lines.push(`  warning: ${warning}`);
  return lines.join("\n");
}
