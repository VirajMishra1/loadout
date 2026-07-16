import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import type {
  CredentialReference,
  McpConfigPlan,
  McpServer,
} from "../shared/types.js";
import { createCredentialResolver } from "./credentials.js";
import { planMcpConfig } from "./mcp.js";

export interface McpSetupRecipe {
  id: string;
  displayName: string;
  source: string;
  serverName: string;
  command: string;
  args: string[];
  /** Credential names only. Values remain outside Loadout. */
  environment: string[];
  /** Reviewed non-secret values that may be persisted in host config. */
  fixedEnvironment: Record<string, string>;
  permissions: string[];
  connection: "stdio";
  /** Immutable upstream source revision reviewed for this recipe. */
  reviewedCommit: string;
  reviewedAt: string;
  /** Exact executable artifact identity; tags such as `latest` are forbidden. */
  artifact: string;
}

export interface McpRecipePlan {
  recipe: McpSetupRecipe;
  config: McpConfigPlan;
  authorization: string[];
  safety: string[];
}

export interface McpRecipeVerification {
  recipeId: string;
  configPath: string;
  configured: boolean;
  checks: string[];
  warnings: string[];
}

export interface McpVerificationProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  once(event: "error", listener: () => void): this;
  once(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  removeListener(event: "error", listener: () => void): this;
  removeListener(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface McpSubprocessOptions {
  env: Record<string, string>;
}

export type McpSubprocessFactory = (
  command: string,
  args: readonly string[],
  options: McpSubprocessOptions,
) => McpVerificationProcess;

export interface McpConnectionVerificationOptions {
  approveRisk: boolean;
  credentialReferences?: Readonly<Record<string, CredentialReference>>;
  resolveCredential?: (
    reference: CredentialReference,
  ) => Promise<string | undefined>;
  subprocessFactory?: McpSubprocessFactory;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

export interface McpConnectionVerification {
  recipeId: string;
  connected: true;
  protocolVersion: string;
  serverInfo?: { name: string; version?: string };
  checks: string[];
}

/**
 * Small, source-linked recipes. These configure a connection only; authorizing
 * a service remains an explicit user action outside Loadout.
 */
export const REVIEWED_MCP_RECIPES: McpSetupRecipe[] = [
  {
    id: "playwright",
    displayName: "Playwright MCP",
    source:
      "https://github.com/microsoft/playwright-mcp/tree/5f8fc00210b27b4407c375b59cda4838045d429c",
    serverName: "playwright",
    command: "npx",
    args: ["-y", "@playwright/mcp@0.0.78"],
    environment: [],
    fixedEnvironment: {},
    permissions: [
      "browser automation",
      "local browser profile as configured by the user",
    ],
    connection: "stdio",
    reviewedCommit: "5f8fc00210b27b4407c375b59cda4838045d429c",
    reviewedAt: "2026-07-16T00:00:00Z",
    artifact:
      "npm:@playwright/mcp@0.0.78#sha512-XLTUeA6mEN9sQ+hJ4dfG8EIkDbxS0K3Trc2RBkUJuf02TgE2FQRNTMtq/aJfhyRMINsRl/Ybc4sxcWLtFn4/TQ==",
  },
  {
    id: "github-readonly",
    displayName: "GitHub MCP Server (read-only)",
    source:
      "https://github.com/github/github-mcp-server/tree/dc3ee11f4c1c9541a2e918acfc7e20c8332c9a36",
    serverName: "github",
    command: "docker",
    args: [
      "run",
      "-i",
      "--rm",
      "-e",
      "GITHUB_PERSONAL_ACCESS_TOKEN",
      "-e",
      "GITHUB_READ_ONLY=1",
      "ghcr.io/github/github-mcp-server@sha256:7b1384cdd6d025c09256af2fb6cb79bc5e87aedc957c8826b5e50d8cb82f0be3",
    ],
    environment: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    fixedEnvironment: { GITHUB_READ_ONLY: "1" },
    permissions: ["read GitHub repositories, issues, pull requests, and users"],
    connection: "stdio",
    reviewedCommit: "dc3ee11f4c1c9541a2e918acfc7e20c8332c9a36",
    reviewedAt: "2026-07-16T00:00:00Z",
    artifact:
      "oci:ghcr.io/github/github-mcp-server@sha256:7b1384cdd6d025c09256af2fb6cb79bc5e87aedc957c8826b5e50d8cb82f0be3",
  },
];

export function findMcpRecipe(id: string): McpSetupRecipe {
  const recipe = REVIEWED_MCP_RECIPES.find((item) => item.id === id);
  if (!recipe) {
    throw new Error(
      `Unknown MCP recipe '${id}'. Available: ${REVIEWED_MCP_RECIPES.map((item) => item.id).join(", ")}`,
    );
  }
  return recipe;
}

function recipeServer(recipe: McpSetupRecipe, sourcePath: string): McpServer {
  return {
    name: recipe.serverName,
    command: recipe.command,
    args: recipe.args,
    // References retain variable names without storing or printing their values.
    env: Object.fromEntries([
      ...recipe.environment.map((name) => [name, `\${${name}}`] as const),
      ...Object.entries(recipe.fixedEnvironment),
    ]),
    sourcePath,
    warnings: [],
  };
}

export async function planMcpRecipe(
  recipeId: string,
  configPath: string,
): Promise<McpRecipePlan> {
  const recipe = findMcpRecipe(recipeId);
  const config = await planMcpConfig(
    configPath,
    recipeServer(recipe, recipe.source),
  );
  return {
    recipe,
    config,
    authorization: recipe.environment.length
      ? [
          `Set these environment variables outside Loadout before starting the host: ${recipe.environment.join(", ")}.`,
        ]
      : ["No credential reference is required by this recipe."],
    safety: [
      "Only the displayed server entry will be added or replaced; unrelated JSON keys are preserved.",
      "Loadout does not start the server, fetch packages, or authorize the service during recipe setup.",
    ],
  };
}

const MCP_PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_CONNECTION_TIMEOUT_MS = 8_000;
const DEFAULT_CONNECTION_OUTPUT_BYTES = 256 * 1024;
const INITIALIZE_ID = "loadout-initialize";

function validateConnectionBounds(timeoutMs: number, maxOutputBytes: number) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 30_000)
    throw new Error("MCP verification timeout must be 250-30000ms");
  if (
    !Number.isInteger(maxOutputBytes) ||
    maxOutputBytes < 4_096 ||
    maxOutputBytes > 1024 * 1024
  )
    throw new Error("MCP verification output limit must be 4096-1048576 bytes");
}

function assertExactReviewedArtifact(recipe: McpSetupRecipe) {
  if (
    !/^[a-f0-9]{40}$/.test(recipe.reviewedCommit) ||
    !recipe.source.includes(recipe.reviewedCommit) ||
    /@latest|:latest/.test(JSON.stringify(recipe))
  )
    throw new Error("MCP recipe does not have an immutable reviewed source");
  if (recipe.artifact.startsWith("oci:")) {
    const pinnedImage = recipe.artifact.slice("oci:".length);
    if (
      !/@sha256:[a-f0-9]{64}$/.test(pinnedImage) ||
      !recipe.args.includes(pinnedImage)
    )
      throw new Error(
        "MCP recipe executable does not match its reviewed OCI digest",
      );
    return;
  }
  const npmArtifact = /^npm:(.+@[^#]+)#sha512-[A-Za-z0-9+/=]+$/.exec(
    recipe.artifact,
  );
  if (!npmArtifact || !recipe.args.includes(npmArtifact[1]))
    throw new Error(
      "MCP recipe executable does not match its reviewed npm artifact",
    );
}

function runtimeEnvironment(): Record<string, string> {
  const allowed = [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SystemRoot",
    "WINDIR",
    "TMPDIR",
    "TMP",
    "TEMP",
  ] as const;
  return Object.fromEntries(
    allowed.flatMap((name) =>
      process.env[name] === undefined ? [] : [[name, process.env[name]!]],
    ),
  );
}

const defaultMcpSubprocessFactory: McpSubprocessFactory = (
  command,
  args,
  options,
) =>
  spawn(command, [...args], {
    env: options.env,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

function safeServerText(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    ? value
    : undefined;
}

/**
 * Explicitly launch one canonical reviewed server and perform only the MCP
 * initialize handshake. Secrets are resolved just-in-time, injected only into
 * the child environment, and never included in results or failure messages.
 */
export async function verifyMcpRecipeConnection(
  recipeId: string,
  options: McpConnectionVerificationOptions,
): Promise<McpConnectionVerification> {
  if (!options.approveRisk)
    throw new Error("Real MCP verification requires explicit approveRisk");
  if (options.signal?.aborted) throw new Error("MCP verification was aborted");
  const recipe = findMcpRecipe(recipeId);
  assertExactReviewedArtifact(recipe);
  const timeoutMs = options.timeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS;
  const maxOutputBytes =
    options.maxOutputBytes ?? DEFAULT_CONNECTION_OUTPUT_BYTES;
  validateConnectionBounds(timeoutMs, maxOutputBytes);

  const resolveCredential =
    options.resolveCredential ?? createCredentialResolver();
  const credentialEnvironment: Record<string, string> = {};
  try {
    for (const name of recipe.environment) {
      const reference = options.credentialReferences?.[name] ?? {
        kind: "environment" as const,
        name,
      };
      const value = await resolveCredential(reference);
      if (!value) throw new Error("missing");
      credentialEnvironment[name] = value;
    }
  } catch {
    throw new Error("An MCP credential reference could not be resolved");
  }
  if (options.signal?.aborted) throw new Error("MCP verification was aborted");

  const env = {
    ...runtimeEnvironment(),
    ...recipe.fixedEnvironment,
    ...credentialEnvironment,
  };
  let child: McpVerificationProcess;
  try {
    child = (options.subprocessFactory ?? defaultMcpSubprocessFactory)(
      recipe.command,
      recipe.args,
      { env },
    );
  } catch {
    throw new Error("The reviewed MCP server could not be started");
  }

  return new Promise<McpConnectionVerification>((resolvePromise, reject) => {
    let settled = false;
    let stdout = "";
    let outputBytes = 0;
    const onAbort = () => rejectSafely("MCP verification was aborted");
    const onError = () =>
      rejectSafely("The reviewed MCP server failed during verification");
    const onClose = () =>
      rejectSafely("The reviewed MCP server exited before initialization");
    const onStdinError = () =>
      rejectSafely("The MCP initialize request could not be sent");
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      child.stdout.removeListener("data", onStdout);
      child.stderr.removeListener("data", onStderr);
      child.stdin.removeListener("error", onStdinError);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
      try {
        child.stdin.end();
      } catch {
        // Already closed.
      }
      try {
        child.kill("SIGTERM");
      } catch {
        // Never forward a backend exception that may contain environment data.
      }
    };
    function rejectSafely(message: string) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    }
    const finish = (result: McpConnectionVerification) => {
      if (settled) return;
      settled = true;
      try {
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
        );
      } catch {
        // The initialize response is authoritative; cleanup remains mandatory.
      }
      cleanup();
      resolvePromise(result);
    };
    const onStderr = (chunk: Buffer | string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > maxOutputBytes)
        rejectSafely("MCP verification exceeded its output limit");
    };
    const onStdout = (chunk: Buffer | string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > maxOutputBytes) {
        rejectSafely("MCP verification exceeded its output limit");
        return;
      }
      stdout += chunk.toString();
      for (;;) {
        const newline = stdout.indexOf("\n");
        if (newline === -1) return;
        const line = stdout.slice(0, newline).replace(/\r$/, "");
        stdout = stdout.slice(newline + 1);
        if (!line) continue;
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          rejectSafely("The MCP server returned an invalid JSON-RPC response");
          return;
        }
        if (!message || typeof message !== "object") continue;
        const record = message as Record<string, unknown>;
        if (record.id !== INITIALIZE_ID) continue;
        if (record.jsonrpc !== "2.0" || record.error || !record.result) {
          rejectSafely("The MCP server rejected initialization");
          return;
        }
        const result = record.result as Record<string, unknown>;
        const protocolVersion = safeServerText(result.protocolVersion);
        if (!protocolVersion) {
          rejectSafely(
            "The MCP initialize result omitted its protocol version",
          );
          return;
        }
        const server =
          result.serverInfo && typeof result.serverInfo === "object"
            ? (result.serverInfo as Record<string, unknown>)
            : undefined;
        const name = safeServerText(server?.name);
        const version = safeServerText(server?.version);
        finish({
          recipeId: recipe.id,
          connected: true,
          protocolVersion,
          ...(name
            ? { serverInfo: { name, ...(version ? { version } : {}) } }
            : {}),
          checks: [
            "launched exact reviewed artifact",
            "received valid JSON-RPC initialize result",
            "stopped verification subprocess",
          ],
        });
        return;
      }
    };
    const timer = setTimeout(
      () => rejectSafely("MCP verification timed out"),
      timeoutMs,
    );
    timer.unref();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.stdin.on("error", onStdinError);
    child.once("error", onError);
    child.once("close", onClose);
    if (options.signal?.aborted) {
      rejectSafely("MCP verification was aborted");
      return;
    }
    try {
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: INITIALIZE_ID,
          method: "initialize",
          params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "loadout", version: "0.1.0" },
          },
        })}\n`,
      );
    } catch {
      rejectSafely("The MCP initialize request could not be sent");
    }
  });
}

/** Verify the configured transport and references without launching a server. */
export async function verifyMcpRecipe(
  recipeId: string,
  configPath: string,
): Promise<McpRecipeVerification> {
  const recipe = findMcpRecipe(recipeId);
  const path = resolve(configPath);
  const checks: string[] = [];
  const warnings: string[] = [];
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    return {
      recipeId,
      configPath: path,
      configured: false,
      checks,
      warnings: [
        `Cannot read JSON MCP config: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  const server =
    value && typeof value === "object"
      ? (value as { mcpServers?: Record<string, unknown> }).mcpServers?.[
          recipe.serverName
        ]
      : undefined;
  if (!server || typeof server !== "object" || Array.isArray(server)) {
    warnings.push(`Server '${recipe.serverName}' is not configured.`);
  } else {
    const record = server as Record<string, unknown>;
    if (record.command === recipe.command)
      checks.push("command matches recipe");
    else warnings.push("configured command does not match recipe");
    if (
      Array.isArray(record.args) &&
      JSON.stringify(record.args) === JSON.stringify(recipe.args)
    )
      checks.push("arguments match recipe");
    else warnings.push("configured arguments do not match recipe");
    const env = record.env as Record<string, unknown> | undefined;
    for (const name of recipe.environment) {
      if (typeof env?.[name] === "string")
        checks.push(`environment reference present: ${name}`);
      else warnings.push(`missing environment reference: ${name}`);
    }
    for (const [name, expected] of Object.entries(recipe.fixedEnvironment)) {
      if (env?.[name] === expected)
        checks.push(`fixed environment matches recipe: ${name}`);
      else warnings.push(`fixed environment does not match recipe: ${name}`);
    }
  }
  return {
    recipeId,
    configPath: path,
    configured: warnings.length === 0,
    checks,
    warnings: [
      ...warnings,
      "Configuration verification does not launch the MCP server. Start it from the target host after completing authorization.",
    ],
  };
}

export function formatMcpRecipePlan(plan: McpRecipePlan): string {
  return [
    `${plan.recipe.displayName} (${plan.recipe.id})`,
    `Source: ${plan.recipe.source}`,
    `Reviewed artifact: ${plan.recipe.artifact}`,
    `Reviewed at: ${plan.recipe.reviewedAt}`,
    `Connection: ${plan.recipe.command} ${plan.recipe.args.join(" ")}`,
    `Permissions: ${plan.recipe.permissions.join("; ")}`,
    `Environment names: ${plan.recipe.environment.length ? plan.recipe.environment.join(", ") : "none"}`,
    `Fixed non-secret environment: ${
      Object.keys(plan.recipe.fixedEnvironment).length
        ? Object.entries(plan.recipe.fixedEnvironment)
            .map(([name, value]) => `${name}=${value}`)
            .join(", ")
        : "none"
    }`,
    `Target config: ${plan.config.path}`,
    ...plan.authorization,
    ...plan.safety,
  ].join("\n");
}
