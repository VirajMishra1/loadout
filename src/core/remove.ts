import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { createSnapshot, restoreSnapshot } from "./snapshot.js";
import { forgetInstall, installStatePath, readInstallState } from "./state.js";

export interface RemovePlan {
  packageId: string;
  files: Array<{ path: string; status: "unchanged" | "modified" | "missing" }>;
  blocked: boolean;
  warnings: string[];
}

export async function planRemove(packageId: string): Promise<RemovePlan> {
  const record = (await readInstallState()).installs.find((entry) => entry.packageId === packageId);
  if (!record) throw new Error(`Package is not managed by Loadout: ${packageId}`);
  const files = await Promise.all(record.files.map(async (file) => {
    try {
      const digest = createHash("sha256").update(await readFile(file.path)).digest("hex");
      return { path: file.path, status: digest === file.sha256 ? "unchanged" as const : "modified" as const };
    } catch { return { path: file.path, status: "missing" as const }; }
  }));
  const modified = files.filter((file) => file.status === "modified");
  return { packageId, files, blocked: modified.length > 0, warnings: modified.length ? [`${modified.length} managed file(s) were modified outside Loadout. Removal is blocked unless --force is used.`] : [] };
}

export async function applyRemove(plan: RemovePlan, options: { force?: boolean } = {}): Promise<string> {
  if (plan.blocked && !options.force) throw new Error(plan.warnings.join(" "));
  const existing = plan.files.filter((file) => file.status !== "missing").map((file) => file.path);
  const snapshot = await createSnapshot([...existing, installStatePath()]);
  try {
    for (const file of existing) await rm(file, { force: true });
    await forgetInstall(plan.packageId);
  } catch (error) {
    await restoreSnapshot(snapshot);
    throw error;
  }
  return snapshot.id;
}
