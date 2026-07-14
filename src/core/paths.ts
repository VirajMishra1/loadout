import { access, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentId, DetectedAgent } from "../shared/types.js";

const execFileAsync = promisify(execFile);

const definitions: Array<{ id: AgentId; displayName: string; binary: string; directory: string }> = [
  { id: "claude-code", displayName: "Claude Code", binary: "claude", directory: ".claude/skills" },
  { id: "codex", displayName: "Codex", binary: "codex", directory: ".agents/skills" },
  { id: "cursor", displayName: "Cursor", binary: "cursor", directory: ".cursor/skills" },
  { id: "gemini-cli", displayName: "Gemini CLI", binary: "gemini", directory: ".gemini/skills" },
  { id: "opencode", displayName: "OpenCode", binary: "opencode", directory: ".opencode/skills" },
  { id: "hermes", displayName: "Hermes", binary: "hermes", directory: ".hermes/skills" }
];

export function loadoutHome(): string {
  return process.env.LOADOUT_HOME ?? join(process.env.HOME ?? process.cwd(), ".loadout");
}

export function userHome(): string {
  return process.env.LOADOUT_USER_HOME ?? process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
}

async function hasBinary(binary: string): Promise<boolean> {
  try {
    await execFileAsync(process.platform === "win32" ? "where" : "which", [binary]);
    return true;
  } catch {
    return false;
  }
}

export async function detectAgents(): Promise<DetectedAgent[]> {
  const home = userHome();
  return Promise.all(definitions.map(async (definition) => ({
    id: definition.id,
    displayName: definition.displayName,
    binary: definition.binary,
    installed: await hasBinary(definition.binary),
    skillsDirectory: join(home, definition.directory)
  })));
}

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function directoryExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export async function listDirectory(path: string): Promise<string[]> {
  try { return await readdir(path); } catch { return []; }
}
