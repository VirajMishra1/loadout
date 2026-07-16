import { execFile } from "node:child_process";
import { access, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentId, DetectedAgent, Snapshot } from "../shared/types.js";
import { writeFileAtomically } from "./atomic-file.js";
import { detectAgents, loadoutHome, userHome } from "./paths.js";
import { createSnapshot, readSnapshot, restoreSnapshot } from "./snapshot.js";

const execFileAsync = promisify(execFile);

export interface RuntimeToolRecipe {
  id: string;
  displayName: string;
  version: string;
  source: string;
  reviewedCommit: string;
  artifactUrl: string;
  artifactSha256: string;
  excludeNewer: string;
  license: string;
  permissions: string[];
}

export interface RuntimeToolCommand {
  command: string;
  args: string[];
  purpose: string;
}

export interface RuntimeToolPlan {
  action: "install" | "remove";
  recipe: RuntimeToolRecipe;
  agents: Array<{ id: AgentId; displayName: string; target: string }>;
  unsupportedDetectedAgents: AgentId[];
  userHome: string;
  stateHome: string;
  runtimeRoot: string;
  commands: RuntimeToolCommand[];
  guarantees: string[];
}

interface RuntimeToolState {
  schemaVersion: 1;
  tools: Record<
    string,
    {
      version: string;
      installedAt: string;
      snapshotId: string;
      agents: AgentId[];
      runtimeRoot: string;
    }
  >;
}

export type RuntimeToolRunner = (
  command: string,
  args: readonly string[],
  options: { env: Record<string, string>; timeoutMs: number },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export const GRAPHIFY_RECIPE: RuntimeToolRecipe = {
  id: "graphify",
  displayName: "Graphify",
  version: "0.9.17",
  source:
    "https://github.com/Graphify-Labs/graphify/tree/ecf1416a7e0ef3a2273a2ad9c796c4e573ca8037",
  reviewedCommit: "ecf1416a7e0ef3a2273a2ad9c796c4e573ca8037",
  artifactUrl:
    "https://files.pythonhosted.org/packages/39/37/a28af8342d78d322511b6307fac2760ca7b9b3c859fa2dcfbaf7c4b5ddf9/graphifyy-0.9.17-py3-none-any.whl",
  artifactSha256:
    "ef60768aaee7e315d2e2d7da89e971bc1f445f5c8d73ebe4fed550e40a1d687e",
  excludeNewer: "2026-07-17T00:00:00Z",
  license: "MIT",
  permissions: [
    "install an isolated Python tool below Loadout state",
    "write the generated Graphify skill for explicitly selected agents",
    "read project files only when the user later invokes Graphify",
  ],
};

export const REVIEWED_RUNTIME_TOOLS = [GRAPHIFY_RECIPE] as const;

const graphifyAgentArgs: Partial<Record<AgentId, string[]>> = {
  "claude-code": ["install"],
  codex: ["install", "--platform", "codex"],
  cursor: ["cursor", "install"],
  "gemini-cli": ["install", "--platform", "gemini"],
  opencode: ["install", "--platform", "opencode"],
  hermes: ["install", "--platform", "hermes"],
  "github-copilot": ["install", "--platform", "copilot"],
  "kiro-cli": ["kiro", "install"],
};

const graphifyAgentDirectory: Partial<Record<AgentId, string[]>> = {
  "claude-code": [".claude", "skills", "graphify"],
  codex: [".codex", "skills", "graphify"],
  cursor: [".cursor", "skills", "graphify"],
  "gemini-cli": [".gemini", "skills", "graphify"],
  opencode: [".config", "opencode", "skills", "graphify"],
  hermes: [".hermes", "skills", "graphify"],
  "github-copilot": [".copilot", "skills", "graphify"],
  "kiro-cli": [".kiro", "skills", "graphify"],
};

function statePath(stateHome = loadoutHome()): string {
  return join(stateHome, "runtime-tools.json");
}

function emptyState(): RuntimeToolState {
  return { schemaVersion: 1, tools: {} };
}

async function readState(stateHome?: string): Promise<RuntimeToolState> {
  try {
    const value = JSON.parse(
      await readFile(statePath(stateHome), "utf8"),
    ) as unknown;
    if (
      !value ||
      typeof value !== "object" ||
      (value as { schemaVersion?: unknown }).schemaVersion !== 1 ||
      !(value as { tools?: unknown }).tools ||
      typeof (value as { tools?: unknown }).tools !== "object"
    )
      throw new Error("Runtime tool state is invalid");
    return value as RuntimeToolState;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    )
      return emptyState();
    throw error;
  }
}

async function writeState(
  state: RuntimeToolState,
  stateHome?: string,
): Promise<void> {
  await writeFileAtomically(
    statePath(stateHome),
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

export function findRuntimeToolRecipe(id: string): RuntimeToolRecipe {
  const recipe = REVIEWED_RUNTIME_TOOLS.find((item) => item.id === id);
  if (!recipe)
    throw new Error(
      `Unknown runtime tool '${id}'. Available: ${REVIEWED_RUNTIME_TOOLS.map((item) => item.id).join(", ")}`,
    );
  return recipe;
}

function graphifyRequirement(recipe: RuntimeToolRecipe): string {
  return `graphifyy @ ${recipe.artifactUrl}#sha256=${recipe.artifactSha256}`;
}

function graphifyBinary(runtimeRoot: string): string {
  return join(
    runtimeRoot,
    "bin",
    process.platform === "win32" ? "graphify.exe" : "graphify",
  );
}

export async function planRuntimeTool(
  id: string,
  options: {
    action?: "install" | "remove";
    requestedAgents?: AgentId[];
    detectedAgents?: DetectedAgent[];
    home?: string;
    stateHome?: string;
  } = {},
): Promise<RuntimeToolPlan> {
  const recipe = findRuntimeToolRecipe(id);
  const action = options.action ?? "install";
  const home = options.home ?? userHome();
  const stateHome = options.stateHome ?? loadoutHome();
  const runtimeRoot = join(stateHome, "runtime", recipe.id);
  const state = await readState(stateHome);
  const existing = state.tools[id];
  if (action === "install" && existing)
    throw new Error(
      `${recipe.displayName} is already managed by Loadout at ${existing.version}; remove it before reinstalling`,
    );
  if (action === "remove" && !existing)
    throw new Error(`${recipe.displayName} is not managed by Loadout`);

  const detected = options.detectedAgents ?? (await detectAgents());
  const requested = new Set(
    action === "remove"
      ? existing!.agents
      : (options.requestedAgents ??
          detected.filter((agent) => agent.installed).map((agent) => agent.id)),
  );
  const knownDetected = new Map(detected.map((agent) => [agent.id, agent]));
  const missing = [...requested].filter(
    (agent) => action === "install" && !knownDetected.get(agent)?.installed,
  );
  if (missing.length)
    throw new Error(
      `Requested agent(s) are not detected: ${missing.join(", ")}`,
    );
  const supported = [...requested].filter(
    (agent) => graphifyAgentArgs[agent] && graphifyAgentDirectory[agent],
  );
  if (!supported.length)
    throw new Error(
      "No detected selected agent has a reviewed Graphify registration recipe",
    );
  const agents = supported.map((id) => ({
    id,
    displayName: knownDetected.get(id)?.displayName ?? id,
    target: join(home, ...graphifyAgentDirectory[id]!),
  }));
  const binary = graphifyBinary(runtimeRoot);
  const commands: RuntimeToolCommand[] =
    action === "remove"
      ? []
      : [
          {
            command: "uv",
            args: [
              "tool",
              "install",
              graphifyRequirement(recipe),
              "--exclude-newer",
              recipe.excludeNewer,
            ],
            purpose:
              "install the exact hashed Graphify wheel in isolated Loadout state",
          },
          ...agents.map((agent) => ({
            command: binary,
            args: graphifyAgentArgs[agent.id]!,
            purpose: `generate the official ${agent.displayName} Graphify skill`,
          })),
          {
            command: binary,
            args: ["--version"],
            purpose: `verify Graphify ${recipe.version}`,
          },
        ];
  return {
    action,
    recipe,
    agents,
    unsupportedDetectedAgents: [...requested].filter(
      (agent) => !supported.includes(agent),
    ),
    userHome: home,
    stateHome,
    runtimeRoot,
    commands,
    guarantees: [
      "dry-run unless --yes and --approve-risk are both supplied",
      "exact top-level wheel URL and SHA-256; dependency uploads bounded by the reviewed cutoff",
      "no API keys or provider credentials inherited by installer subprocesses",
      "agent skill targets and isolated runtime are snapshotted for rollback/removal",
      "generated runtime lookup is rewritten to the same pinned Graphify artifact",
    ],
  };
}

function runtimeEnvironment(plan: RuntimeToolPlan): Record<string, string> {
  const allowed = [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "TMPDIR",
    "TMP",
    "TEMP",
  ] as const;
  return {
    ...Object.fromEntries(
      allowed.flatMap((name) =>
        process.env[name] === undefined ? [] : [[name, process.env[name]!]],
      ),
    ),
    HOME: plan.userHome,
    USERPROFILE: plan.userHome,
    UV_TOOL_DIR: join(plan.runtimeRoot, "uv"),
    UV_TOOL_BIN_DIR: join(plan.runtimeRoot, "bin"),
    UV_CACHE_DIR: join(plan.runtimeRoot, "cache"),
  };
}

const defaultRunner: RuntimeToolRunner = async (command, args, options) => {
  try {
    const result = await execFileAsync(command, [...args], {
      env: options.env,
      timeout: options.timeoutMs,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const result = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
    };
    if (result.killed) throw new Error("Runtime tool command timed out");
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: typeof result.code === "number" ? result.code : 1,
    };
  }
};

async function pinGeneratedGraphifySkill(
  directory: string,
  recipe: RuntimeToolRecipe,
): Promise<void> {
  const pinned = `'${graphifyRequirement(recipe)}'`;
  async function visit(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const absolute = join(path, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("Generated Graphify skill contains a symlink");
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const before = await readFile(absolute, "utf8");
      const after = before.replaceAll("--from graphifyy", `--from ${pinned}`);
      if (after !== before) await writeFileAtomically(absolute, after);
      if (after.includes("--from graphifyy"))
        throw new Error(
          "Generated Graphify skill retained an unpinned runtime lookup",
        );
    }
  }
  await visit(directory);
}

export async function applyRuntimeToolPlan(
  plan: RuntimeToolPlan,
  options: {
    approveRisk: boolean;
    runner?: RuntimeToolRunner;
    timeoutMs?: number;
  },
): Promise<{ action: "install" | "remove"; snapshotId: string }> {
  if (!options.approveRisk)
    throw new Error(
      "Runtime tool installation requires explicit --approve-risk",
    );
  const state = await readState(plan.stateHome);
  if (plan.action === "remove") {
    const installed = state.tools[plan.recipe.id];
    if (!installed)
      throw new Error(`${plan.recipe.displayName} is not managed by Loadout`);
    const snapshot = await readSnapshot(installed.snapshotId);
    await restoreSnapshot(snapshot);
    delete state.tools[plan.recipe.id];
    await writeState(state, plan.stateHome);
    return { action: "remove", snapshotId: snapshot.id };
  }
  if (state.tools[plan.recipe.id])
    throw new Error(`${plan.recipe.displayName} is already managed by Loadout`);

  let snapshot: Snapshot | undefined;
  try {
    snapshot = await createSnapshot([
      plan.runtimeRoot,
      ...plan.agents.map((agent) => agent.target),
    ]);
    const runner = options.runner ?? defaultRunner;
    const env = runtimeEnvironment(plan);
    for (const item of plan.commands) {
      const result = await runner(item.command, item.args, {
        env,
        timeoutMs: options.timeoutMs ?? 300_000,
      });
      if (result.exitCode !== 0)
        throw new Error(
          `${item.purpose} failed${result.stderr.trim() ? `: ${result.stderr.trim().slice(0, 500)}` : ""}`,
        );
      if (
        item.purpose.startsWith("verify") &&
        !result.stdout.includes(plan.recipe.version)
      )
        throw new Error(
          `Installed ${plan.recipe.displayName} version did not match ${plan.recipe.version}`,
        );
    }
    for (const agent of plan.agents) {
      await access(join(agent.target, "SKILL.md"));
      await pinGeneratedGraphifySkill(agent.target, plan.recipe);
    }
    state.tools[plan.recipe.id] = {
      version: plan.recipe.version,
      installedAt: new Date().toISOString(),
      snapshotId: snapshot.id,
      agents: plan.agents.map((agent) => agent.id),
      runtimeRoot: plan.runtimeRoot,
    };
    await writeState(state, plan.stateHome);
    return { action: "install", snapshotId: snapshot.id };
  } catch (error) {
    if (snapshot) await restoreSnapshot(snapshot).catch(() => undefined);
    else await rm(plan.runtimeRoot, { recursive: true, force: true });
    throw error;
  }
}

export function formatRuntimeToolPlan(plan: RuntimeToolPlan): string {
  return [
    `${plan.recipe.displayName} ${plan.recipe.version} — ${plan.action}`,
    `Source: ${plan.recipe.source}`,
    `Artifact SHA-256: ${plan.recipe.artifactSha256}`,
    `Targets: ${plan.agents.map((agent) => `${agent.displayName} (${agent.target})`).join(", ")}`,
    ...(plan.unsupportedDetectedAgents.length
      ? [
          `Not registered (no reviewed adapter): ${plan.unsupportedDetectedAgents.join(", ")}`,
        ]
      : []),
    ...(plan.commands.length
      ? plan.commands.map(
          (item, index) =>
            `${index + 1}. ${item.purpose}: ${item.command} ${item.args.join(" ")}`,
        )
      : [
          "Restore the pre-install snapshot and remove isolated runtime state.",
        ]),
    ...plan.guarantees.map((guarantee) => `Safety: ${guarantee}`),
  ].join("\n");
}
