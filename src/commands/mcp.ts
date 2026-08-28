import { Command } from "commander";

import { userHome } from "../core/paths.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { fetchRepositorySnapshot } from "../core/source.js";
import {
  discoverMcpManifests,
  summarizeMcpManifest,
  planMcpConfig,
  summarizeMcpConfigPlan,
  applyMcpConfigPlan,
} from "../core/mcp.js";
import {
  REVIEWED_MCP_RECIPES,
  buildMcpRecipeServer,
  findMcpRecipe,
  formatMcpRecipePlan,
  planMcpRecipe,
  verifyMcpRecipe,
  verifyMcpRecipeConnection,
} from "../core/mcp-recipes.js";
import type { McpServer } from "../shared/types.js";

import { inspectPackage, formatPackageInspection } from "../core/package.js";

import {
  installStatePath,
  recordInstallTransaction,
  recordMcpInstall,
} from "../core/state.js";

import {
  applyCodexMcpConfigPlan,
  codexMcpServerFingerprint,
  defaultCodexMcpConfigPath,
  planCodexMcpConfig,
} from "../core/codex-mcp.js";

import { evaluatePackage, formatPackageEvaluation } from "../core/evaluate.js";
import { checkForUpdates, startUpdateWatcher } from "../core/update-watch.js";
import { runDisposableSandbox } from "../core/sandbox.js";

import {
  applyNativeScheduler,
  formatNativeScheduler,
  planNativeScheduler,
  type SchedulerAction,
} from "../core/scheduler.js";

import {
  collectOption,
  parseMcpCredentialMappings,
  durableSchedulerLauncher,
} from "./support.js";

export function registerMcp(program: Command): void {
  program
    .command("mcp-recipe")
    .description(
      "Preview/configure a reviewed MCP recipe, or explicitly verify its real connection",
    )
    .argument("[id]", "recipe id; omit to list reviewed recipes")
    .option(
      "--agent <id>",
      "target host: codex or claude-code; selects its default config format and path",
    )
    .option("--config <path>", "target JSON MCP config path")
    .option("--yes", "write the reviewed server entry after preview")
    .option("--verify", "verify the configured entry without starting a server")
    .option(
      "--connect",
      "launch the exact pinned artifact and perform an MCP initialize handshake",
    )
    .option(
      "--credential <mapping>",
      "credential mapping NAME=env:VARIABLE or NAME=keychain:SERVICE (repeatable)",
      collectOption,
      [],
    )
    .option("--credential-account <account>", "account for keychain mappings")
    .option("--timeout <milliseconds>", "real connection timeout", "30000")
    .option(
      "--approve-risk",
      "approve launching the reviewed pinned MCP artifact for --connect",
    )
    .option("--json", "emit machine-readable JSON")
    .option(
      "--no-key",
      "list recipes needing no separately billed AI/model API key",
    )
    .option(
      "--no-model-key",
      "clear alias for --no-key; service tokens may still be required",
    )
    .option(
      "--credential-free",
      "list recipes needing no credential of any kind",
    )
    .action(
      async (
        id: string | undefined,
        options: {
          config?: string;
          yes?: boolean;
          verify?: boolean;
          connect?: boolean;
          credential: string[];
          credentialAccount?: string;
          timeout: string;
          approveRisk?: boolean;
          json?: boolean;
          agent?: string;
          key?: boolean;
          modelKey?: boolean;
          credentialFree?: boolean;
        },
      ) => {
        if (!id) {
          if (options.connect || options.verify || options.yes)
            throw new Error("Select an MCP recipe id for this operation");
          const selected = REVIEWED_MCP_RECIPES.filter(
            (recipe) =>
              !(
                (options.key === false || options.modelKey === false) &&
                recipe.modelApiProviders.length > 0
              ) && !(options.credentialFree && recipe.environment.length > 0),
          );
          const listed = selected.map((recipe) => ({
            id: recipe.id,
            displayName: recipe.displayName,
            source: recipe.source,
            permissions: recipe.permissions,
            environment: recipe.environment,
            modelApiProviders: recipe.modelApiProviders,
          }));
          const output = options.json
            ? JSON.stringify(listed, null, 2)
            : listed
                .map(
                  (recipe) =>
                    `${recipe.id} — ${recipe.displayName} — ${recipe.modelApiProviders.length ? `AI API required: ${recipe.modelApiProviders.join(", ")}` : "No AI API key required"} · ${recipe.environment.length ? `${recipe.environment.includes("GITHUB_PERSONAL_ACCESS_TOKEN") ? "GitHub token required" : `service credential required: ${recipe.environment.join(", ")}`}` : "no other credential"}`,
                )
                .join("\n");
          console.log(output);
          if (!options.json)
            console.log(
              "\nInstall for one host (preview first):\n  loadout mcp-recipe playwright --agent codex\n  loadout mcp-recipe playwright --agent claude-code",
            );
          return;
        }
        if (options.connect) {
          if (options.verify || options.yes)
            throw new Error(
              "--connect cannot be combined with --verify or --yes",
            );
          const recipe = findMcpRecipe(id);
          const credentialReferences = parseMcpCredentialMappings(
            recipe,
            options.credential,
            options.credentialAccount,
          );
          const timeoutMs = Number(options.timeout);
          const controller = new AbortController();
          const abort = () => controller.abort();
          process.once("SIGINT", abort);
          process.once("SIGTERM", abort);
          try {
            const result = await verifyMcpRecipeConnection(id, {
              approveRisk: Boolean(options.approveRisk),
              credentialReferences,
              timeoutMs,
              signal: controller.signal,
            });
            console.log(
              options.json
                ? JSON.stringify(result, null, 2)
                : `Connected: ${result.recipeId} · MCP ${result.protocolVersion}${result.serverInfo ? ` · ${result.serverInfo.name}${result.serverInfo.version ? ` ${result.serverInfo.version}` : ""}` : ""}\n${result.checks.join("\n")}`,
            );
          } finally {
            process.off("SIGINT", abort);
            process.off("SIGTERM", abort);
          }
          return;
        }
        if (
          options.agent &&
          options.agent !== "codex" &&
          options.agent !== "claude-code"
        )
          throw new Error("--agent must be codex or claude-code");
        if (options.agent && options.config)
          throw new Error(
            "Choose --agent for a managed default path or --config for an explicit JSON path, not both",
          );
        const configPath =
          options.config ??
          (options.agent === "codex"
            ? defaultCodexMcpConfigPath()
            : options.agent === "claude-code"
              ? join(userHome(), ".claude.json")
              : undefined);
        if (!configPath)
          throw new Error(
            "Choose --agent codex, --agent claude-code, or an explicit --config path",
          );
        if (options.verify) {
          if (options.yes)
            throw new Error("--verify cannot be combined with --yes");
          if (options.agent === "codex") {
            const recipe = findMcpRecipe(id);
            let content = "";
            try {
              content = await readFile(configPath, "utf8");
            } catch {
              // Missing config is rendered as a normal not-configured result.
            }
            const configured = Boolean(
              codexMcpServerFingerprint(content, recipe.serverName),
            );
            console.log(
              options.json
                ? JSON.stringify(
                    { recipeId: id, configPath, configured },
                    null,
                    2,
                  )
                : `${configured ? "Configured" : "Not configured"}: ${id}\nCodex config: ${configPath}\nConfiguration presence does not launch the MCP server; add --connect --approve-risk for a bounded handshake.`,
            );
            if (!configured) process.exitCode = 1;
            return;
          }
          const verification = await verifyMcpRecipe(id, configPath);
          console.log(
            options.json
              ? JSON.stringify(verification, null, 2)
              : `${verification.configured ? "Configured" : "Not configured"}: ${verification.recipeId}\n${[...verification.checks, ...verification.warnings].join("\n")}`,
          );
          if (!verification.configured) process.exitCode = 1;
          return;
        }
        const recipe = findMcpRecipe(id);
        const credentialReferences = parseMcpCredentialMappings(
          recipe,
          options.credential,
          options.credentialAccount,
        );
        if (options.agent === "codex") {
          const server = buildMcpRecipeServer(id, configPath, {
            credentialReferences,
            requireResolvedCredentials: Boolean(options.yes),
          });
          const plan = await planCodexMcpConfig(
            configPath,
            server,
            server.name,
          );
          const recipe = findMcpRecipe(id);
          const preview = [
            `MCP recipe: ${recipe.displayName}`,
            `Target: Codex`,
            `Config: ${plan.path}`,
            `Change: ${plan.summary}`,
            `Artifact: ${recipe.artifact}`,
            `Permissions: ${recipe.permissions.join(", ")}`,
            recipe.environment.length
              ? `Credential references required: ${recipe.environment.join(", ")}`
              : "Credentials: none",
          ].join("\n");
          if (!options.yes) {
            console.log(
              options.json
                ? JSON.stringify(
                    {
                      recipe,
                      agent: "codex",
                      path: plan.path,
                      summary: plan.summary,
                    },
                    null,
                    2,
                  )
                : `${preview}\nDry run only. Re-run with --yes to add this reviewed Codex MCP server.`,
            );
            return;
          }
          const fingerprint = codexMcpServerFingerprint(
            plan.proposed,
            recipe.serverName,
          );
          if (!fingerprint)
            throw new Error(
              "Could not fingerprint the applied Codex MCP entry",
            );
          const snapshot = await applyCodexMcpConfigPlan(plan, {
            extraTargets: [installStatePath()],
            afterApply: async (_result, transactionSnapshot) =>
              recordMcpInstall({
                packageId: `mcp-recipe:${id}:codex`,
                configPath: plan.path,
                serverName: recipe.serverName,
                fingerprint,
                snapshotId: transactionSnapshot.id,
                installedAt: new Date().toISOString(),
                configFormat: "codex-toml",
              }),
          });
          console.log(
            options.json
              ? JSON.stringify(
                  {
                    recipe,
                    agent: "codex",
                    snapshotId: snapshot.rollbackSnapshotId,
                  },
                  null,
                  2,
                )
              : `${preview}\nConfigured for Codex. Managed package: mcp-recipe:${id}:codex\nRollback: loadout rollback --snapshot ${snapshot.rollbackSnapshotId}\nNext: loadout mcp-recipe ${id} --agent codex --verify`,
          );
          return;
        }
        const plan = await planMcpRecipe(id, configPath, {
          credentialReferences,
          requireResolvedCredentials: Boolean(options.yes),
        });
        if (!options.yes) {
          const target =
            options.agent === "claude-code" ? "Target: Claude Code\n" : "";
          console.log(
            options.json
              ? JSON.stringify(
                  options.agent ? { agent: options.agent, ...plan } : plan,
                  null,
                  2,
                )
              : `${target}${formatMcpRecipePlan(plan)}\nDry run only. Re-run with --yes to write this server entry.`,
          );
          return;
        }
        const managedId = options.agent
          ? `mcp-recipe:${id}:${options.agent}`
          : `mcp-recipe:${id}`;
        const snapshot = await applyMcpConfigPlan(plan.config, {
          extraTargets: [installStatePath()],
          afterApply: async (_result, transactionSnapshot) => {
            await recordInstallTransaction(
              [],
              [{ packageId: managedId, plan: plan.config }],
              transactionSnapshot.id,
            );
          },
        });
        console.log(
          options.json
            ? JSON.stringify({ plan, snapshot }, null, 2)
            : `${options.agent === "claude-code" ? "Target: Claude Code\n" : ""}${formatMcpRecipePlan(plan)}\nConfigured${options.agent ? " for Claude Code" : ""}. Managed package: ${managedId}\nRollback: loadout rollback --snapshot ${snapshot.rollbackSnapshotId}\nAuthorize the service separately, then run: loadout mcp-recipe ${id} ${options.agent ? `--agent ${options.agent}` : `--config ${plan.config.path}`} --verify`,
        );
      },
    );

  program
    .command("mcp")
    .description("Inspect MCP manifests without executing servers or scripts")
    .option("--source <directory>", "local repository directory")
    .option("--repository <owner/repo>", "public GitHub repository")
    .option("--json", "emit normalized JSON")
    .action(
      async (options: {
        source?: string;
        repository?: string;
        json?: boolean;
      }) => {
        if ((options.source ? 1 : 0) + (options.repository ? 1 : 0) !== 1) {
          throw new Error("Provide exactly one of --source or --repository");
        }
        const source = options.repository
          ? (await fetchRepositorySnapshot(options.repository)).path
          : options.source!;
        const manifests = await discoverMcpManifests(source);
        if (options.json) console.log(JSON.stringify(manifests, null, 2));
        else if (manifests.length === 0)
          console.log("No supported MCP manifests found.");
        else
          for (const manifest of manifests)
            console.log(summarizeMcpManifest(manifest));
      },
    );

  program
    .command("inspect")
    .description(
      "Inspect skills and MCP components in a local directory or public GitHub repository",
    )
    .option("--source <directory>", "local package directory")
    .option("--repository <owner/repo>", "public GitHub repository")
    .option("--json", "emit normalized JSON")
    .action(
      async (options: {
        source?: string;
        repository?: string;
        json?: boolean;
      }) => {
        if ((options.source ? 1 : 0) + (options.repository ? 1 : 0) !== 1)
          throw new Error("Provide exactly one of --source or --repository");
        const source = options.repository
          ? (await fetchRepositorySnapshot(options.repository)).path
          : options.source!;
        const result = await inspectPackage(source);
        console.log(
          options.json
            ? JSON.stringify(result, null, 2)
            : formatPackageInspection(result),
        );
      },
    );

  program
    .command("evaluate")
    .description(
      "Evaluate static skill and MCP evidence without executing package code",
    )
    .option("--source <directory>", "local package directory")
    .option("--repository <owner/repo>", "public GitHub repository")
    .option("--json", "emit evaluation JSON")
    .action(
      async (options: {
        source?: string;
        repository?: string;
        json?: boolean;
      }) => {
        if ((options.source ? 1 : 0) + (options.repository ? 1 : 0) !== 1)
          throw new Error("Provide exactly one of --source or --repository");
        const source = options.repository
          ? (await fetchRepositorySnapshot(options.repository)).path
          : options.source!;
        const result = await evaluatePackage(source);
        console.log(
          options.json
            ? JSON.stringify(result, null, 2)
            : formatPackageEvaluation(result),
        );
      },
    );

  program
    .command("watch")
    .description(
      "Watch for read-only updates; never applies changes automatically",
    )
    .option("--interval <minutes>", "check interval", "1440")
    .option("--once", "check once and exit")
    .option("--json", "emit each notification as JSON")
    .action(
      async (options: { interval: string; once?: boolean; json?: boolean }) => {
        const minutes = Number(options.interval);
        if (!Number.isFinite(minutes) || minutes <= 0)
          throw new Error("--interval must be a positive number of minutes");
        const notify = (
          notification: Awaited<ReturnType<typeof checkForUpdates>>,
        ) =>
          console.log(
            options.json
              ? JSON.stringify(notification)
              : `${notification.checkedAt}: ${notification.message}`,
          );
        if (options.once) {
          notify(await checkForUpdates());
          return;
        }
        const stop = startUpdateWatcher({
          intervalMs: minutes * 60_000,
          notify,
        });
        const shutdown = () => {
          stop();
          process.exit(0);
        };
        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);
        await new Promise<void>(() => undefined);
      },
    );

  for (const action of [
    "schedule",
    "unschedule",
  ] as const satisfies SchedulerAction[]) {
    program
      .command(action)
      .description(
        `${action === "schedule" ? "Install" : "Remove"} a native daily read-only update or candidate-discovery check`,
      )
      .option("--time <HH:MM>", "local daily check time", "09:00")
      .option("--job <updates|discovery>", "daily read-only job", "updates")
      .option("--yes", "apply the native scheduler change")
      .option("--json", "emit machine-readable JSON")
      .action(
        async (options: {
          time: string;
          job: string;
          yes?: boolean;
          json?: boolean;
        }) => {
          if (options.job !== "updates" && options.job !== "discovery")
            throw new Error("--job must be updates or discovery");
          const plan = planNativeScheduler(action, {
            time: options.time,
            launcher: durableSchedulerLauncher(),
            job: options.job,
          });
          if (!options.yes) {
            console.log(
              options.json
                ? JSON.stringify(plan, null, 2)
                : `${formatNativeScheduler(plan)}\nDry run only. Re-run with --yes to change the native scheduler.`,
            );
            return;
          }
          const snapshotId = await applyNativeScheduler(plan);
          console.log(
            options.json
              ? JSON.stringify({ plan, snapshotId }, null, 2)
              : `${formatNativeScheduler(plan)}\nApplied. Snapshot: ${snapshotId}`,
          );
        },
      );
  }

  program
    .command("sandbox-run")
    .description(
      "Run an explicitly approved command in a disposable networkless Docker sandbox",
    )
    .requiredOption("--source <directory>", "read-only source directory")
    .requiredOption("--image <image>", "reviewed/pinned Docker image reference")
    .requiredOption(
      "--command <argument>",
      "command argument (repeatable; first is executable)",
      (value: string, previous: string[] = []) => [...previous, value],
      [],
    )
    .requiredOption("--approve-risk", "explicitly approve sandbox execution")
    .option("--timeout <milliseconds>", "execution timeout", "120000")
    .option("--json", "emit result JSON")
    .action(
      async (options: {
        source: string;
        image: string;
        command: string[];
        approveRisk: boolean;
        timeout: string;
        json?: boolean;
      }) => {
        const result = await runDisposableSandbox({
          sourceDirectory: options.source,
          image: options.image,
          command: options.command,
          approveRisk: options.approveRisk,
          timeoutMs: Number(options.timeout),
        });
        console.log(
          options.json
            ? JSON.stringify(result, null, 2)
            : `Sandbox exited ${result.exitCode}\n${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`,
        );
        if (result.exitCode !== 0) process.exitCode = result.exitCode;
      },
    );

  program
    .command("mcp-config")
    .description(
      "Plan or apply a safe MCP server configuration change (dry-run by default)",
    )
    .requiredOption("--config <path>", "MCP JSON configuration path")
    .requiredOption("--name <name>", "server name")
    .option("--command <command>", "local server command")
    .option("--url <url>", "remote MCP server URL")
    .option(
      "--arg <value>",
      "server argument (repeatable)",
      (value: string, previous: string[] = []) => [...previous, value],
      [],
    )
    .option(
      "--env <NAME=VALUE>",
      "environment variable (repeatable; values are never printed)",
      (value: string, previous: string[] = []) => [...previous, value],
      [],
    )
    .option("--yes", "apply the change; without this flag only a plan is shown")
    .action(
      async (options: {
        config: string;
        name: string;
        command?: string;
        url?: string;
        arg: string[];
        env: string[];
        yes?: boolean;
      }) => {
        if ((options.command ? 1 : 0) + (options.url ? 1 : 0) !== 1)
          throw new Error("Provide exactly one of --command or --url");
        const env: Record<string, string> = {};
        for (const item of options.env) {
          const separator = item.indexOf("=");
          if (separator <= 0)
            throw new Error(`Invalid --env '${item}'; expected NAME=VALUE`);
          const key = item.slice(0, separator);
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
            throw new Error(`Invalid environment variable name '${key}'`);
          env[key] = item.slice(separator + 1);
        }
        const server: McpServer = {
          name: options.name,
          command: options.command,
          url: options.url,
          args: options.arg,
          env,
          sourcePath: options.config,
          warnings: [],
        };
        const plan = await planMcpConfig(options.config, server);
        console.log(summarizeMcpConfigPlan(plan));
        if (!options.yes) {
          console.log("Dry run only. Re-run with --yes to apply this change.");
          return;
        }
        const snapshot = await applyMcpConfigPlan(plan);
        console.log(
          `Applied successfully. Snapshot: ${snapshot.rollbackSnapshotId}`,
        );
      },
    );

  program
    .command("codex-mcp-config")
    .description("Plan or add a Codex TOML MCP server (dry-run by default)")
    .option(
      "--config <path>",
      "Codex config.toml path",
      defaultCodexMcpConfigPath(),
    )
    .requiredOption("--name <name>", "server name")
    .option("--command <command>", "local server command")
    .option("--url <url>", "remote MCP server URL")
    .option(
      "--arg <value>",
      "server argument (repeatable)",
      (value: string, previous: string[] = []) => [...previous, value],
      [],
    )
    .option(
      "--env <NAME=VALUE>",
      "environment variable (repeatable; values are never printed)",
      (value: string, previous: string[] = []) => [...previous, value],
      [],
    )
    .option("--yes", "apply the change; without this flag only a plan is shown")
    .action(
      async (options: {
        config: string;
        name: string;
        command?: string;
        url?: string;
        arg: string[];
        env: string[];
        yes?: boolean;
      }) => {
        if ((options.command ? 1 : 0) + (options.url ? 1 : 0) !== 1)
          throw new Error("Provide exactly one of --command or --url");
        const env: Record<string, string> = {};
        for (const item of options.env) {
          const separator = item.indexOf("=");
          if (separator <= 0)
            throw new Error(`Invalid --env '${item}'; expected NAME=VALUE`);
          const key = item.slice(0, separator);
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
            throw new Error(`Invalid environment variable name '${key}'`);
          env[key] = item.slice(separator + 1);
        }
        const server: McpServer = {
          name: options.name,
          command: options.command,
          url: options.url,
          args: options.arg,
          env,
          sourcePath: options.config,
          warnings: [],
        };
        const plan = await planCodexMcpConfig(options.config, server);
        console.log(`Codex config: ${plan.path}\n  - ${plan.summary}`);
        if (!options.yes)
          return console.log(
            "Dry run only. Re-run with --yes to add this Codex MCP server.",
          );
        const snapshot = await applyCodexMcpConfigPlan(plan);
        console.log(
          `Applied successfully. Snapshot: ${snapshot.rollbackSnapshotId}`,
        );
      },
    );
}
