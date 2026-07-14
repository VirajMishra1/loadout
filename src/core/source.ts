import { mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadoutHome, ensureDirectory } from "./paths.js";

const execFileAsync = promisify(execFile);

export interface RepositorySnapshot {
  repository: string;
  commit: string;
  path: string;
}

export function normalizeRepository(input: string): string {
  const value = input
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(`Expected a public GitHub repository like owner/repo, received: ${input}`);
  }
  return value;
}

export async function fetchRepositorySnapshot(input: string): Promise<RepositorySnapshot> {
  const repository = normalizeRepository(input);
  const temporary = await mkdtemp(join(tmpdir(), "loadout-repository-"));
  try {
    await execFileAsync("git", ["clone", "--depth", "1", `https://github.com/${repository}.git`, temporary], { maxBuffer: 10 * 1024 * 1024 });
    const { stdout } = await execFileAsync("git", ["-C", temporary, "rev-parse", "HEAD"]);
    const commit = stdout.trim();
    if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error(`Git returned an invalid commit for ${repository}`);
    const cachePath = join(loadoutHome(), "cache", repository.replace("/", "__"), commit);
    await ensureDirectory(join(loadoutHome(), "cache", repository.replace("/", "__")));
    await rm(cachePath, { recursive: true, force: true });
    await rename(temporary, cachePath);
    return { repository, commit, path: cachePath };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not fetch ${repository}: ${message}`);
  }
}
