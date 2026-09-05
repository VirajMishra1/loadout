import {
  getHandoffState,
  sendHandoffUnlocked,
  withHandoffLock,
  type HandoffMessage,
  type HandoffVerification,
  HANDOFF_VERIFICATION_MAX_OUTPUT_BYTES,
} from "./handoff.js";
import { redactString } from "../coordination/redaction.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface HandoffVerificationRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

export type HandoffVerificationRunner = (
  projectRoot: string,
  command: NonNullable<HandoffVerification["command"]>,
) => Promise<HandoffVerificationRunResult>;

export const defaultHandoffVerificationRunner: HandoffVerificationRunner =
  async (projectRoot, command) => {
    const started = Date.now();
    try {
      const result = await execFileAsync(command.executable, command.args, {
        cwd: projectRoot,
        timeout: command.timeoutMs,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        shell: false,
        encoding: "utf8",
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: 0,
        durationMs: Math.min(Date.now() - started, 900_000),
        timedOut: false,
      };
    } catch (error) {
      const failure = error as {
        stdout?: string;
        stderr?: string;
        code?: number | string;
        killed?: boolean;
      };
      return {
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? (error instanceof Error ? error.message : ""),
        exitCode: typeof failure.code === "number" ? failure.code : 1,
        durationMs: Math.min(Date.now() - started, 900_000),
        timedOut: failure.killed === true,
      };
    }
  };

export interface CompleteHandoffOutcome {
  completed: boolean;
  message: HandoffMessage;
}

function boundedOutput(value: string): {
  value: string;
  isTruncated: boolean;
} {
  const redacted = redactString(value);
  const bytes = Buffer.from(redacted);
  if (bytes.byteLength <= HANDOFF_VERIFICATION_MAX_OUTPUT_BYTES)
    return { value: redacted, isTruncated: false };
  for (let remove = 0; remove <= 3; remove += 1) {
    try {
      return {
        value: new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(0, HANDOFF_VERIFICATION_MAX_OUTPUT_BYTES - remove),
        ),
        isTruncated: true,
      };
    } catch {
      // The byte cap can land inside one UTF-8 code point.
    }
  }
  return { value: "", isTruncated: true };
}

export async function completeHandoff(
  projectRoot: string,
  messageId: string,
  options: {
    manualEvidence?: string;
    approveCommand?: boolean;
    runner?: HandoffVerificationRunner;
  } = {},
): Promise<CompleteHandoffOutcome> {
  const original = await withHandoffLock(projectRoot, async () => {
    const state = await getHandoffState(projectRoot);
    const task = state.messages.find((message) => message.id === messageId);
    if (!task) throw new Error(`Message '${messageId}' not found`);
    if (task.type !== "task")
      throw new Error(`Message '${messageId}' is not a task`);
    if (state.done.some((message) => message.id === messageId))
      throw new Error(`Message '${messageId}' is already settled`);
    return task;
  });

  if (
    original.verification &&
    !original.verification.command &&
    !options.manualEvidence?.trim()
  )
    throw new Error(
      `Task '${messageId}' requires manual evidence for: ${original.verification.criteria}`,
    );
  if (original.verification?.command && !options.approveCommand)
    throw new Error(
      `Task '${messageId}' requires explicit approval to run its stored verification command`,
    );

  let completed = true;
  let description = `Completed: ${original.description}`;
  let evidence: HandoffMessage["evidence"];

  if (original.verification?.command) {
    const command = original.verification.command;
    const result = await (options.runner ?? defaultHandoffVerificationRunner)(
      projectRoot,
      command,
    );
    const passed = result.exitCode === 0 && !result.timedOut;
    const stdout = boundedOutput(result.stdout);
    const stderr = boundedOutput(result.stderr);
    completed = passed;
    description = passed
      ? `Completed: ${original.description}`
      : `Verification failed: ${original.verification.criteria}`;
    evidence = {
      mode: "command",
      status: passed ? "passed" : "failed",
      command: [command.executable, ...command.args],
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdout: stdout.value,
      stderr: stderr.value,
      timedOut: result.timedOut,
      isTruncated: stdout.isTruncated || stderr.isTruncated,
    };
  } else if (original.verification) {
    evidence = {
      mode: "manual",
      status: "passed",
      summary: options.manualEvidence!.trim(),
      isTruncated: false,
    };
  }

  return withHandoffLock(projectRoot, async () => {
    const current = await getHandoffState(projectRoot);
    if (current.done.some((message) => message.id === messageId))
      throw new Error(`Message '${messageId}' is already settled`);
    const message = await sendHandoffUnlocked(
      projectRoot,
      original.from,
      description,
      {
        from: original.to,
        type: completed ? "done" : "status",
        resolves: messageId,
        ...(evidence ? { evidence } : {}),
      },
    );
    return { completed, message };
  });
}
