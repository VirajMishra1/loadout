import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

export type ChangedFileKind = "skill" | "mcp" | "config";
export type ChangedFileStatus = "added" | "removed" | "changed";

export interface ChangedFileDiff {
  path: string;
  kind: ChangedFileKind;
  status: ChangedFileStatus;
}

const MCP_NAMES = new Set([
  "mcp.json",
  ".mcp.json",
  "claude_desktop_config.json",
]);

function classify(path: string): ChangedFileKind | undefined {
  const name = path.split("/").at(-1) ?? path;
  if (name === "SKILL.md") return "skill";
  if (MCP_NAMES.has(name)) return "mcp";
  if (/config\.(json|ya?ml)$/i.test(name)) return "config";
  return undefined;
}

async function files(root: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const base = resolve(root);
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 8) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const absolute = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const path = relative(base, absolute).split("\\").join("/");
      if (!classify(path)) continue;
      try {
        const info = await stat(absolute);
        if (info.size > 2_000_000) continue;
        const content = await readFile(absolute);
        result.set(path, createHash("sha256").update(content).digest("hex"));
      } catch {
        /* a concurrently removed file is simply omitted */
      }
    }
  }
  await visit(base, 0);
  return result;
}

/** Compare two repository revisions using hashes only; never executes repository code. */
export async function diffRepositorySnapshots(
  oldPath: string,
  newPath: string,
): Promise<ChangedFileDiff[]> {
  const [oldFiles, newFiles] = await Promise.all([
    files(oldPath),
    files(newPath),
  ]);
  const paths = [...new Set([...oldFiles.keys(), ...newFiles.keys()])].sort();
  return paths.flatMap<ChangedFileDiff>((path): ChangedFileDiff[] => {
    const oldHash = oldFiles.get(path);
    const newHash = newFiles.get(path);
    const kind = classify(path);
    if (!kind) return [];
    if (!oldHash) return [{ path, kind, status: "added" }];
    if (!newHash) return [{ path, kind, status: "removed" }];
    if (oldHash !== newHash) return [{ path, kind, status: "changed" }];
    return [];
  });
}
