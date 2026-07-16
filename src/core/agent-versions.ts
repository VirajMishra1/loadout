import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentId, DetectedAgent } from "../shared/types.js";
import { detectAgents, executableCandidates, userHome } from "./paths.js";

const execFileAsync = promisify(execFile);

export interface AgentVersionEvidence {
  agent: AgentId;
  displayName: string;
  installed: boolean;
  binary?: string;
  status: "not-installed" | "no-version-command" | "detected" | "error";
  version?: string;
  releaseChannel?: "stable" | "prerelease";
  command?: string[];
  errorKind?: "timeout" | "command-failed" | "malformed-output";
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
  const version = bounded.match(
    /(?:^|[^0-9A-Za-z.])v?(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?)(?:$|[^0-9A-Za-z.-])/,
  );
  return version?.[1];
}

export async function inspectAgentVersions(
  options: {
    agents?: DetectedAgent[];
    runner?: AgentVersionRunner;
    timeoutMs?: number;
    platform?: NodeJS.Platform;
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
      const candidates = executableCandidates(
        agent.binary,
        options.platform ?? process.platform,
      );
      const attempts: Array<{
        command: string;
        stdout: string;
        stderr: string;
        exitCode: number;
      }> = [];
      for (const candidate of candidates) {
        const result = await runner(candidate, ["--version"], {
          env,
          timeoutMs: options.timeoutMs ?? 5_000,
        });
        attempts.push({ command: candidate, ...result });
        const output = `${result.stdout}\n${result.stderr}`;
        const version = parseAgentVersion(output);
        if (result.exitCode === 0 && version) {
          const prerelease = version.includes("-");
          return {
            agent: agent.id,
            displayName: agent.displayName,
            installed: true,
            binary: candidate,
            status: "detected",
            version,
            releaseChannel: prerelease ? "prerelease" : "stable",
            command: [candidate, "--version"],
            message: prerelease
              ? "Local prerelease detected. Compatibility notices may be incomplete unless they explicitly include prereleases."
              : "Local version detected. No latest-version or compatibility claim is made without a signed compatibility feed.",
          };
        }
      }
      const timedOut = attempts.find((attempt) =>
        /timed out|timeout/i.test(attempt.stderr),
      );
      const failed = attempts.find((attempt) => attempt.exitCode !== 0);
      const last = attempts.at(-1)!;
      const errorKind = timedOut
        ? "timeout"
        : failed
          ? "command-failed"
          : "malformed-output";
      return {
        agent: agent.id,
        displayName: agent.displayName,
        installed: true,
        binary: last.command,
        status: "error",
        command: [last.command, "--version"],
        errorKind,
        message:
          errorKind === "timeout"
            ? `Version command timed out after ${options.timeoutMs ?? 5_000}ms.`
            : errorKind === "command-failed"
              ? `Version command failed with exit code ${failed!.exitCode}.`
              : "Version command returned no recognized version.",
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
