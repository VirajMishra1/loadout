import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { McpConfigSnapshot, McpServer } from "../shared/types.js";
import { loadoutHome, userHome } from "./paths.js";
import { runMutationTransaction } from "./transaction.js";

export interface CodexMcpConfigPlan {
  path: string;
  serverName: string;
  summary: string;
  baseSha256: string;
  /** The proposed TOML is internal because it can contain secret values. */
  proposed: string;
}

function safeName(name: string): void {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(name))
    throw new Error(
      "MCP server name may contain only letters, numbers, ., _, and -",
    );
}

function tomlString(value: string): string {
  // TOML basic-string escaping is compatible with JSON escaping for the values
  // Loadout writes here, and preserves literal environment values without
  // rendering them in a plan summary.
  return JSON.stringify(value);
}

function tableHeader(name: string): string {
  return `[mcp_servers.${tomlString(name)}]`;
}

export function defaultCodexMcpConfigPath(): string {
  return join(userHome(), ".codex", "config.toml");
}

/**
 * Appends a new official Codex TOML MCP table without parsing or rewriting any
 * existing TOML. Replacing an existing server is intentionally rejected until
 * Loadout has a comment-preserving TOML editor.
 */
export async function planCodexMcpConfig(
  path: string,
  server: McpServer,
  name = server.name,
): Promise<CodexMcpConfigPlan> {
  safeName(name);
  if ((server.command ? 1 : 0) + (server.url ? 1 : 0) !== 1)
    throw new Error("Codex MCP server requires exactly one command or URL");
  const target = resolve(path);
  let current = "";
  let existed = true;
  try {
    current = await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") existed = false;
    else throw error;
  }
  const header = tableHeader(name);
  if (
    new RegExp(
      `^\\s*${header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
      "m",
    ).test(current)
  ) {
    throw new Error(
      `Codex MCP server '${name}' already exists; Loadout refuses to rewrite existing TOML tables`,
    );
  }
  const lines = [header];
  if (server.command) lines.push(`command = ${tomlString(server.command)}`);
  if (server.url) lines.push(`url = ${tomlString(server.url)}`);
  if (server.args.length)
    lines.push(`args = [${server.args.map(tomlString).join(", ")}]`);
  if (Object.keys(server.env).length) {
    lines.push("", `[mcp_servers.${tomlString(name)}.env]`);
    for (const key of Object.keys(server.env).sort()) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
        throw new Error(`Invalid environment variable name '${key}'`);
      lines.push(`${key} = ${tomlString(server.env[key])}`);
    }
  }
  const separator =
    current.length === 0 ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  return {
    path: target,
    serverName: name,
    summary: `Add Codex MCP server '${name}' (${server.url ? "URL" : "command"}; ${Object.keys(server.env).length} environment variable(s))`,
    baseSha256: createHash("sha256")
      .update(existed ? current : "loadout:codex-mcp:missing")
      .digest("hex"),
    proposed: `${current}${separator}${lines.join("\n")}\n`,
  };
}

async function snapshotPath(id: string): Promise<string> {
  return join(loadoutHome(), "mcp-snapshots", `${id}.json`);
}

export async function applyCodexMcpConfigPlan(
  plan: CodexMcpConfigPlan,
): Promise<McpConfigSnapshot> {
  const applied = await runMutationTransaction(
    async () => {
      let content = "";
      let existed = true;
      try {
        content = await readFile(plan.path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") existed = false;
        else throw error;
      }
      const current = createHash("sha256")
        .update(existed ? content : "loadout:codex-mcp:missing")
        .digest("hex");
      if (current !== plan.baseSha256)
        throw new Error(
          "Codex MCP configuration changed after preview; prepare the plan again.",
        );
      const snapshot: McpConfigSnapshot = {
        id: randomUUID(),
        path: plan.path,
        existed,
        ...(existed ? { content } : {}),
        createdAt: new Date().toISOString(),
      };
      const stored = await snapshotPath(snapshot.id);
      return {
        targets: [plan.path, stored],
        value: { plan, snapshot, stored },
      };
    },
    async ({ plan: freshPlan, snapshot, stored }) => {
      await mkdir(dirname(freshPlan.path), { recursive: true });
      const temporary = join(
        dirname(freshPlan.path),
        `.${basename(freshPlan.path)}.loadout-${randomUUID()}.tmp`,
      );
      try {
        await writeFile(temporary, freshPlan.proposed, { mode: 0o600 });
        await rename(temporary, freshPlan.path);
        await mkdir(dirname(stored), { recursive: true });
        await writeFile(stored, JSON.stringify(snapshot), { mode: 0o600 });
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
      return snapshot;
    },
  );
  return applied.result;
}
