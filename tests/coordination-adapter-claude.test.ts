import { describe, expect, it } from "vitest";
import {
  ClaudeCodeAdapter,
  type ClaudeCommandDriver,
} from "../src/core/coordination/adapters/claude-code.js";

interface CommandCall {
  command: string;
  args: string[];
  options: { cwd?: string; timeout: number };
}

function recordingDriver(outputs: string[]): {
  calls: CommandCall[];
  driver: ClaudeCommandDriver;
} {
  const calls: CommandCall[] = [];
  return {
    calls,
    driver: async (command, args, options) => {
      calls.push({ command, args: [...args], options });
      return { stdout: outputs.shift() ?? "" };
    },
  };
}

describe("ClaudeCodeAdapter", () => {
  it("starts with the supported print-mode positional prompt", async () => {
    const fake = recordingDriver([
      JSON.stringify({ session_id: "claude-session-1" }),
    ]);
    const adapter = new ClaudeCodeAdapter(fake.driver);

    const session = await adapter.start({
      cwd: "/work/project",
      prompt: "Implement the contract",
    });

    expect(fake.calls).toEqual([
      {
        command: "claude",
        args: ["-p", "--output-format", "json", "Implement the contract"],
        options: { cwd: "/work/project", timeout: 30_000 },
      },
    ]);
    expect(session).toMatchObject({
      sessionId: "claude-session-1",
      provider: "claude-code",
      busy: false,
    });
  });

  it("submits a follow-up turn with --resume and a positional prompt", async () => {
    const fake = recordingDriver([
      JSON.stringify({ session_id: "claude-session-1" }),
      JSON.stringify({ session_id: "claude-session-1" }),
    ]);
    const adapter = new ClaudeCodeAdapter(fake.driver);
    const session = await adapter.start({ cwd: "/work", prompt: "First" });

    await expect(
      adapter.submitTurn(session, { message: "Second" }),
    ).resolves.toBe(true);

    expect(fake.calls[1]).toEqual({
      command: "claude",
      args: [
        "-p",
        "--output-format",
        "json",
        "--resume",
        "claude-session-1",
        "Second",
      ],
      options: { cwd: "/work", timeout: 30_000 },
    });
    expect(fake.calls.flatMap((call) => call.args)).not.toContain("--message");
  });

  it("rejects output without a valid session_id", async () => {
    const fake = recordingDriver([JSON.stringify({ session_id: "   " })]);
    const adapter = new ClaudeCodeAdapter(fake.driver);

    await expect(
      adapter.start({ cwd: "/work", prompt: "First" }),
    ).rejects.toThrow(/valid session_id/i);
  });

  it("lists only sessions created through this adapter without invoking a command", async () => {
    const fake = recordingDriver([
      JSON.stringify({ session_id: "claude-session-1" }),
    ]);
    const adapter = new ClaudeCodeAdapter(fake.driver);
    const created = await adapter.start({ cwd: "/work", prompt: "First" });
    const callsAfterStart = fake.calls.length;

    await expect(adapter.listSessions("/work")).resolves.toEqual([created]);
    expect(fake.calls).toHaveLength(callsAfterStart);
    expect(fake.calls.flatMap((call) => call.args)).not.toEqual(
      expect.arrayContaining(["sessions", "list"]),
    );
  });

  it("denies a concurrent turn while the session is busy", async () => {
    let finishTurn: ((value: { stdout: string }) => void) | undefined;
    const driver: ClaudeCommandDriver = async () =>
      new Promise((resolve) => {
        finishTurn = resolve;
      });
    const adapter = new ClaudeCodeAdapter(driver);
    const session = await adapter.resume("claude-session-1", "/work");

    const first = adapter.submitTurn(session, { message: "First" });
    await expect(
      adapter.submitTurn(session, { message: "Second" }),
    ).resolves.toBe(false);
    expect(session.busy).toBe(true);

    finishTurn?.({
      stdout: JSON.stringify({ session_id: "claude-session-1" }),
    });
    await expect(first).resolves.toBe(true);
    expect(session.busy).toBe(false);
  });
});
