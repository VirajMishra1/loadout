import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import {
  JSONRPCMessageSchema,
  LATEST_PROTOCOL_VERSION,
} from "@modelcontextprotocol/sdk/types.js";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: Record<string, unknown>;
  error?: unknown;
}

describe("coordination MCP server", () => {
  it("serves tools over protocol-only stdio output", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "loadout-mcp-"));
    const child = spawn(
      resolve("node_modules/.bin/tsx"),
      [resolve("src/cli.ts"), "serve"],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          LOADOUT_HOME: join(projectRoot, ".loadout-state"),
          LOADOUT_USER_HOME: projectRoot,
          NO_COLOR: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    const stderr: string[] = [];
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => stderr.push(chunk));

    const pending = new Map<
      number,
      {
        resolve: (response: JsonRpcResponse) => void;
        reject: (error: Error) => void;
      }
    >();
    const protocolErrors: Error[] = [];
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        const message = JSONRPCMessageSchema.parse(JSON.parse(line));
        if (!("id" in message) || typeof message.id !== "number") return;
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        waiter.resolve(message as JsonRpcResponse);
      } catch (error) {
        const protocolError = new Error(
          `Non-protocol stdout from MCP server: ${line}`,
          { cause: error },
        );
        protocolErrors.push(protocolError);
        for (const waiter of pending.values()) waiter.reject(protocolError);
        pending.clear();
      }
    });

    function request(
      id: number,
      method: string,
      params: Record<string, unknown>,
    ): Promise<JsonRpcResponse> {
      return new Promise((resolveRequest, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(
            new Error(
              `Timed out waiting for MCP ${method}; stderr: ${stderr.join("")}`,
            ),
          );
        }, 5_000);
        pending.set(id, {
          resolve: (response) => {
            clearTimeout(timeout);
            resolveRequest(response);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        );
      });
    }

    try {
      const initialized = await request(1, "initialize", {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "loadout-test", version: "1.0.0" },
      });
      expect(initialized).toMatchObject({
        id: 1,
        result: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          serverInfo: { name: "loadout-coordinator", version: "0.9.0" },
        },
      });

      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );
      const listed = await request(2, "tools/list", {});
      const tools = (listed.result as { tools: Array<{ name: string }> }).tools;
      expect(tools.map((tool) => tool.name)).toEqual([
        "claim_task",
        "release_ownership",
        "publish_contract",
        "publish_update",
        "subscribe",
        "ack",
        "snapshot",
      ]);

      const claimed = toolResult(
        await request(3, "tools/call", {
          name: "claim_task",
          arguments: {
            agent: "codex",
            description: "Exercise packaged coordination",
            ownPaths: ["src/mcp.ts"],
          },
        }),
      );
      expect(claimed.isError).not.toBe(true);
      expect(claimed.content[0]?.text).toContain("Claimed ownership");

      const snapshotted = toolResult(
        await request(4, "tools/call", {
          name: "snapshot",
          arguments: { agent: "reviewer" },
        }),
      );
      expect(snapshotted.isError).not.toBe(true);
      expect(snapshotted.content.map((item) => item.text).join("\n")).toContain(
        "Exercise packaged coordination",
      );

      const invalid = toolResult(
        await request(5, "tools/call", {
          name: "snapshot",
          arguments: {},
        }),
      );
      expect(invalid.isError).toBe(true);

      const conflict = toolResult(
        await request(6, "tools/call", {
          name: "claim_task",
          arguments: {
            agent: "claude-code",
            description: "Conflicting ownership",
            ownPaths: ["src/mcp.ts"],
          },
        }),
      );
      expect(conflict.isError).toBe(true);
      expect(conflict.content[0]?.text).toContain("src/mcp.ts");

      const firstContract = toolResult(
        await request(7, "tools/call", {
          name: "publish_contract",
          arguments: {
            agent: "claude-code",
            name: "checkout-api",
            body: "POST /checkout -> 201",
          },
        }),
      );
      const secondContract = toolResult(
        await request(8, "tools/call", {
          name: "publish_contract",
          arguments: {
            agent: "claude-code",
            name: "checkout-api",
            body: "POST /checkout -> 202",
          },
        }),
      );
      expect(firstContract.content[0]?.text).toContain("rev1");
      expect(secondContract.content[0]?.text).toContain("rev2");

      const released = toolResult(
        await request(9, "tools/call", {
          name: "release_ownership",
          arguments: { agent: "codex", paths: ["src/mcp.ts"] },
        }),
      );
      expect(released.isError).not.toBe(true);
      const reclaimed = toolResult(
        await request(10, "tools/call", {
          name: "claim_task",
          arguments: {
            agent: "claude-code",
            description: "Ownership after release",
            ownPaths: ["src/mcp.ts"],
          },
        }),
      );
      expect(reclaimed.isError).not.toBe(true);
      expect(protocolErrors).toEqual([]);
    } finally {
      lines.close();
      child.kill();
      await waitForClose(child);
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

function toolResult(response: JsonRpcResponse): {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
} {
  expect(response.error).toBeUndefined();
  return response.result as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
}

async function waitForClose(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const forceKill = setTimeout(() => child.kill("SIGKILL"), 2_000);
  try {
    await once(child, "close");
  } finally {
    clearTimeout(forceKill);
  }
}
