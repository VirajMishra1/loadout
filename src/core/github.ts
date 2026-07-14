import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadoutHome } from "./paths.js";

export interface GitHubRepositoryMetadata {
  repository: string;
  stars: number;
  description: string;
  defaultBranch: string;
  topics: string[];
  openIssues: number;
  archived: boolean;
  lastUpdatedAt: string;
  pushedAt: string | null;
  fetchedAt: string;
}

export interface GitHubMetadataOptions {
  /** Cache lifetime in milliseconds. Defaults to six hours. */
  maxAgeMs?: number;
  /** Set false to bypass a fresh cache while retaining it as a fallback. */
  forceRefresh?: boolean;
  fetcher?: typeof fetch;
}

function normalizeRepository(input: string): string {
  const value = input.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/$/, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) throw new Error(`Invalid GitHub repository: ${input}`);
  return value;
}

function cachePath(repository: string): string {
  return join(loadoutHome(), "cache", "github-metadata", `${repository.replace("/", "__")}.json`);
}

async function readCache(path: string): Promise<GitHubRepositoryMetadata | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) as GitHubRepositoryMetadata; } catch { return undefined; }
}

/** Fetches real repository metadata from GitHub, with a local cache and stale fallback. */
export async function fetchGitHubMetadata(input: string, options: GitHubMetadataOptions = {}): Promise<GitHubRepositoryMetadata> {
  const repository = normalizeRepository(input);
  const path = cachePath(repository);
  const cached = await readCache(path);
  const maxAgeMs = options.maxAgeMs ?? 6 * 60 * 60 * 1000;
  if (cached && !options.forceRefresh && Date.now() - Date.parse(cached.fetchedAt) < maxAgeMs) return cached;

  const fetcher = options.fetcher ?? fetch;
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "loadout-discovery" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let response: Response;
  try {
    response = await fetcher(`https://api.github.com/repos/${repository}`, { headers });
  } catch (error) {
    if (cached) return cached;
    throw new Error(`Unable to reach GitHub for ${repository}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    const rateLimited = response.status === 403 || response.status === 429;
    if (cached) return cached;
    throw new Error(`GitHub metadata request failed (${response.status}${rateLimited ? ", rate limit exceeded" : ""}) for ${repository}`);
  }
  const value = await response.json() as Record<string, unknown>;
  const metadata: GitHubRepositoryMetadata = {
    repository,
    stars: typeof value.stargazers_count === "number" ? value.stargazers_count : 0,
    description: typeof value.description === "string" ? value.description : "",
    defaultBranch: typeof value.default_branch === "string" ? value.default_branch : "main",
    topics: Array.isArray(value.topics) ? value.topics.filter((topic): topic is string => typeof topic === "string") : [],
    openIssues: typeof value.open_issues_count === "number" ? value.open_issues_count : 0,
    archived: value.archived === true,
    lastUpdatedAt: typeof value.updated_at === "string" ? value.updated_at : new Date().toISOString(),
    pushedAt: typeof value.pushed_at === "string" ? value.pushed_at : null,
    fetchedAt: new Date().toISOString()
  };
  await mkdir(join(loadoutHome(), "cache", "github-metadata"), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(metadata, null, 2), "utf8");
  await rename(temporary, path);
  return metadata;
}

