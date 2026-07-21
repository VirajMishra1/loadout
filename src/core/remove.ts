import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { forgetInstall, installStatePath, readInstallState } from "./state.js";
import { writeMcpConfigPlan } from "./mcp.js";
import { runMutationTransaction } from "./transaction.js";
import { managedFileReadPath } from "./active-set.js";
import {
  codexMcpServerFingerprint,
  removeCodexMcpServerBlock,
  writeCodexMcpConfigContent,
} from "./codex-mcp.js";

export interface RemovePlan {
  packageId: string;
  preserveFiles: boolean;
  files: Array<{ path: string; status: "unchanged" | "modified" | "missing" }>;
  mcpServers: Array<{
    configPath: string;
    serverName: string;
    configFormat: "json" | "codex-toml";
    status: "unchanged" | "modified" | "missing";
  }>;
  blocked: boolean;
  warnings: string[];
}

export async function planRemove(packageId: string): Promise<RemovePlan> {
  const state = await readInstallState();
  const record = state.installs.find((entry) => entry.packageId === packageId);
  const trackedMcp = (state.mcpInstalls ?? []).filter(
    (entry) => entry.packageId === packageId,
  );
  if (!record && !trackedMcp.length)
    throw new Error(`Package is not managed by Loadout: ${packageId}`);
  // Older releases encoded reconciled/adopted ownership in the generated id.
  // Preserve that compatibility so upgrading Loadout protects already-adopted
  // user content even before the new explicit state field has been written.
  const preserveFiles = Boolean(
    record &&
    (record.ownershipOrigin === "adopted" ||
      record.packageId.startsWith("adopted-")),
  );
  const files = await Promise.all(
    (record?.files ?? []).map(async (file) => {
      const managedPath = managedFileReadPath(
        packageId,
        file.path,
        state.activations ?? [],
      );
      try {
        const digest = createHash("sha256")
          .update(await readFile(managedPath))
          .digest("hex");
        return {
          path: managedPath,
          status:
            digest === file.sha256
              ? ("unchanged" as const)
              : ("modified" as const),
        };
      } catch {
        return { path: managedPath, status: "missing" as const };
      }
    }),
  );
  const modified = preserveFiles
    ? []
    : files.filter((file) => file.status === "modified");
  const mcpServers = await Promise.all(
    trackedMcp.map(async (entry) => {
      try {
        if (entry.configFormat === "codex-toml") {
          const content = await readFile(entry.configPath, "utf8");
          const fingerprint = codexMcpServerFingerprint(
            content,
            entry.serverName,
          );
          return {
            configPath: entry.configPath,
            serverName: entry.serverName,
            configFormat: "codex-toml" as const,
            status: !fingerprint
              ? ("missing" as const)
              : fingerprint === entry.fingerprint
                ? ("unchanged" as const)
                : ("modified" as const),
          };
        }
        const config = JSON.parse(await readFile(entry.configPath, "utf8")) as {
          mcpServers?: Record<string, unknown>;
        };
        if (!config.mcpServers || !(entry.serverName in config.mcpServers))
          return {
            configPath: entry.configPath,
            serverName: entry.serverName,
            configFormat: "json" as const,
            status: "missing" as const,
          };
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(config.mcpServers[entry.serverName]))
          .digest("hex");
        return {
          configPath: entry.configPath,
          serverName: entry.serverName,
          configFormat: "json" as const,
          status:
            fingerprint === entry.fingerprint
              ? ("unchanged" as const)
              : ("modified" as const),
        };
      } catch {
        return {
          configPath: entry.configPath,
          serverName: entry.serverName,
          configFormat: entry.configFormat ?? "json",
          status: "missing" as const,
        };
      }
    }),
  );
  const modifiedMcp = mcpServers.filter((entry) => entry.status === "modified");
  const warnings = [
    ...(preserveFiles
      ? [
          "This package adopted pre-existing files; removal will forget Loadout ownership and preserve those files in place.",
        ]
      : []),
    ...(modified.length
      ? [`${modified.length} managed file(s) were modified outside Loadout.`]
      : []),
    ...(modifiedMcp.length
      ? [
          `${modifiedMcp.length} managed MCP server entry or entries were modified outside Loadout.`,
        ]
      : []),
  ];
  if (warnings.length)
    warnings.push("Removal is blocked unless --force is used.");
  return {
    packageId,
    preserveFiles,
    files,
    mcpServers,
    blocked: modified.length > 0 || modifiedMcp.length > 0,
    warnings,
  };
}

export async function applyRemove(
  plan: RemovePlan,
  options: { force?: boolean } = {},
): Promise<string> {
  const applied = await runMutationTransaction(
    async () => {
      const fresh = await planRemove(plan.packageId);
      if (fresh.blocked && !options.force)
        throw new Error(fresh.warnings.join(" "));
      const existing = fresh.files
        .filter((file) => file.status !== "missing")
        .map((file) => file.path);
      const removableFiles = fresh.preserveFiles ? [] : existing;
      const configPaths = [
        ...new Set(
          fresh.mcpServers
            .filter((entry) => entry.status !== "missing")
            .map((entry) => entry.configPath),
        ),
      ];
      return {
        targets: [...removableFiles, ...configPaths, installStatePath()],
        value: { fresh, removableFiles, configPaths },
      };
    },
    async ({ fresh, removableFiles, configPaths }) => {
      for (const file of removableFiles) await rm(file, { force: true });
      for (const configPath of configPaths) {
        const relevant = fresh.mcpServers.filter(
          (entry) =>
            entry.configPath === configPath && entry.status !== "missing",
        );
        if (relevant.some((entry) => entry.configFormat === "codex-toml")) {
          let content = await readFile(configPath, "utf8");
          for (const entry of relevant)
            content = removeCodexMcpServerBlock(content, entry.serverName);
          await writeCodexMcpConfigContent(configPath, content);
          continue;
        }
        const current = JSON.parse(
          await readFile(configPath, "utf8"),
        ) as Record<string, unknown>;
        const servers = {
          ...((current.mcpServers ?? {}) as Record<string, unknown>),
        };
        const removals = relevant;
        for (const entry of removals) delete servers[entry.serverName];
        await writeMcpConfigPlan({
          path: configPath,
          serverName: removals[0]?.serverName ?? "removed",
          changes: removals.map((entry) => ({
            serverName: entry.serverName,
            action: "replace",
            summary: `Remove MCP server '${entry.serverName}'`,
          })),
          warnings: [],
          proposed: { ...current, mcpServers: servers },
        });
      }
      await forgetInstall(plan.packageId, {
        dropActivations: fresh.preserveFiles,
      });
    },
    { label: `remove ${plan.packageId}` },
  );
  return applied.snapshotId;
}
