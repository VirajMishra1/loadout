import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  AgentId,
  InstallPlan,
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
): string {
  const safe = packageId.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
  const suffix = createHash("sha256")
    .update(packageId)
    .digest("hex")
    .slice(0, 10);
  return join(
    loadoutHome(),
    "library",
    `${safe || "package"}-${suffix}`,
    agent,
  );
}

function activationRecordsForPlan(
  plan: InstallPlan,
  metadata: { reviewed?: boolean } = {},
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
    if (!targets.length) return [];
    return [
      {
        packageId: plan.packageId,
        agent,
        cacheState: "missing",
        reviewState: metadata.reviewed ? "reviewed" : "unreviewed",
        installationState: "installed",
        activationState: "active",
        libraryPath: activationLibraryPath(plan.packageId, agent),
        targets: targets.map((activePath) => ({
          activePath,
          libraryRelativePath: basename(activePath),
        })),
        libraryFiles: [],
        updatedAt: now,
      },
    ];
  });
}

function mergeActivationRecords(
  current: ManagedActivationRecord[] | undefined,
  records: ManagedActivationRecord[],
): ManagedActivationRecord[] {
  const keys = new Set(
    records.map((item) => `${item.packageId}\0${item.agent}`),
  );
  return [
    ...(current ?? []).filter(
      (item) => !keys.has(`${item.packageId}\0${item.agent}`),
    ),
    ...records,
  ].sort(
    (left, right) =>
      left.packageId.localeCompare(right.packageId) ||
      left.agent.localeCompare(right.agent),
  );
}

async function hashDirectory(
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
  try {
    if ((await stat(root)).isDirectory()) await visit(root);
  } catch {
    /* target may not exist after an empty plan */
  }
  return files;
}

export async function recordInstall(
  plan: InstallPlan,
  snapshotId: string,
  metadata: {
    repository?: string;
    resolvedCommit?: string;
    reviewed?: boolean;
  } = {},
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
  metadata: { repository?: string; resolvedCommit?: string } = {},
): Promise<InstallRecord> {
  const files = (
    await Promise.all(
      [...new Set(plan.files.map((file) => file.target))].map(hashDirectory),
    )
  ).flat();
  return {
    packageId: plan.packageId,
    ...metadata,
    targetAgents: [...plan.targetAgents],
    files,
    snapshotId,
    installedAt: new Date().toISOString(),
  };
}

export async function recordInstallBatch(
  entries: Array<{
    plan: InstallPlan;
    metadata?: {
      repository?: string;
      resolvedCommit?: string;
      reviewed?: boolean;
    };
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

function mcpFingerprint(plan: McpConfigPlan): string {
  const servers = (plan.proposed.mcpServers ?? {}) as Record<string, unknown>;
  return createHash("sha256")
    .update(JSON.stringify(servers[plan.serverName] ?? null))
    .digest("hex");
}

export async function recordInstallTransaction(
  entries: Array<{
    plan: InstallPlan;
    metadata?: {
      repository?: string;
      resolvedCommit?: string;
      reviewed?: boolean;
    };
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
