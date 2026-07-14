import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Snapshot } from "../shared/types.js";
import { loadoutHome, ensureDirectory } from "./paths.js";

export async function createSnapshot(paths: string[]): Promise<Snapshot> {
  const snapshot: Snapshot = {
    id: `${Date.now()}-${createHash("sha256").update(paths.join("\n")).digest("hex").slice(0, 12)}`,
    createdAt: new Date().toISOString(),
    roots: [...new Set(paths)],
    files: []
  };
  async function capture(path: string): Promise<void> {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries) {
        const child = join(path, entry.name);
        if (entry.isDirectory()) await capture(child);
        else if (entry.isFile()) snapshot.files.push({ path: child, existed: true, content: await readFile(child, "utf8") });
      }
    } catch {
      // A missing root is represented by the root itself with existed=false so that
      // rollback can remove a directory created by a failed transaction.
      snapshot.files.push({ path, existed: false });
    }
  }
  for (const path of snapshot.roots) await capture(path);
  const directory = join(loadoutHome(), "snapshots");
  await ensureDirectory(directory);
  await writeFile(join(directory, `${snapshot.id}.json`), JSON.stringify(snapshot, null, 2));
  return snapshot;
}

export async function restoreSnapshot(snapshot: Snapshot): Promise<void> {
  for (const root of snapshot.roots) await rm(root, { recursive: true, force: true });
  for (const file of snapshot.files) {
    if (!file.existed) continue;
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content ?? "");
  }
}
