import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  rm,
  lstat,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Snapshot } from "../shared/types.js";
import { loadoutHome, ensureDirectory } from "./paths.js";

export async function createSnapshot(paths: string[]): Promise<Snapshot> {
  const snapshot: Snapshot = {
    id: `${Date.now()}-${createHash("sha256").update(paths.join("\n")).digest("hex").slice(0, 12)}`,
    createdAt: new Date().toISOString(),
    roots: [...new Set(paths)],
    files: [],
  };
  async function capture(path: string): Promise<void> {
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "ENOENT"
      ))
        throw error;
      snapshot.files.push({ path, existed: false });
      return;
    }
    if (info.isSymbolicLink())
      throw new Error(`Refusing to snapshot symlink: ${path}`);
    if (info.isFile()) {
      snapshot.files.push({
        path,
        existed: true,
        content: (await readFile(path)).toString("base64"),
        encoding: "base64",
      });
      return;
    }
    if (!info.isDirectory())
      throw new Error(`Refusing unsupported snapshot target: ${path}`);
    snapshot.files.push({ path, existed: true, directory: true });
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Refusing to snapshot symlink: ${child}`);
      if (entry.isDirectory()) await capture(child);
      else if (entry.isFile())
        snapshot.files.push({
          path: child,
          existed: true,
          content: (await readFile(child)).toString("base64"),
          encoding: "base64",
        });
    }
  }
  for (const path of snapshot.roots) await capture(path);
  const directory = join(loadoutHome(), "snapshots");
  await ensureDirectory(directory);
  await writeFile(
    join(directory, `${snapshot.id}.json`),
    JSON.stringify(snapshot, null, 2),
    { mode: 0o600 },
  );
  return snapshot;
}

export async function restoreSnapshot(snapshot: Snapshot): Promise<void> {
  for (const root of snapshot.roots)
    await rm(root, { recursive: true, force: true });
  for (const directory of snapshot.files
    .filter((file) => file.existed && file.directory)
    .sort((a, b) => a.path.length - b.path.length))
    await mkdir(directory.path, { recursive: true });
  for (const file of snapshot.files) {
    if (!file.existed || file.directory) continue;
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(
      file.path,
      file.encoding === "base64"
        ? Buffer.from(file.content ?? "", "base64")
        : (file.content ?? ""),
    );
  }
}

export async function readSnapshot(id: string): Promise<Snapshot> {
  return JSON.parse(
    await readFile(join(loadoutHome(), "snapshots", `${id}.json`), "utf8"),
  ) as Snapshot;
}
