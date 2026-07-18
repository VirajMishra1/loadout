import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { applyMcpConfigPlan } from "../src/core/mcp.js";
import {
  REVIEWED_MCP_RECIPES,
  planMcpRecipe,
  verifyMcpRecipe,
  verifyMcpRecipeConnection,
  type McpSubprocessFactory,
  type McpVerificationProcess,
} from "../src/core/mcp-recipes.js";

class FakeMcpProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  written = "";
  killCount = 0;
  onWrite?: (value: string) => void;

  constructor() {
    super();
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        const value = chunk.toString();
        this.written += value;
        this.onWrite?.(value);
        callback();
      },
    });
  }

  kill(): boolean {
    this.killCount += 1;
    return true;
  }

  asProcess(): McpVerificationProcess {
    return this as unknown as McpVerificationProcess;
  }
}

describe("reviewed MCP recipes", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("pins every reviewed source and executable artifact immutably", () => {
    for (const recipe of REVIEWED_MCP_RECIPES) {
      expect(recipe.reviewedCommit).toMatch(/^[a-f0-9]{40}$/);
      expect(recipe.source).toContain(recipe.reviewedCommit);
      expect(recipe.artifact).toMatch(/(?:sha512-|@sha256:)/);
      expect(JSON.stringify(recipe)).not.toMatch(/@latest|:latest/);
    }
  });

  it("includes useful browser MCP recipes that need no API credential", () => {
    const noKey = REVIEWED_MCP_RECIPES.filter(
      (recipe) => recipe.environment.length === 0,
    ).map((recipe) => recipe.id);
    expect(noKey).toContain("playwright");
    expect(noKey).toContain("chrome-devtools");
    expect(noKey).not.toContain("github-readonly");
  });

  it("plans a reviewed recipe without a credential value and preserves unrelated JSON", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-mcp-recipe-"));
    const config = join(root, "mcp.json");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(config, JSON.stringify({ untouched: true })),
    );
    const plan = await planMcpRecipe("github-readonly", config);
    expect(JSON.stringify(plan)).not.toContain("secret");
    expect(plan.authorization.join(" ")).toContain(
      "GITHUB_PERSONAL_ACCESS_TOKEN",
    );
    await applyMcpConfigPlan(plan.config);
    const persisted = JSON.parse(await readFile(config, "utf8"));
    expect(persisted.untouched).toBe(true);
    expect(persisted.mcpServers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe(
      "${GITHUB_PERSONAL_ACCESS_TOKEN}",
    );
    expect(persisted.mcpServers.github.env.GITHUB_READ_ONLY).toBe("1");
    await expect(
      verifyMcpRecipe("github-readonly", config),
    ).resolves.toMatchObject({ configured: true });

    persisted.mcpServers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN =
      "must-not-be-accepted-as-a-reference";
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(config, JSON.stringify(persisted)),
    );
    const plaintext = await verifyMcpRecipe("github-readonly", config);
    expect(plaintext.configured).toBe(false);
    expect(plaintext.warnings.join(" ")).toMatch(/not a variable reference/);
    expect(JSON.stringify(plaintext)).not.toContain(
      "must-not-be-accepted-as-a-reference",
    );
  });

  it("fails closed when credentialed configuration lacks a resolved environment reference", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-mcp-credential-gate-"));
    const config = join(root, "mcp.json");
    await expect(
      planMcpRecipe("github-readonly", config, {
        requireResolvedCredentials: true,
        credentialReferences: {},
        environment: {},
      }),
    ).rejects.toThrow(/requires a credential reference/);
    await expect(
      planMcpRecipe("github-readonly", config, {
        requireResolvedCredentials: true,
        credentialReferences: {
          GITHUB_PERSONAL_ACCESS_TOKEN: {
            kind: "os-keychain",
            service: "loadout.github",
          },
        },
        environment: {},
      }),
    ).rejects.toThrow(/keychain.*connection verification/i);
    const invalidReference = "NOT-AN-ENV-NAME";
    let invalidMessage = "";
    try {
      await planMcpRecipe("github-readonly", config, {
        requireResolvedCredentials: true,
        credentialReferences: {
          GITHUB_PERSONAL_ACCESS_TOKEN: {
            kind: "environment",
            name: invalidReference,
          },
        },
        environment: {},
      });
    } catch (error) {
      invalidMessage = error instanceof Error ? error.message : String(error);
    }
    expect(invalidMessage).toMatch(/invalid environment reference/i);
    expect(invalidMessage).not.toContain(invalidReference);

    const secret = "never-serialize-this";
    const plan = await planMcpRecipe("github-readonly", config, {
      requireResolvedCredentials: true,
      credentialReferences: {
        GITHUB_PERSONAL_ACCESS_TOKEN: {
          kind: "environment",
          name: "MY_GITHUB_TOKEN",
        },
      },
      environment: { MY_GITHUB_TOKEN: secret },
    });
    const proposed = plan.config.proposed as {
      mcpServers?: Record<string, { env: Record<string, string> }>;
    };
    expect(proposed.mcpServers?.github.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe(
      "${MY_GITHUB_TOKEN}",
    );
    expect(JSON.stringify(plan)).not.toContain(secret);
  });

  it("requires explicit risk approval before resolving or launching", async () => {
    const subprocessFactory = vi.fn();
    const resolveCredential = vi.fn();
    await expect(
      verifyMcpRecipeConnection("github-readonly", {
        approveRisk: false,
        subprocessFactory,
        resolveCredential,
      }),
    ).rejects.toThrow(/explicit approveRisk/);
    expect(resolveCredential).not.toHaveBeenCalled();
    expect(subprocessFactory).not.toHaveBeenCalled();
  });

  it("launches the exact reviewed artifact and completes a JSON-RPC initialize handshake", async () => {
    const fake = new FakeMcpProcess();
    fake.onWrite = (value) => {
      const request = JSON.parse(value) as { method: string; id?: string };
      if (request.method !== "initialize") return;
      queueMicrotask(() =>
        fake.stdout.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              serverInfo: { name: "github-mcp", version: "1.2.3" },
            },
          })}\n`,
        ),
      );
    };
    let launched:
      | {
          command: string;
          args: readonly string[];
          env: Record<string, string>;
        }
      | undefined;
    const subprocessFactory: McpSubprocessFactory = (
      command,
      args,
      options,
    ) => {
      launched = { command, args, env: options.env };
      return fake.asProcess();
    };
    const reference = {
      kind: "os-keychain" as const,
      service: "loadout.github",
      account: "viraj",
    };
    const resolveCredential = vi.fn(async () => "ephemeral-token");
    const result = await verifyMcpRecipeConnection("github-readonly", {
      approveRisk: true,
      credentialReferences: { GITHUB_PERSONAL_ACCESS_TOKEN: reference },
      resolveCredential,
      subprocessFactory,
    });

    expect(resolveCredential).toHaveBeenCalledWith(reference);
    expect(launched?.command).toBe("docker");
    expect(launched?.args).toContain(
      "ghcr.io/github/github-mcp-server@sha256:7b1384cdd6d025c09256af2fb6cb79bc5e87aedc957c8826b5e50d8cb82f0be3",
    );
    expect(launched?.args).not.toContain("ephemeral-token");
    expect(launched?.env.GITHUB_READ_ONLY).toBe("1");
    expect(launched?.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("ephemeral-token");
    expect(result).toMatchObject({
      recipeId: "github-readonly",
      connected: true,
      protocolVersion: "2025-06-18",
      serverInfo: { name: "github-mcp", version: "1.2.3" },
    });
    expect(JSON.stringify(result)).not.toContain("ephemeral-token");
    expect(fake.written).toContain('"method":"initialize"');
    expect(fake.written).toContain('"method":"notifications/initialized"');
    expect(fake.killCount).toBe(1);
  });

  it("kills the subprocess on protocol errors, output limits, and abort", async () => {
    const invalid = new FakeMcpProcess();
    invalid.onWrite = () =>
      queueMicrotask(() => invalid.stdout.write("not-json\n"));
    await expect(
      verifyMcpRecipeConnection("playwright", {
        approveRisk: true,
        subprocessFactory: () => invalid.asProcess(),
      }),
    ).rejects.toThrow(/invalid JSON-RPC/);
    expect(invalid.killCount).toBe(1);

    const noisy = new FakeMcpProcess();
    noisy.onWrite = () =>
      queueMicrotask(() => noisy.stderr.write("x".repeat(4_097)));
    await expect(
      verifyMcpRecipeConnection("playwright", {
        approveRisk: true,
        maxOutputBytes: 4_096,
        subprocessFactory: () => noisy.asProcess(),
      }),
    ).rejects.toThrow(/output limit/);
    expect(noisy.killCount).toBe(1);

    const controller = new AbortController();
    const aborted = new FakeMcpProcess();
    aborted.onWrite = () => queueMicrotask(() => controller.abort());
    await expect(
      verifyMcpRecipeConnection("playwright", {
        approveRisk: true,
        signal: controller.signal,
        subprocessFactory: () => aborted.asProcess(),
      }),
    ).rejects.toThrow(/aborted/);
    expect(aborted.killCount).toBe(1);
  });

  it("bounds a silent connection attempt with a timeout and cleanup", async () => {
    const silent = new FakeMcpProcess();
    await expect(
      verifyMcpRecipeConnection("playwright", {
        approveRisk: true,
        timeoutMs: 250,
        subprocessFactory: () => silent.asProcess(),
      }),
    ).rejects.toThrow(/timed out/);
    expect(silent.killCount).toBe(1);
  });

  it("redacts credential resolver and subprocess failures", async () => {
    const secret = "never-print-this-token";
    let resolverMessage = "";
    try {
      await verifyMcpRecipeConnection("github-readonly", {
        approveRisk: true,
        resolveCredential: async () => {
          throw new Error(secret);
        },
      });
    } catch (error) {
      resolverMessage = error instanceof Error ? error.message : String(error);
    }
    expect(resolverMessage).not.toContain(secret);
    expect(resolverMessage).toMatch(/could not be resolved/);

    let spawnMessage = "";
    try {
      await verifyMcpRecipeConnection("github-readonly", {
        approveRisk: true,
        resolveCredential: async () => secret,
        subprocessFactory: () => {
          throw new Error(secret);
        },
      });
    } catch (error) {
      spawnMessage = error instanceof Error ? error.message : String(error);
    }
    expect(spawnMessage).not.toContain(secret);
    expect(spawnMessage).toMatch(/could not be started/);
  });
});
