import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { InstallPlan, InstallRecord, InstallState } from "../shared/types.js";
import { ensureDirectory, loadoutHome } from "./paths.js";

const stateFile = () => join(loadoutHome(), "state.json");

export async function readInstallState(): Promise<InstallState> {
  try {
    const parsed = JSON.parse(await readFile(stateFile(), "utf8")) as Partial<InstallState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.installs)) throw new Error("invalid state");
    return parsed as InstallState;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") {
      return { version: 1, installs: [] };
    }
    throw new Error(`Loadout state is invalid at ${stateFile()}`);
  }
}

async function hashDirectory(root: string): Promise<Array<{ path: string; sha256: string }>> {
  const files: Array<{ path: string; sha256: string }> = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Refusing symlink while hashing installed files: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const content = await readFile(path);
        files.push({ path, sha256: createHash("sha256").update(content).digest("hex") });
      }
    }
  }
  try { if ((await stat(root)).isDirectory()) await visit(root); } catch { /* target may not exist after an empty plan */ }
  return files;
}

export async function recordInstall(
  plan: InstallPlan,
  snapshotId: string,
  metadata: { repository?: string; resolvedCommit?: string } = {}
): Promise<InstallRecord> {
  const files = (await Promise.all([...new Set(plan.files.map((file) => file.target))].map(hashDirectory))).flat();
  const record: InstallRecord = {
    packageId: plan.packageId,
    ...metadata,
    targetAgents: [...plan.targetAgents],
    files,
    snapshotId,
    installedAt: new Date().toISOString()
  };
  const state = await readInstallState();
  state.installs = [...state.installs.filter((entry) => entry.packageId !== record.packageId), record];
  await ensureDirectory(loadoutHome());
  await writeFile(stateFile(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  return record;
}
