import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface TargetOccupancy {
  occupied: boolean;
  reason?:
    | "content"
    | "symlink"
    | "unsupported"
    | "unreadable"
    | "inspection-limit";
}

/**
 * Inspect a prospective skill target without following symlinks or executing
 * any content. Missing paths and recursively empty directories are safe to
 * replace; every uncertain state fails closed.
 */
export async function inspectTargetOccupancy(
  path: string,
  maximumEntries = 10_000,
): Promise<TargetOccupancy> {
  let root;
  try {
    root = await lstat(path);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    )
      return { occupied: false };
    return { occupied: true, reason: "unreadable" };
  }

  if (root.isSymbolicLink()) return { occupied: true, reason: "symlink" };
  if (!root.isDirectory()) return { occupied: true, reason: "unsupported" };

  const queue = [path];
  let inspected = 0;
  while (queue.length) {
    const directory = queue.pop()!;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return { occupied: true, reason: "unreadable" };
    }
    for (const entry of entries) {
      inspected += 1;
      if (inspected > maximumEntries)
        return { occupied: true, reason: "inspection-limit" };
      if (entry.isDirectory() && !entry.isSymbolicLink())
        queue.push(join(directory, entry.name));
      else
        return {
          occupied: true,
          reason: entry.isSymbolicLink() ? "symlink" : "content",
        };
    }
  }
  return { occupied: false };
}
