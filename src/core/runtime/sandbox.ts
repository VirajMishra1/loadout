import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);

export interface SandboxRunResult {
  image: string;
  command: string[];
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SandboxRunOptions {
  sourceDirectory: string;
  image: string;
  command: string[];
  approveRisk: boolean;
  timeoutMs?: number;
  runner?: (
    args: string[],
    timeoutMs: number,
  ) => Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
}

/**
 * Run an explicitly approved command in a disposable local Docker container.
 * Source is mounted read-only; no host environment, socket, network, or
 * writable source path is exposed. This executes nothing unless approveRisk is
 * true and the caller supplies an image they have reviewed/pinned.
 */
export async function runDisposableSandbox(
  options: SandboxRunOptions,
): Promise<SandboxRunResult> {
  if (!options.approveRisk)
    throw new Error("Sandbox execution requires explicit --approve-risk");
  if (!options.image.trim() || /\s/.test(options.image))
    throw new Error("Sandbox image must be one reviewed image reference");
  if (!options.command.length || options.command.some((item) => !item.trim()))
    throw new Error(
      "Sandbox command must contain at least one non-empty argument",
    );
  const sourceDirectory = resolve(options.sourceDirectory);
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 900_000)
    throw new Error("Sandbox timeout must be between 1000ms and 900000ms");
  const args = [
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "128",
    "--memory",
    "512m",
    "--cpus",
    "1",
    "--user",
    "65532:65532",
    "--mount",
    `type=bind,src=${sourceDirectory},dst=/input,readonly`,
    options.image,
    ...options.command,
  ];
  const runner =
    options.runner ??
    (async (dockerArgs, timeout) => {
      try {
        const result = await execFileAsync("docker", dockerArgs, {
          timeout,
          windowsHide: true,
          // Deliberately do not spread process.env into an untrusted process.
          env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
          maxBuffer: 2 * 1024 * 1024,
        });
        return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
      } catch (error) {
        const result = error as {
          stdout?: string;
          stderr?: string;
          code?: number;
          killed?: boolean;
        };
        if (result.killed)
          throw new Error(`Sandbox timed out after ${timeout}ms`);
        return {
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? String(error),
          exitCode: typeof result.code === "number" ? result.code : 1,
        };
      }
    });
  const result = await runner(args, timeoutMs);
  return {
    image: options.image,
    command: options.command,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}
