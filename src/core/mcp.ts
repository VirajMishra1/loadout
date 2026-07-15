import {
  readFile,
  readdir,
  mkdir,
  rename,
  writeFile,
  rm,
} from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  McpConfigPlan,
  McpConfigSnapshot,
  McpManifest,
  McpServer,
} from "../shared/types.js";
import { loadoutHome } from "./paths.js";

const MANIFEST_NAMES = new Set([
  "mcp.json",
  ".mcp.json",
  "claude_desktop_config.json",
]);

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeServer(
  name: string,
  value: unknown,
  sourcePath: string,
): McpServer {
  const warnings: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      name,
      args: [],
      env: {},
      sourcePath,
      warnings: ["server entry must be an object"],
    };
  }
  const raw = value as Record<string, unknown>;
  const command = asString(raw.command);
  const url = asString(raw.url) ?? asString(raw.endpoint);
  if (!command && !url) warnings.push("server has neither a command nor a URL");
  if (command && url)
    warnings.push(
      "server has both command and URL; command will be preferred by clients",
    );
  const args = Array.isArray(raw.args)
    ? raw.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  if (
    raw.args !== undefined &&
    (!Array.isArray(raw.args) || args.length !== raw.args.length)
  )
    warnings.push("non-string args were ignored");
  const env: Record<string, string> = {};
  if (raw.env && typeof raw.env === "object" && !Array.isArray(raw.env)) {
    for (const [key, entry] of Object.entries(
      raw.env as Record<string, unknown>,
    )) {
      if (typeof entry === "string") env[key] = entry;
      else
        warnings.push(
          `environment value ${key} was ignored because it is not a string`,
        );
    }
  } else if (raw.env !== undefined) warnings.push("env must be an object");
  return { name, command, url, args, env, sourcePath, warnings };
}

export function parseMcpManifest(
  value: unknown,
  sourcePath: string,
): McpManifest {
  const warnings: string[] = [];
  const root =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  if (root !== value) warnings.push("manifest root must be an object");
  const rawServers = root.mcpServers ?? root.servers;
  if (
    !rawServers ||
    typeof rawServers !== "object" ||
    Array.isArray(rawServers)
  ) {
    warnings.push("manifest has no mcpServers object");
    return { path: sourcePath, servers: [], warnings };
  }
  const servers = Object.entries(rawServers as Record<string, unknown>).map(
    ([name, server]) => normalizeServer(name, server, sourcePath),
  );
  return { path: sourcePath, servers, warnings };
}

async function findManifestFiles(root: string): Promise<string[]> {
  const found: string[] = [];
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
      if (entry.isDirectory()) await visit(path, depth + 1);
      else if (entry.isFile() && MANIFEST_NAMES.has(entry.name))
        found.push(path);
    }
  }
  await visit(resolve(root), 0);
  return found;
}

export async function discoverMcpManifests(
  root: string,
): Promise<McpManifest[]> {
  const manifests: McpManifest[] = [];
  for (const path of await findManifestFiles(root)) {
    try {
      manifests.push(
        parseMcpManifest(JSON.parse(await readFile(path, "utf8")), path),
      );
    } catch (error) {
      manifests.push({
        path,
        servers: [],
        warnings: [
          `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        ],
      });
    }
  }
  return manifests;
}

/** Safe for terminal/UI output: never emits environment values or secrets. */
export function summarizeMcpManifest(manifest: McpManifest): string {
  const lines = [`${manifest.path}: ${manifest.servers.length} MCP server(s)`];
  for (const server of manifest.servers) {
    const transport = server.command
      ? `command ${server.command}`
      : server.url
        ? `URL ${server.url}`
        : "invalid transport";
    lines.push(
      `  - ${server.name} (${transport}${server.env ? `, ${Object.keys(server.env).length} env var(s)` : ""})`,
    );
    for (const warning of server.warnings)
      lines.push(`    warning: ${warning}`);
  }
  for (const warning of manifest.warnings) lines.push(`  warning: ${warning}`);
  return lines.join("\n");
}

function safeName(name: string): void {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(name))
    throw new Error(
      "MCP server name may contain only letters, numbers, ., _, and -",
    );
}

/** Build a mutation without touching disk. Existing top-level config keys are preserved. */
export async function planMcpConfig(
  path: string,
  server: McpServer,
  name = server.name,
): Promise<McpConfigPlan> {
  return planMcpConfigBatch(path, [{ server, name }]);
}

export async function planMcpConfigBatch(
  path: string,
  entries: Array<{ server: McpServer; name?: string }>,
): Promise<McpConfigPlan> {
  if (!entries.length) throw new Error("MCP configuration batch is empty");
  for (const entry of entries) safeName(entry.name ?? entry.server.name);
  const target = resolve(path);
  let current: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(target, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("config root must be an object");
    current = parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error(
        `Cannot read MCP config ${target}: ${error instanceof Error ? error.message : String(error)}`,
      );
  }
  const existing = current.mcpServers;
  if (
    existing !== undefined &&
    (!existing || typeof existing !== "object" || Array.isArray(existing))
  )
    throw new Error("mcpServers must be an object");
  const servers = { ...((existing ?? {}) as Record<string, unknown>) };
  const changes = [];
  const warnings: string[] = [];
  for (const item of entries) {
    const server = item.server;
    const name = item.name ?? server.name;
    const had = Object.prototype.hasOwnProperty.call(servers, name);
    const entry: Record<string, unknown> = server.url
      ? {
          url: server.url,
          ...(server.args.length ? { args: server.args } : {}),
          ...(Object.keys(server.env).length ? { env: server.env } : {}),
        }
      : {
          command: server.command,
          ...(server.args.length ? { args: server.args } : {}),
          ...(Object.keys(server.env).length ? { env: server.env } : {}),
        };
    servers[name] = entry;
    changes.push({
      serverName: name,
      action: had ? ("replace" as const) : ("add" as const),
      summary: `${had ? "Replace" : "Add"} MCP server '${name}' (${server.url ? "URL" : "command"}; ${Object.keys(server.env).length} environment variable(s))`,
    });
    warnings.push(...server.warnings);
  }
  const proposed = { ...current, mcpServers: servers };
  return {
    path: target,
    serverName: changes[0].serverName,
    changes,
    warnings: [...new Set(warnings)],
    proposed,
  };
}

export function summarizeMcpConfigPlan(plan: McpConfigPlan): string {
  return [
    `MCP config: ${plan.path}`,
    ...plan.changes.map((change) => `  - ${change.summary}`),
    ...plan.warnings.map((warning) => `  warning: ${warning}`),
  ].join("\n");
}

async function snapshotPath(id: string): Promise<string> {
  return join(loadoutHome(), "mcp-snapshots", `${id}.json`);
}

export async function applyMcpConfigPlan(
  plan: McpConfigPlan,
): Promise<McpConfigSnapshot> {
  await mkdir(dirname(plan.path), { recursive: true });
  try {
    const s = await readFile(plan.path, "utf8");
    if (s.length > 10_000_000)
      throw new Error("MCP config is unexpectedly large");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let existed = true;
  let content: string | undefined;
  try {
    content = await readFile(plan.path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      existed = false;
    } else throw error;
  }
  const snapshot: McpConfigSnapshot = {
    id: randomUUID(),
    path: plan.path,
    existed,
    content,
    createdAt: new Date().toISOString(),
  };
  const snap = await snapshotPath(snapshot.id);
  await mkdir(dirname(snap), { recursive: true });
  await writeFile(snap, JSON.stringify(snapshot), { mode: 0o600 });
  await writeMcpConfigPlan(plan);
  return snapshot;
}

/** Write an already-reviewed plan atomically; transaction callers own snapshot/rollback. */
export async function writeMcpConfigPlan(plan: McpConfigPlan): Promise<void> {
  await mkdir(dirname(plan.path), { recursive: true });
  const temporary = join(
    dirname(plan.path),
    `.${basename(plan.path)}.loadout-${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, `${JSON.stringify(plan.proposed, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, plan.path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function restoreMcpConfig(
  snapshot: McpConfigSnapshot,
): Promise<void> {
  if (snapshot.existed) {
    await mkdir(dirname(snapshot.path), { recursive: true });
    await writeFile(snapshot.path, snapshot.content ?? "", { mode: 0o600 });
  } else await rm(snapshot.path, { force: true });
}
