import { describe, expect, it } from "vitest";
import {
  inspectAgentVersions,
  parseAgentVersion,
  type AgentVersionRunner,
} from "../src/core/agent-versions.js";
import type { DetectedAgent } from "../src/shared/types.js";

describe("agent version intelligence", () => {
  it("parses common semantic and short version output without accepting noise", () => {
    expect(parseAgentVersion("codex-cli 1.2.3\n")).toBe("1.2.3");
    expect(parseAgentVersion("Claude Code v2.0.1-beta.2")).toBe("2.0.1-beta.2");
    expect(parseAgentVersion("cursor 0.48")).toBe("0.48");
    expect(parseAgentVersion("development build")).toBeUndefined();
  });

  it("runs only bounded version commands with a credential-stripped environment", async () => {
    const agents: DetectedAgent[] = [
      {
        id: "codex",
        displayName: "Codex",
        installed: true,
        binary: "codex",
        skillsDirectory: "/tmp/codex",
      },
      {
        id: "windsurf",
        displayName: "Windsurf",
        installed: true,
        skillsDirectory: "/tmp/windsurf",
      },
      {
        id: "hermes",
        displayName: "Hermes",
        installed: false,
        binary: "hermes",
        skillsDirectory: "/tmp/hermes",
      },
    ];
    const runner: AgentVersionRunner = async (command, args, options) => {
      expect(command).toBe("codex");
      expect(args).toEqual(["--version"]);
      expect(options.timeoutMs).toBe(5000);
      expect(options.env).not.toHaveProperty("OPENAI_API_KEY");
      expect(options.env).not.toHaveProperty("ANTHROPIC_API_KEY");
      return { stdout: "codex 5.6.1\n", stderr: "", exitCode: 0 };
    };
    const evidence = await inspectAgentVersions({ agents, runner });
    expect(evidence).toEqual([
      expect.objectContaining({
        agent: "codex",
        status: "detected",
        version: "5.6.1",
      }),
      expect.objectContaining({
        agent: "windsurf",
        status: "no-version-command",
      }),
      expect.objectContaining({
        agent: "hermes",
        status: "not-installed",
      }),
    ]);
  });

  it("reports timeouts and malformed output without inventing a version", async () => {
    const agent: DetectedAgent = {
      id: "codex",
      displayName: "Codex",
      installed: true,
      binary: "codex",
      skillsDirectory: "/tmp/codex",
    };
    const evidence = await inspectAgentVersions({
      agents: [agent],
      runner: async () => ({
        stdout: "unknown build",
        stderr: "version command timed out",
        exitCode: 1,
      }),
    });
    expect(evidence[0]).toMatchObject({ status: "error" });
    expect(evidence[0].version).toBeUndefined();
  });
});
