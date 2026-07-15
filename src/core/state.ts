import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  InstallPlan,
  InstallRecord,
  InstallState,
  McpConfigPlan,
  McpInstallRecord,
} from "../shared/types.js";
import { ensureDirectory, loadoutHome } from "./paths.js";
import { writeFileAtomically } from "./atomic-file.js";

const stateFile = () => join(loadoutHome(), "state.json");
export const installStatePath = (): string => stateFile();

async function writeInstallState(state: InstallState): Promise<void> {
  await ensureDirectory(loadoutHome());
  await writeFileAtomically(stateFile(), `${JSON.stringify(state, null, 2)}\n`);
}

export async function readInstallState(): Promise<InstallState> {
  try {
    const parsed = JSON.parse(
      await readFile(stateFile(), "utf8"),
    ) as Partial<InstallState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.installs))
      throw new Error("invalid state");
    if (parsed.mcpInstalls !== undefined && !Array.isArray(parsed.mcpInstalls))
      throw new Error("invalid state");
    return {
      ...(parsed as InstallState),
      mcpInstalls: parsed.mcpInstalls ?? [],
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return { version: 1, installs: [], mcpInstalls: [] };
    }
    throw new Error(`Loadout state is invalid at ${stateFile()}`);
  }
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
  metadata: { repository?: string; resolvedCommit?: string } = {},
): Promise<InstallRecord> {
  const record = await createInstallRecord(plan, snapshotId, metadata);
  const state = await readInstallState();
  state.installs = [
    ...state.installs.filter((entry) => entry.packageId !== record.packageId),
    record,
  ];
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
    metadata?: { repository?: string; resolvedCommit?: string };
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
    metadata?: { repository?: string; resolvedCommit?: string };
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
  });
}
