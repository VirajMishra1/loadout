import { access, mkdir, readdir } from "node:fs/promises";
import { join, win32 } from "node:path";
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

type PathEnvironment = NodeJS.ProcessEnv;

export function userHome(env: PathEnvironment = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.LOADOUT_USER_HOME) return env.LOADOUT_USER_HOME;
  // USERPROFILE is the canonical home variable on native Windows. HOME is
  // still accepted as a fallback for Git Bash/WSL and test environments.
  if (platform === "win32") return env.USERPROFILE ?? env.HOME ?? process.cwd();
  return env.HOME ?? env.USERPROFILE ?? process.cwd();
}

export function loadoutHome(env: PathEnvironment = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.LOADOUT_HOME) return env.LOADOUT_HOME;
  if (platform === "win32") {
    // Application state belongs in roaming app data on Windows rather than a
    // dot-directory in the profile. APPDATA may be absent in stripped-down
    // shells, so fall back to a conventional profile path.
    const appData = env.APPDATA ?? win32.join(userHome(env, platform), "AppData", "Roaming");
    return win32.join(appData, "loadout");
  }
  return join(userHome(env, platform), ".loadout");
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
  return Promise.all(definitions.map(async (definition) => {
    const skillsDirectory = join(home, definition.directory);
    return { id: definition.id, displayName: definition.displayName, binary: definition.binary, installed: await hasBinary(definition.binary) || await directoryExists(dirnameForDetection(skillsDirectory)), skillsDirectory };
  }));
}

function dirnameForDetection(skillsDirectory: string): string {
  return skillsDirectory.replace(/[\\/]skills$/, "");
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
