import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import type {
  AgentId,
  InstallPlan,
  InstallMetadata,
  InstallRecord,
  InstallState,
  ManagedActivationRecord,
  McpConfigPlan,
  McpInstallRecord,
} from "../shared/types.js";
import { formatSchemaError, installStateSchema } from "../shared/schemas.js";
import { ensureDirectory, loadoutHome } from "./paths.js";
import { writeFileAtomically } from "./atomic-file.js";

const stateFile = () => join(loadoutHome(), "state.json");
export const installStatePath = (): string => stateFile();

export async function writeInstallState(state: InstallState): Promise<void> {
  await ensureDirectory(loadoutHome());
  await writeFileAtomically(stateFile(), `${JSON.stringify(state, null, 2)}\n`);
}

export async function readInstallState(): Promise<InstallState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(stateFile(), "utf8"));
    const result = installStateSchema.safeParse(parsed);
    if (!result.success) throw new Error(formatSchemaError(result.error));
    return result.data;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return { version: 1, installs: [], mcpInstalls: [], activations: [] };
    }
    throw new Error(
      `Loadout state is invalid at ${stateFile()}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function activationLibraryPath(
  packageId: string,
  agent: AgentId,
  unitId?: string,
): string {
  const safe = packageId.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
  const suffix = createHash("sha256")
    .update(packageId)
    .digest("hex")
    .slice(0, 10);
  const base = join(
    loadoutHome(),
    "library",
    `${safe || "package"}-${suffix}`,
    agent,
  );
  if (!unitId) return base;
  const safeUnit = unitId.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
  const unitSuffix = createHash("sha256")
    .update(unitId)
    .digest("hex")
    .slice(0, 8);
  return join(base, `${safeUnit || "skill"}-${unitSuffix}`);
}

function activationRecordsForPlan(
  plan: InstallPlan,
  metadata: InstallMetadata = {},
): ManagedActivationRecord[] {
  const now = new Date().toISOString();
  return plan.targetAgents.flatMap((agent) => {
    const targets = [
      ...new Set(
        plan.files
          .filter(
            (file) =>
              (file.componentType === undefined ||
                file.componentType === "skill") &&
              (file.targetAgent === agent ||
                (!file.targetAgent && plan.targetAgents.length === 1)),
          )
          .map((file) => file.target),
      ),
    ];
    return targets.map((activePath) => {
      const unitId = basename(activePath);
      return {
        packageId: plan.packageId,
        unitId,
        agent,
        cacheState: "missing",
        reviewState: metadata.reviewed ? "reviewed" : "unreviewed",
        installationState: "installed",
        activationState: "active",
        libraryPath: activationLibraryPath(plan.packageId, agent, unitId),
        targets: [
          {
            activePath,
            libraryRelativePath: unitId,
          },
        ],
        libraryFiles: [],
        updatedAt: now,
      };
    });
  });
}

function mergeActivationRecords(
  current: ManagedActivationRecord[] | undefined,
  records: ManagedActivationRecord[],
): ManagedActivationRecord[] {
  const keys = new Set(
    records.map(
      (item) => `${item.packageId}\0${item.agent}\0${item.unitId ?? ""}`,
    ),
  );
  return [
    ...(current ?? []).filter(
      (item) =>
        !keys.has(`${item.packageId}\0${item.agent}\0${item.unitId ?? ""}`),
    ),
    ...records,
  ].sort(
    (left, right) =>
      left.packageId.localeCompare(right.packageId) ||
      left.agent.localeCompare(right.agent) ||
      (left.unitId ?? "").localeCompare(right.unitId ?? ""),
  );
}

export async function hashDirectory(
  root: string,
): Promise<Array<{ path: string; sha256: string }>> {
  const files: Array<{ path: string; sha256: string }> = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(
          `Refusing symlink while hashing installed files: ${path}`,
        );
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const content = await readFile(path);
        files.push({
          path,
          sha256: createHash("sha256").update(content).digest("hex"),
        });
      }
    }
  }

  let rootInfo;
  try {
    rootInfo = await stat(root);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }

  if (!rootInfo.isDirectory()) return [];
  await visit(root);
  return files;
}

export async function recordInstall(
  plan: InstallPlan,
  snapshotId: string,
  metadata: InstallMetadata = {},
): Promise<InstallRecord> {
  const record = await createInstallRecord(plan, snapshotId, metadata);
  const state = await readInstallState();
  state.installs = [
    ...state.installs.filter((entry) => entry.packageId !== record.packageId),
    record,
  ];
  state.activations = mergeActivationRecords(
    state.activations,
    activationRecordsForPlan(plan, metadata),
  );
  await writeInstallState(state);
  return record;
}

async function createInstallRecord(
  plan: InstallPlan,
  snapshotId: string,
  metadata: InstallMetadata = {},
): Promise<InstallRecord> {
  const files = (
    await Promise.all(
      [...new Set(plan.files.map((file) => file.target))].map(hashDirectory),
    )
  ).flat();
  return {
    packageId: plan.packageId,
    ...(metadata.repository ? { repository: metadata.repository } : {}),
    ...(metadata.resolvedCommit
      ? { resolvedCommit: metadata.resolvedCommit }
      : {}),
    ...(metadata.staticAssessment
      ? { staticAssessment: metadata.staticAssessment }
      : {}),
    targetAgents: [...plan.targetAgents],
    files,
    snapshotId,
    installedAt: new Date().toISOString(),
  };
}

export async function recordInstallBatch(
  entries: Array<{
    plan: InstallPlan;
    metadata?: InstallMetadata;
  }>,
  snapshotId: string,
): Promise<InstallRecord[]> {
  const records = await Promise.all(
    entries.map((entry) =>
      createInstallRecord(entry.plan, snapshotId, entry.metadata),
    ),
  );
  const state = await readInstallState();
  const ids = new Set(records.map((record) => record.packageId));
  state.installs = [
    ...state.installs.filter((entry) => !ids.has(entry.packageId)),
    ...records,
  ];
  state.activations = mergeActivationRecords(
    state.activations,
    entries.flatMap((entry) =>
      activationRecordsForPlan(entry.plan, entry.metadata),
    ),
  );
  await writeInstallState(state);
  return records;
}

/**
 * Record reviewed skills that were copied into Loadout's library but were not
 * activated. Install hashes deliberately use their future active paths so the
 * existing enable/disable verifier can prove the same bytes end to end.
 */
export async function recordLibraryInstallBatch(
  entries: Array<{
    plan: InstallPlan;
    metadata?: InstallMetadata;
  }>,
  snapshotId: string,
): Promise<InstallRecord[]> {
  const now = new Date().toISOString();
  const state = await readInstallState();
  const existingActivations = new Map(
    (state.activations ?? []).map((record) => [
      `${record.packageId}\0${record.agent}\0${record.unitId ?? ""}`,
      record,
    ]),
  );
  const activationRecords: ManagedActivationRecord[] = [];
  const records: InstallRecord[] = [];
  for (const entry of entries) {
    const installFiles: InstallRecord["files"] = [];
    const targetAgents: AgentId[] = [];
    for (const agent of entry.plan.targetAgents) {
      const planned = entry.plan.files.filter(
        (file) =>
          (file.componentType === undefined ||
            file.componentType === "skill") &&
          (file.targetAgent === agent ||
            (!file.targetAgent && entry.plan.targetAgents.length === 1)),
      );
      if (!planned.length) continue;
      targetAgents.push(agent);
      const targets = [
        ...new Map(
          planned.map((file) => [
            file.target,
            {
              activePath: file.target,
              libraryRelativePath: basename(file.target),
            },
          ]),
        ).values(),
      ];
      for (const target of targets) {
        const unitId = target.libraryRelativePath;
        const libraryPath = activationLibraryPath(
          entry.plan.packageId,
          agent,
          unitId,
        );
        const libraryFiles: Array<{ path: string; sha256: string }> = [];
        const libraryTarget = join(libraryPath, target.libraryRelativePath);
        for (const file of await hashDirectory(libraryTarget)) {
          const child = relative(libraryTarget, file.path);
          installFiles.push({
            path: join(target.activePath, child),
            sha256: file.sha256,
          });
          libraryFiles.push({
            path: join(target.libraryRelativePath, child).split(sep).join("/"),
            sha256: file.sha256,
          });
        }
        const existing = existingActivations.get(
          `${entry.plan.packageId}\0${agent}\0${unitId}`,
        );
        const preserveActive =
          existing?.installationState === "installed" &&
          existing.activationState === "active";
        activationRecords.push({
          packageId: entry.plan.packageId,
          unitId,
          agent,
          cacheState: "downloaded",
          reviewState: entry.metadata?.reviewed ? "reviewed" : "unreviewed",
          installationState: "installed",
          activationState: preserveActive ? "active" : "disabled",
          libraryPath,
          targets: preserveActive ? existing.targets : [target],
          libraryFiles: libraryFiles.sort((left, right) =>
            left.path.localeCompare(right.path),
          ),
          updatedAt: now,
          snapshotId,
        });
      }
    }
    records.push({
      packageId: entry.plan.packageId,
      ...(entry.metadata?.repository
        ? { repository: entry.metadata.repository }
        : {}),
      ...(entry.metadata?.resolvedCommit
        ? { resolvedCommit: entry.metadata.resolvedCommit }
        : {}),
      targetAgents,
      files: installFiles.sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
      snapshotId,
      installedAt: now,
      ...(entry.metadata?.staticAssessment
        ? { staticAssessment: entry.metadata.staticAssessment }
        : {}),
    });
  }
  const ids = new Set(records.map((record) => record.packageId));
  state.installs = [
    ...state.installs.filter((record) => !ids.has(record.packageId)),
    ...records,
  ];
  state.activations = mergeActivationRecords(
    state.activations,
    activationRecords,
  );
  await writeInstallState(state);
  return records;
}

function mcpFingerprint(plan: McpConfigPlan): string {
  const servers = (plan.proposed.mcpServers ?? {}) as Record<string, unknown>;
  return createHash("sha256")
    .update(JSON.stringify(servers[plan.serverName] ?? null))
    .digest("hex");
}

export async function recordInstallTransaction(
  entries: Array<{
    plan: InstallPlan;
    metadata?: InstallMetadata;
  }>,
  mcpEntries: Array<{ packageId: string; plan: McpConfigPlan }>,
  snapshotId: string,
): Promise<{ installs: InstallRecord[]; mcpInstalls: McpInstallRecord[] }> {
  const installs = await Promise.all(
    entries.map((entry) =>
      createInstallRecord(entry.plan, snapshotId, entry.metadata),
    ),
  );
  const now = new Date().toISOString();
  const mcpInstalls = mcpEntries.flatMap((entry) =>
    entry.plan.changes.map((change) => ({
      packageId: entry.packageId,
      configPath: entry.plan.path,
      serverName: change.serverName,
      fingerprint: mcpFingerprint({
        ...entry.plan,
        serverName: change.serverName,
      }),
      snapshotId,
      installedAt: now,
    })),
  );
  const state = await readInstallState();
  const ids = new Set([
    ...installs.map((entry) => entry.packageId),
    ...mcpInstalls.map((entry) => entry.packageId),
  ]);
  state.installs = [
    ...state.installs.filter((entry) => !ids.has(entry.packageId)),
    ...installs,
  ];
  state.mcpInstalls = [
    ...(state.mcpInstalls ?? []).filter((entry) => !ids.has(entry.packageId)),
    ...mcpInstalls,
  ];
  state.activations = mergeActivationRecords(
    state.activations,
    entries.flatMap((entry) =>
      activationRecordsForPlan(entry.plan, entry.metadata),
    ),
  );
  await writeInstallState(state);
  return { installs, mcpInstalls };
}

export async function forgetInstall(packageId: string): Promise<void> {
  const state = await readInstallState();
  const installs = state.installs.filter(
    (entry) => entry.packageId !== packageId,
  );
  if (installs.length === state.installs.length)
    throw new Error(`Package is not managed by Loadout: ${packageId}`);
  await writeInstallState({
    version: 1,
    installs,
    mcpInstalls: (state.mcpInstalls ?? []).filter(
      (entry) => entry.packageId !== packageId,
    ),
    activations: (state.activations ?? []).map((entry) =>
      entry.packageId === packageId
        ? {
            ...entry,
            installationState: "removed" as const,
            activationState: "disabled" as const,
            updatedAt: new Date().toISOString(),
          }
        : entry,
    ),
  });
}
