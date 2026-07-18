import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { forgetInstall, installStatePath, readInstallState } from "./state.js";
import { writeMcpConfigPlan } from "./mcp.js";
import { runMutationTransaction } from "./transaction.js";

export interface RemovePlan {
  packageId: string;
  files: Array<{ path: string; status: "unchanged" | "modified" | "missing" }>;
  mcpServers: Array<{
    configPath: string;
    serverName: string;
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
  const files = await Promise.all(
    (record?.files ?? []).map(async (file) => {
      try {
        const digest = createHash("sha256")
          .update(await readFile(file.path))
          .digest("hex");
        return {
          path: file.path,
          status:
            digest === file.sha256
              ? ("unchanged" as const)
              : ("modified" as const),
        };
      } catch {
        return { path: file.path, status: "missing" as const };
      }
    }),
  );
  const modified = files.filter((file) => file.status === "modified");
  const mcpServers = await Promise.all(
    trackedMcp.map(async (entry) => {
      try {
        const config = JSON.parse(await readFile(entry.configPath, "utf8")) as {
          mcpServers?: Record<string, unknown>;
        };
        if (!config.mcpServers || !(entry.serverName in config.mcpServers))
          return {
            configPath: entry.configPath,
            serverName: entry.serverName,
            status: "missing" as const,
          };
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(config.mcpServers[entry.serverName]))
          .digest("hex");
        return {
          configPath: entry.configPath,
          serverName: entry.serverName,
          status:
            fingerprint === entry.fingerprint
              ? ("unchanged" as const)
              : ("modified" as const),
        };
      } catch {
        return {
          configPath: entry.configPath,
          serverName: entry.serverName,
          status: "missing" as const,
        };
      }
    }),
  );
  const modifiedMcp = mcpServers.filter((entry) => entry.status === "modified");
  const warnings = [
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
      const configPaths = [
        ...new Set(
          fresh.mcpServers
            .filter((entry) => entry.status !== "missing")
            .map((entry) => entry.configPath),
        ),
      ];
      return {
        targets: [...existing, ...configPaths, installStatePath()],
        value: { fresh, existing, configPaths },
      };
    },
    async ({ fresh, existing, configPaths }) => {
      for (const file of existing) await rm(file, { force: true });
      for (const configPath of configPaths) {
        const current = JSON.parse(
          await readFile(configPath, "utf8"),
        ) as Record<string, unknown>;
        const servers = {
          ...((current.mcpServers ?? {}) as Record<string, unknown>),
        };
        const removals = fresh.mcpServers.filter(
          (entry) =>
            entry.configPath === configPath && entry.status !== "missing",
        );
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
      await forgetInstall(plan.packageId);
    },
  );
  return applied.snapshotId;
}
