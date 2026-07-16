import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentId, DetectedAgent } from "../shared/types.js";
import { detectAgents, userHome } from "./paths.js";

const execFileAsync = promisify(execFile);

export interface AgentVersionEvidence {
  agent: AgentId;
  displayName: string;
  installed: boolean;
  binary?: string;
  status: "not-installed" | "no-version-command" | "detected" | "error";
  version?: string;
  command?: string[];
  message: string;
}

export type AgentVersionRunner = (
  command: string,
  args: readonly string[],
  options: { env: Record<string, string>; timeoutMs: number },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

function versionEnvironment(): Record<string, string> {
  const names = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "WINDIR",
    "TMPDIR",
    "TMP",
    "TEMP",
  ];
  return {
    ...Object.fromEntries(
      names.flatMap((name) =>
        process.env[name] === undefined ? [] : [[name, process.env[name]!]],
      ),
    ),
    HOME: userHome(),
    USERPROFILE: userHome(),
    NO_COLOR: "1",
  };
}

const defaultRunner: AgentVersionRunner = async (command, args, options) => {
  try {
    const result = await execFileAsync(command, [...args], {
      env: options.env,
      timeout: options.timeoutMs,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
    };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.killed
        ? "version command timed out"
        : (failure.stderr ?? ""),
      exitCode: typeof failure.code === "number" ? failure.code : 1,
    };
  }
};

export function parseAgentVersion(output: string): string | undefined {
  const bounded = output.trim().slice(0, 1024);
  const semantic = bounded.match(
    /(?:^|[^0-9])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:$|[^0-9A-Za-z.-])/,
  );
  if (semantic) return semantic[1];
  const short = bounded.match(/(?:^|[^0-9])(\d+\.\d+)(?:$|[^0-9])/);
  return short?.[1];
}

export async function inspectAgentVersions(
  options: {
    agents?: DetectedAgent[];
    runner?: AgentVersionRunner;
    timeoutMs?: number;
  } = {},
): Promise<AgentVersionEvidence[]> {
  const agents = options.agents ?? (await detectAgents());
  const runner = options.runner ?? defaultRunner;
  const env = versionEnvironment();
  return Promise.all(
    agents.map(async (agent): Promise<AgentVersionEvidence> => {
      if (!agent.installed)
        return {
          agent: agent.id,
          displayName: agent.displayName,
          installed: false,
          ...(agent.binary ? { binary: agent.binary } : {}),
          status: "not-installed",
          message: "Agent is not detected.",
        };
      if (!agent.binary)
        return {
          agent: agent.id,
          displayName: agent.displayName,
          installed: true,
          status: "no-version-command",
          message:
            "Agent is detected from local configuration, but no reviewed CLI version command is available.",
        };
      const command = [agent.binary, "--version"];
      const result = await runner(agent.binary, ["--version"], {
        env,
        timeoutMs: options.timeoutMs ?? 5_000,
      });
      const output = `${result.stdout}\n${result.stderr}`;
      const version = parseAgentVersion(output);
      if (result.exitCode !== 0 || !version)
        return {
          agent: agent.id,
          displayName: agent.displayName,
          installed: true,
          binary: agent.binary,
          status: "error",
          command,
          message:
            result.exitCode !== 0
              ? `Version command failed with exit code ${result.exitCode}.`
              : "Version command returned no recognized version.",
        };
      return {
        agent: agent.id,
        displayName: agent.displayName,
        installed: true,
        binary: agent.binary,
        status: "detected",
        version,
        command,
        message:
          "Local version detected. No latest-version or compatibility claim is made without a signed compatibility feed.",
      };
    }),
  );
}

export function formatAgentVersions(items: AgentVersionEvidence[]): string {
  return [
    "Agent versions",
    ...items.map((item) => {
      const marker =
        item.status === "detected" ? "✓" : item.status === "error" ? "!" : "•";
      return `${marker} ${item.displayName}: ${item.version ?? item.status} — ${item.message}`;
    }),
    "Compatibility updates require a separately verified signed feed; this command does not guess from model memory.",
  ].join("\n");
}
