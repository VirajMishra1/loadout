import { execFile } from "node:child_process";
import { access, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentId, DetectedAgent, Snapshot } from "../shared/types.js";
import { writeFileAtomically } from "./atomic-file.js";
import { detectAgents, loadoutHome, userHome } from "./paths.js";
import {
  parseRuntimeToolRecipe,
  renderRuntimeRecipeValue,
  resolveRuntimeRecipePath,
  type RuntimeRecipePlatform,
  type RuntimeToolRecipe,
} from "./runtime-tool-recipe.js";
import { createSnapshot, readSnapshot, restoreSnapshot } from "./snapshot.js";

export type { RuntimeToolRecipe } from "./runtime-tool-recipe.js";

const execFileAsync = promisify(execFile);

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

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const GRAPHIFY_RECIPE: RuntimeToolRecipe = deepFreeze(
  parseRuntimeToolRecipe({
    schemaVersion: 1,
    kind: "loadout.reviewed-runtime-recipe",
    id: "graphify",
    displayName: "Graphify",
    version: "0.9.17",
    source:
      "https://github.com/Graphify-Labs/graphify/tree/ecf1416a7e0ef3a2273a2ad9c796c4e573ca8037",
    sourceRepository: "https://github.com/Graphify-Labs/graphify",
    reviewedCommit: "ecf1416a7e0ef3a2273a2ad9c796c4e573ca8037",
    artifactUrl:
      "https://files.pythonhosted.org/packages/39/37/a28af8342d78d322511b6307fac2760ca7b9b3c859fa2dcfbaf7c4b5ddf9/graphifyy-0.9.17-py3-none-any.whl",
    artifactSha256:
      "ef60768aaee7e315d2e2d7da89e971bc1f445f5c8d73ebe4fed550e40a1d687e",
    artifacts: [
      {
        id: "graphify-wheel",
        kind: "python-wheel",
        packageName: "graphifyy",
        url: "https://files.pythonhosted.org/packages/39/37/a28af8342d78d322511b6307fac2760ca7b9b3c859fa2dcfbaf7c4b5ddf9/graphifyy-0.9.17-py3-none-any.whl",
        sha256:
          "ef60768aaee7e315d2e2d7da89e971bc1f445f5c8d73ebe4fed550e40a1d687e",
      },
    ],
    excludeNewer: "2026-07-17T00:00:00Z",
    license: "MIT",
    trust: {
      reviewType: "manual-source-and-artifact-review",
      reviewedAt: "2026-07-16T00:00:00Z",
      reviewer: "Loadout maintainers",
      provenance: "direct-upstream-and-package-index",
    },
    dependencies: {
      resolution: "cutoff-bounded",
      excludeNewer: "2026-07-17T00:00:00Z",
      hostTools: [
        {
          executable: "uv",
          versionPolicy: "unversioned-host-dependency",
          purpose: "create and manage the isolated Python tool environment",
        },
      ],
      disclosure:
        "The top-level wheel is SHA-256 pinned; transitive Python dependencies are resolved by uv no newer than the reviewed cutoff and are not fully locked. The host uv version is not pinned.",
    },
    permissions: [
      "install an isolated Python tool below Loadout state",
      "write the generated Graphify skill for explicitly selected agents",
      "read project files only when the user later invokes Graphify",
    ],
    operatingSystems: ["darwin", "linux", "win32"],
    environment: {
      inherit: ["PATH", "SystemRoot", "WINDIR", "TMPDIR", "TMP", "TEMP"],
      fixed: {
        HOME: { root: "userHome", path: [] },
        USERPROFILE: { root: "userHome", path: [] },
        UV_TOOL_DIR: { root: "runtimeRoot", path: ["uv"] },
        UV_TOOL_BIN_DIR: { root: "runtimeRoot", path: ["bin"] },
        UV_CACHE_DIR: { root: "runtimeRoot", path: ["cache"] },
      },
    },
    runtime: {
      root: ["runtime", "{recipeId}"],
      binaryPaths: {
        darwin: ["bin", "graphify"],
        linux: ["bin", "graphify"],
        win32: ["bin", "graphify.exe"],
      },
    },
    commands: {
      install: [
        {
          executable: "uv",
          args: [
            "tool",
            "install",
            "{artifactRequirement}",
            "--exclude-newer",
            "2026-07-17T00:00:00Z",
          ],
          purpose:
            "install the exact hashed Graphify wheel in isolated Loadout state",
        },
      ],
      register: {
        "claude-code": {
          args: ["install"],
          purpose: "generate the official {agentDisplayName} Graphify skill",
        },
        codex: {
          args: ["install", "--platform", "codex"],
          purpose: "generate the official {agentDisplayName} Graphify skill",
        },
        cursor: {
          args: ["cursor", "install"],
          purpose: "generate the official {agentDisplayName} Graphify skill",
        },
        "gemini-cli": {
          args: ["install", "--platform", "gemini"],
          purpose: "generate the official {agentDisplayName} Graphify skill",
        },
        opencode: {
          args: ["install", "--platform", "opencode"],
          purpose: "generate the official {agentDisplayName} Graphify skill",
        },
        hermes: {
          args: ["install", "--platform", "hermes"],
          purpose: "generate the official {agentDisplayName} Graphify skill",
        },
        "github-copilot": {
          args: ["install", "--platform", "copilot"],
          purpose: "generate the official {agentDisplayName} Graphify skill",
        },
        "kiro-cli": {
          args: ["kiro", "install"],
          purpose: "generate the official {agentDisplayName} Graphify skill",
        },
      },
    },
    healthChecks: [
      {
        executable: "{runtimeBinary}",
        args: ["--version"],
        purpose: "verify Graphify {version}",
        stdoutIncludes: "{version}",
      },
    ],
    targets: {
      "claude-code": { path: [".claude", "skills", "graphify"] },
      codex: { path: [".codex", "skills", "graphify"] },
      cursor: { path: [".cursor", "skills", "graphify"] },
      "gemini-cli": { path: [".gemini", "skills", "graphify"] },
      opencode: { path: [".config", "opencode", "skills", "graphify"] },
      hermes: { path: [".hermes", "skills", "graphify"] },
      "github-copilot": { path: [".copilot", "skills", "graphify"] },
      "kiro-cli": { path: [".kiro", "skills", "graphify"] },
    },
    timeouts: { commandMs: 300_000 },
    snapshotRoots: ["{runtimeRoot}", "{agentTargets}"],
    removal: {
      strategy: "restore-preinstall-snapshot",
      runtimeRoot: "restore-preinstall-state",
    },
    generatedFiles: {
      requiredRelativePaths: ["SKILL.md"],
      rejectSymlinks: true,
      textRewrites: [
        {
          fileExtension: ".md",
          from: "--from graphifyy",
          to: "--from '{artifactRequirement}'",
          mustEliminate: true,
        },
        {
          fileExtension: ".md",
          from: "install --upgrade graphifyy",
          to: "install '{artifactRequirement}' --exclude-newer 2026-07-17T00:00:00Z",
          mustEliminate: true,
        },
        {
          fileExtension: ".md",
          from: "pip install graphifyy",
          to: "pip install '{artifactRequirement}'",
          mustEliminate: true,
        },
        {
          fileExtension: ".md",
          from: "pip install 'graphifyy[gemini]'",
          to: "pip install 'graphifyy[gemini] @ {artifactUrl}#sha256={artifactSha256}'",
          mustEliminate: true,
        },
      ],
    },
    guarantees: [
      "dry-run unless --yes and --approve-risk are both supplied",
      "exact top-level wheel URL and SHA-256; dependency uploads bounded by the reviewed cutoff",
      "no API keys or provider credentials inherited by installer subprocesses",
      "agent skill targets and isolated runtime are snapshotted for rollback/removal",
      "generated top-level Graphify lookups and repair commands are rewritten to the same pinned artifact",
    ],
  }),
);

export const REVIEWED_RUNTIME_TOOLS = [GRAPHIFY_RECIPE] as const;

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

function currentRecipePlatform(): RuntimeRecipePlatform {
  if (
    process.platform === "darwin" ||
    process.platform === "linux" ||
    process.platform === "win32"
  )
    return process.platform;
  throw new Error(`Runtime tool recipes do not support ${process.platform}`);
}

function buildRuntimeToolCommands(
  recipe: RuntimeToolRecipe,
  runtimeRoot: string,
  agents: RuntimeToolPlan["agents"],
  platform: RuntimeRecipePlatform,
  action: RuntimeToolPlan["action"],
): RuntimeToolCommand[] {
  if (action === "remove") return [];
  const binary = resolveRuntimeRecipePath(
    runtimeRoot,
    recipe.runtime.binaryPaths[platform],
    platform,
  );
  return [
    ...recipe.commands.install.map((command) => ({
      command:
        command.executable === "{runtimeBinary}" ? binary : command.executable,
      args: command.args.map((argument) =>
        renderRuntimeRecipeValue(argument, recipe),
      ),
      purpose: renderRuntimeRecipeValue(command.purpose, recipe),
    })),
    ...agents.map((agent) => ({
      command: binary,
      args: recipe.commands.register[agent.id]!.args.map((argument) =>
        renderRuntimeRecipeValue(argument, recipe),
      ),
      purpose: renderRuntimeRecipeValue(
        recipe.commands.register[agent.id]!.purpose.replaceAll(
          "{agentDisplayName}",
          agent.displayName,
        ),
        recipe,
      ),
    })),
    ...recipe.healthChecks.map((command) => ({
      command:
        command.executable === "{runtimeBinary}" ? binary : command.executable,
      args: command.args.map((argument) =>
        renderRuntimeRecipeValue(argument, recipe),
      ),
      purpose: renderRuntimeRecipeValue(command.purpose, recipe),
    })),
  ];
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
  const platform = currentRecipePlatform();
  if (!recipe.operatingSystems.includes(platform))
    throw new Error(`${recipe.displayName} does not support ${platform}`);
  const runtimeRoot = resolveRuntimeRecipePath(
    stateHome,
    recipe.runtime.root.map((segment) =>
      segment === "{recipeId}" ? recipe.id : segment,
    ),
    platform,
  );
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
    (agent) => recipe.commands.register[agent] && recipe.targets[agent],
  );
  if (!supported.length)
    throw new Error(
      `No detected selected agent has a reviewed ${recipe.displayName} registration recipe`,
    );
  const agents = supported.map((id) => ({
    id,
    displayName: knownDetected.get(id)?.displayName ?? id,
    target: resolveRuntimeRecipePath(home, recipe.targets[id]!.path, platform),
  }));
  const commands = buildRuntimeToolCommands(
    recipe,
    runtimeRoot,
    agents,
    platform,
    action,
  );
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
    guarantees: recipe.guarantees,
  };
}

function runtimeEnvironment(plan: RuntimeToolPlan): Record<string, string> {
  const platform = currentRecipePlatform();
  const inherited = Object.fromEntries(
    plan.recipe.environment.inherit.flatMap((name) =>
      process.env[name] === undefined ? [] : [[name, process.env[name]!]],
    ),
  );
  const fixed = Object.fromEntries(
    Object.entries(plan.recipe.environment.fixed).map(([name, value]) => {
      const root = value.root === "userHome" ? plan.userHome : plan.runtimeRoot;
      return [name, resolveRuntimeRecipePath(root, value.path, platform)];
    }),
  );
  return { ...inherited, ...fixed };
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

async function applyGeneratedFilePolicy(
  directory: string,
  recipe: RuntimeToolRecipe,
): Promise<void> {
  async function visit(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const absolute = join(path, entry.name);
      if (entry.isSymbolicLink() && recipe.generatedFiles.rejectSymlinks)
        throw new Error(
          `Generated ${recipe.displayName} files contain a symlink`,
        );
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const rewrites = recipe.generatedFiles.textRewrites.filter((rewrite) =>
        entry.name.endsWith(rewrite.fileExtension),
      );
      if (!rewrites.length) continue;
      const before = await readFile(absolute, "utf8");
      let after = before;
      for (const rewrite of rewrites) {
        after = after.replaceAll(
          rewrite.from,
          renderRuntimeRecipeValue(rewrite.to, recipe),
        );
        if (rewrite.mustEliminate && after.includes(rewrite.from))
          throw new Error(
            `Generated ${recipe.displayName} files retained an unpinned runtime lookup`,
          );
      }
      if (after !== before) await writeFileAtomically(absolute, after);
    }
  }
  await visit(directory);
}

function assertRuntimeToolPlanIntegrity(plan: RuntimeToolPlan): void {
  const recipe = parseRuntimeToolRecipe(plan.recipe);
  const reviewed = findRuntimeToolRecipe(recipe.id);
  if (JSON.stringify(recipe) !== JSON.stringify(reviewed))
    throw new Error(
      `${recipe.displayName} recipe does not match Loadout's reviewed recipe`,
    );
  const platform = currentRecipePlatform();
  const expectedRuntimeRoot = resolveRuntimeRecipePath(
    plan.stateHome,
    recipe.runtime.root.map((segment) =>
      segment === "{recipeId}" ? recipe.id : segment,
    ),
    platform,
  );
  if (plan.runtimeRoot !== expectedRuntimeRoot)
    throw new Error("Runtime tool plan has an unexpected runtime root");
  if (new Set(plan.agents.map((agent) => agent.id)).size !== plan.agents.length)
    throw new Error("Runtime tool plan contains duplicate agent targets");
  for (const agent of plan.agents) {
    const target = recipe.targets[agent.id];
    const registration = recipe.commands.register[agent.id];
    if (!target || !registration)
      throw new Error(
        `Runtime tool plan contains unsupported agent ${agent.id}`,
      );
    const expectedTarget = resolveRuntimeRecipePath(
      plan.userHome,
      target.path,
      platform,
    );
    if (agent.target !== expectedTarget)
      throw new Error(`Runtime tool plan has an unexpected ${agent.id} target`);
  }
  const expectedCommands = buildRuntimeToolCommands(
    recipe,
    expectedRuntimeRoot,
    plan.agents,
    platform,
    plan.action,
  );
  if (JSON.stringify(plan.commands) !== JSON.stringify(expectedCommands))
    throw new Error(
      "Runtime tool plan commands do not match the reviewed recipe",
    );
  if (JSON.stringify(plan.guarantees) !== JSON.stringify(recipe.guarantees))
    throw new Error("Runtime tool plan guarantees do not match the recipe");
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
  assertRuntimeToolPlanIntegrity(plan);
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
    const snapshotRoots = plan.recipe.snapshotRoots.flatMap((root) =>
      root === "{runtimeRoot}"
        ? [plan.runtimeRoot]
        : plan.agents.map((agent) => agent.target),
    );
    snapshot = await createSnapshot(snapshotRoots);
    const runner = options.runner ?? defaultRunner;
    const env = runtimeEnvironment(plan);
    const healthCheckStart =
      plan.commands.length - plan.recipe.healthChecks.length;
    for (const [index, item] of plan.commands.entries()) {
      const result = await runner(item.command, item.args, {
        env,
        timeoutMs: options.timeoutMs ?? plan.recipe.timeouts.commandMs,
      });
      if (result.exitCode !== 0)
        throw new Error(
          `${item.purpose} failed${result.stderr.trim() ? `: ${result.stderr.trim().slice(0, 500)}` : ""}`,
        );
      const healthCheck =
        index >= healthCheckStart
          ? plan.recipe.healthChecks[index - healthCheckStart]
          : undefined;
      const expectedOutput = healthCheck
        ? renderRuntimeRecipeValue(healthCheck.stdoutIncludes, plan.recipe)
        : undefined;
      if (expectedOutput && !result.stdout.includes(expectedOutput))
        throw new Error(
          `Installed ${plan.recipe.displayName} version did not match ${plan.recipe.version}`,
        );
    }
    for (const agent of plan.agents) {
      for (const relativePath of plan.recipe.generatedFiles
        .requiredRelativePaths)
        await access(join(agent.target, relativePath));
      await applyGeneratedFilePolicy(agent.target, plan.recipe);
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
