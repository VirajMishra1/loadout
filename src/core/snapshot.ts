import { createHash, randomUUID } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  rename,
  rm,
  lstat,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { Snapshot, SnapshotFile } from "../shared/types.js";
import { loadoutHome, ensureDirectory, userHome } from "./paths.js";

export async function createSnapshot(
  paths: string[],
  options: { persist?: boolean } = {},
): Promise<Snapshot> {
  const normalizedRoots = [...new Set(paths.map((path) => resolve(path)))];
  const snapshot: Snapshot = {
    id: `${Date.now()}-${createHash("sha256")
      .update(`${normalizedRoots.join("\n")}\0${randomUUID()}`)
      .digest("hex")
      .slice(0, 12)}`,
    createdAt: new Date().toISOString(),
    roots: normalizedRoots,
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
    const entries = (await readdir(path, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name),
    );
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
  validateSnapshot(snapshot);
  if (options.persist !== false) {
    const directory = join(loadoutHome(), "snapshots");
    await ensureDirectory(directory);
    await writeFile(
      join(directory, `${snapshot.id}.json`),
      JSON.stringify(snapshot, null, 2),
      { mode: 0o600 },
    );
  }
  return snapshot;
}

export async function restoreSnapshot(
  snapshot: Snapshot,
  options: { requireUnchangedPostMutationState?: boolean } = {},
): Promise<void> {
  validateSnapshot(snapshot);
  if (options.requireUnchangedPostMutationState)
    await assertUnchangedPostMutationState(snapshot);
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

/** Attach the committed state used to make later user-requested rollback safe. */
export async function recordSnapshotPostMutationState(
  snapshot: Snapshot,
): Promise<void> {
  const postMutation = await createSnapshot(snapshot.roots, { persist: false });
  snapshot.postMutationFiles = postMutation.files;
  validateSnapshot(snapshot);
  const directory = join(loadoutHome(), "snapshots");
  await ensureDirectory(directory);
  const target = join(directory, `${snapshot.id}.json`);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(snapshot, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, target);
}

async function assertUnchangedPostMutationState(
  snapshot: Snapshot,
): Promise<void> {
  if (!snapshot.postMutationFiles)
    throw new Error(
      "Explicit rollback refused: this legacy snapshot has no post-mutation evidence. Preserve current files and use a newer snapshot.",
    );
  let current: SnapshotFile[];
  try {
    current = (await createSnapshot(snapshot.roots, { persist: false })).files;
  } catch (error) {
    throw new Error(
      `Explicit rollback refused because the current filesystem cannot be verified: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const expected = new Map(
    snapshot.postMutationFiles.map((file) => [file.path, file]),
  );
  const actual = new Map(current.map((file) => [file.path, file]));
  const changed = [...new Set([...expected.keys(), ...actual.keys()])]
    .filter(
      (path) =>
        JSON.stringify(expected.get(path)) !== JSON.stringify(actual.get(path)),
    )
    .sort();
  if (changed.length)
    throw new Error(
      `Explicit rollback refused because files changed after the snapshot: ${changed.slice(0, 10).join(", ")}. Preserve or review these changes before rollback.`,
    );
}

export async function readSnapshot(id: string): Promise<Snapshot> {
  if (!isSnapshotId(id)) throw new Error(`Invalid snapshot id: ${id}`);
  let value: unknown;
  try {
    value = JSON.parse(
      await readFile(join(loadoutHome(), "snapshots", `${id}.json`), "utf8"),
    );
  } catch (error) {
    if (isFileError(error, "ENOENT"))
      throw new Error(`Snapshot not found: ${id}`);
    if (error instanceof SyntaxError)
      throw new Error(`Snapshot is not valid JSON: ${id}`);
    throw error;
  }
  const snapshot = validateSnapshot(value);
  if (snapshot.id !== id)
    throw new Error(`Snapshot id does not match its filename: ${id}`);
  return snapshot;
}

export async function listSnapshotIds(): Promise<string[]> {
  try {
    return (await readdir(join(loadoutHome(), "snapshots")))
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -5))
      .filter(isSnapshotId)
      .sort();
  } catch (error) {
    if (isFileError(error, "ENOENT")) return [];
    throw error;
  }
}

const SNAPSHOT_ID = /^\d{10,}-[a-f0-9]{12}$/;

function isSnapshotId(value: string): boolean {
  return SNAPSHOT_ID.test(value);
}

function isFileError(error: unknown, code: string): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === code,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isInside(root: string, path: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  return (
    resolvedPath === resolvedRoot ||
    resolvedPath.startsWith(`${resolvedRoot}${sep}`)
  );
}

/**
 * Reject structurally unsafe or internally inconsistent persisted rollback
 * data before it can delete or write. This is corruption/tampering hardening,
 * not an authorization boundary for an attacker who controls the user account.
 */
export function validateSnapshot(value: unknown): Snapshot {
  if (!isRecord(value)) throw new Error("Snapshot must be an object");
  if (typeof value.id !== "string" || !isSnapshotId(value.id))
    throw new Error("Snapshot id is invalid");
  if (
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt))
  )
    throw new Error("Snapshot creation time is invalid");
  if (
    !Array.isArray(value.roots) ||
    value.roots.length === 0 ||
    !value.roots.every((root) => typeof root === "string" && root.length > 0)
  )
    throw new Error("Snapshot roots are invalid");
  if (!Array.isArray(value.files))
    throw new Error("Snapshot files are invalid");
  const roots = value.roots as string[];
  const forbiddenRoots = new Set([resolve(userHome()), resolve(loadoutHome())]);
  for (const [index, root] of roots.entries()) {
    if (resolve(root) !== root)
      throw new Error(
        `Snapshot root ${index} must be an absolute normalized path`,
      );
    if (dirname(root) === root)
      throw new Error(`Snapshot root ${index} must not be a filesystem root`);
    if (forbiddenRoots.has(root))
      throw new Error(`Snapshot root ${index} is too broad to restore safely`);
    if (
      roots.some(
        (candidate, candidateIndex) =>
          candidateIndex !== index && isInside(candidate, root),
      )
    )
      throw new Error("Snapshot roots must be unique and non-overlapping");
  }
  validateSnapshotFiles(value.files, roots, "Snapshot");
  if (value.postMutationFiles !== undefined) {
    if (!Array.isArray(value.postMutationFiles))
      throw new Error("Snapshot post-mutation files are invalid");
    validateSnapshotFiles(
      value.postMutationFiles,
      roots,
      "Snapshot post-mutation",
    );
  }
  return value as unknown as Snapshot;
}

function validateSnapshotFiles(
  files: unknown[],
  roots: string[],
  label: string,
): void {
  const paths = new Set<string>();
  for (const [index, file] of files.entries()) {
    if (
      !isRecord(file) ||
      typeof file.path !== "string" ||
      typeof file.existed !== "boolean" ||
      (file.directory !== undefined && typeof file.directory !== "boolean") ||
      (file.content !== undefined && typeof file.content !== "string") ||
      (file.encoding !== undefined && file.encoding !== "base64")
    )
      throw new Error(`${label} file ${index} is invalid`);
    const filePath = file.path;
    if (resolve(filePath) !== filePath)
      throw new Error(
        `${label} file ${index} path must be absolute and normalized`,
      );
    if (paths.has(filePath))
      throw new Error(`${label} file ${index} duplicates another path`);
    paths.add(filePath);
    if (!roots.some((root) => isInside(root, filePath)))
      throw new Error(`${label} file ${index} escapes its declared roots`);
    if (!file.existed) {
      if (
        file.directory !== undefined ||
        file.content !== undefined ||
        file.encoding !== undefined
      )
        throw new Error(
          `Missing ${label.toLowerCase()} file ${index} must not contain data`,
        );
    } else if (file.directory) {
      if (file.content !== undefined || file.encoding !== undefined)
        throw new Error(`${label} directory ${index} must not contain bytes`);
    } else if (
      typeof file.content !== "string" ||
      file.encoding !== "base64" ||
      !isCanonicalBase64(file.content)
    )
      throw new Error(`${label} file ${index} bytes are invalid`);
  }
  for (const [index, root] of roots.entries())
    if (!paths.has(root))
      throw new Error(`${label} root ${index} has no matching file record`);
}

function isCanonicalBase64(value: string): boolean {
  if (value.length % 4 !== 0) return false;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const contentLength = value.length - padding;
  for (let index = 0; index < contentLength; index += 1) {
    const code = value.charCodeAt(index);
    const valid =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 43 ||
      code === 47;
    if (!valid) return false;
  }
  return value.slice(contentLength) === "=".repeat(padding);
}
