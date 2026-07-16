import { access, mkdir, readdir } from "node:fs/promises";
import { join, posix, win32 } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentId, DetectedAgent } from "../shared/types.js";

const execFileAsync = promisify(execFile);

export const AGENT_DEFINITIONS: ReadonlyArray<{
  id: AgentId;
  displayName: string;
  binary?: string;
  directory: readonly string[];
  /** Agent-owned roots whose presence proves an IDE/config installation. */
  detectionDirectories?: readonly (readonly string[])[];
}> = [
  {
    id: "claude-code",
    displayName: "Claude Code",
    binary: "claude",
    directory: [".claude", "skills"],
  },
  {
    id: "codex",
    displayName: "Codex",
    binary: "codex",
    directory: [".agents", "skills"],
    // Codex Desktop owns ~/.codex even when the standalone `codex` binary is
    // not exposed on the shell PATH. The shared Agent Skills root (~/.agents)
    // is also valid evidence when it already exists.
    detectionDirectories: [[".codex"], [".agents"]],
  },
  {
    id: "cursor",
    displayName: "Cursor",
    binary: "cursor",
    directory: [".cursor", "skills"],
  },
  {
    id: "gemini-cli",
    displayName: "Gemini CLI",
    binary: "gemini",
    directory: [".gemini", "skills"],
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    binary: "opencode",
    directory: [".config", "opencode", "skills"],
  },
  {
    id: "hermes",
    displayName: "Hermes",
    binary: "hermes",
    directory: [".hermes", "skills"],
  },
  {
    id: "windsurf",
    displayName: "Windsurf",
    directory: [".codeium", "windsurf", "skills"],
    detectionDirectories: [[".codeium", "windsurf"]],
  },
  {
    id: "cline",
    displayName: "Cline",
    binary: "cline",
    directory: [".cline", "skills"],
    detectionDirectories: [[".cline"]],
  },
  {
    id: "github-copilot",
    displayName: "GitHub Copilot",
    binary: "copilot",
    directory: [".copilot", "skills"],
    detectionDirectories: [[".copilot"]],
  },
  {
    id: "roo-code",
    displayName: "Roo Code",
    directory: [".roo", "skills"],
    detectionDirectories: [[".roo"]],
  },
  {
    id: "kiro-cli",
    displayName: "Kiro CLI",
    directory: [".kiro", "skills"],
    detectionDirectories: [[".kiro"]],
  },
  {
    id: "junie",
    displayName: "Junie",
    directory: [".junie", "skills"],
    detectionDirectories: [[".junie"]],
  },
];

/** Parse one CLI agent selection consistently across every command. */
export function parseAgentSelection(input?: string): AgentId[] | undefined {
  if (input === undefined) return undefined;
  const values = input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.length)
    throw new Error("--agents requires at least one supported agent id");
  const known = new Set(AGENT_DEFINITIONS.map((definition) => definition.id));
  const unknown = [
    ...new Set(values.filter((id) => !known.has(id as AgentId))),
  ];
  if (unknown.length)
    throw new Error(
      `Unknown agent id(s): ${unknown.join(", ")}. Supported ids: ${[...known].join(", ")}`,
    );
  return [...new Set(values)] as AgentId[];
}

type PathEnvironment = NodeJS.ProcessEnv;

export type RuntimeBoundary = "windows" | "wsl" | "posix";

/**
 * WSL intentionally uses its Linux/POSIX home and paths. We never translate a
 * Windows USERPROFILE into /mnt/c because that would install into a different
 * agent profile than the Linux executable uses.
 */
export function runtimeBoundary(
  env: PathEnvironment = process.env,
  platform: NodeJS.Platform = process.platform,
): RuntimeBoundary {
  if (platform === "win32") return "windows";
  if (
    platform === "linux" &&
    (Boolean(env.WSL_DISTRO_NAME) || Boolean(env.WSL_INTEROP))
  )
    return "wsl";
  return "posix";
}

export function userHome(
  env: PathEnvironment = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (env.LOADOUT_USER_HOME) return env.LOADOUT_USER_HOME;
  // USERPROFILE is the canonical home variable on native Windows. HOME is
  // still accepted as a fallback for Git Bash/WSL and test environments.
  if (platform === "win32") return env.USERPROFILE ?? env.HOME ?? process.cwd();
  return env.HOME ?? env.USERPROFILE ?? process.cwd();
}

export function loadoutHome(
  env: PathEnvironment = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (env.LOADOUT_HOME) return env.LOADOUT_HOME;
  if (platform === "win32") {
    // Application state belongs in roaming app data on Windows rather than a
    // dot-directory in the profile. APPDATA may be absent in stripped-down
    // shells, so fall back to a conventional profile path.
    const appData =
      env.APPDATA ?? win32.join(userHome(env, platform), "AppData", "Roaming");
    return win32.join(appData, "loadout");
  }
  return join(userHome(env, platform), ".loadout");
}

/** The lookup order accepts npm's Windows .cmd shims as first-class executables. */
export function executableCandidates(
  binary: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform !== "win32") return [binary];
  return [binary, `${binary}.cmd`, `${binary}.exe`, `${binary}.bat`];
}

export function executableLookup(
  binary: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; candidates: string[] } {
  return {
    command: platform === "win32" ? "where" : "which",
    candidates: executableCandidates(binary, platform),
  };
}

async function hasBinary(
  binary: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  const lookup = executableLookup(binary, platform);
  try {
    for (const candidate of lookup.candidates) {
      try {
        await execFileAsync(lookup.command, [candidate]);
        return true;
      } catch {
        // Continue so an npm-installed command such as codex.cmd is found
        // even when the bare command is not resolved by a stripped-down PATH.
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function agentSkillsDirectory(
  agent: AgentId,
  home = userHome(),
  platform: NodeJS.Platform = process.platform,
): string {
  const definition = AGENT_DEFINITIONS.find((entry) => entry.id === agent);
  if (!definition) throw new Error(`Unknown agent '${agent}'`);
  const path = platform === "win32" ? win32 : posix;
  return path.join(home, ...definition.directory);
}

export async function detectAgents(
  options: { env?: PathEnvironment; platform?: NodeJS.Platform } = {},
): Promise<DetectedAgent[]> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = userHome(env, platform);
  return Promise.all(
    AGENT_DEFINITIONS.map(async (definition) => {
      const path = platform === "win32" ? win32 : posix;
      const skillsDirectory = agentSkillsDirectory(
        definition.id,
        home,
        platform,
      );
      const detectionDirectories = definition.detectionDirectories?.map(
        (parts) => path.join(home, ...parts),
      ) ?? [dirnameForDetection(skillsDirectory)];
      return {
        id: definition.id,
        displayName: definition.displayName,
        ...(definition.binary ? { binary: definition.binary } : {}),
        installed:
          (definition.binary
            ? await hasBinary(definition.binary, platform)
            : false) ||
          (
            await Promise.all(
              detectionDirectories.map((directory) =>
                directoryExists(directory),
              ),
            )
          ).some(Boolean),
        skillsDirectory,
      };
    }),
  );
}

function dirnameForDetection(skillsDirectory: string): string {
  return skillsDirectory.replace(/[\\/]skills$/, "");
}

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function directoryExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function listDirectory(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}
