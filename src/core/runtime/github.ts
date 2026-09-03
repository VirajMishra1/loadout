import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { loadoutHome } from "../agents/paths.js";
import { boundedJson } from "./bounded-json.js";

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

/** Public release facts used for local trend history, never for installation. */
export interface GitHubReleaseMetadata {
  tag: string | null;
  publishedAt: string | null;
  downloadCount: number;
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
  const value = input
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value))
    throw new Error(`Invalid GitHub repository: ${input}`);
  return value;
}

function cachePath(repository: string): string {
  return join(
    loadoutHome(),
    "cache",
    "github-metadata",
    `${repository.replace("/", "__")}.json`,
  );
}

function releaseCachePath(repository: string): string {
  return join(
    loadoutHome(),
    "cache",
    "github-releases",
    `${repository.replace("/", "__")}.json`,
  );
}

async function readCache<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Fetches real repository metadata from GitHub, with a local cache and stale fallback. */
export async function fetchGitHubMetadata(
  input: string,
  options: GitHubMetadataOptions = {},
): Promise<GitHubRepositoryMetadata> {
  const repository = normalizeRepository(input);
  const path = cachePath(repository);
  const cached = await readCache<GitHubRepositoryMetadata>(path);
  const maxAgeMs = options.maxAgeMs ?? 6 * 60 * 60 * 1000;
  if (
    cached &&
    !options.forceRefresh &&
    Date.now() - Date.parse(cached.fetchedAt) < maxAgeMs
  )
    return cached;

  const fetcher = options.fetcher ?? fetch;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "loadout-discovery",
  };
  if (process.env.GITHUB_TOKEN)
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let response: Response;
  let value: unknown;
  try {
    ({ response, value } = await boundedJson(
      fetcher,
      `https://api.github.com/repos/${repository}`,
      { headers },
      {
        timeoutMs: 30_000,
        maxBytes: 4 * 1024 * 1024,
        label: "GitHub metadata",
      },
    ));
  } catch (error) {
    if (cached) return cached;
    throw new Error(
      `Unable to reach GitHub for ${repository}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    const rateLimited = response.status === 403 || response.status === 429;
    if (cached) return cached;
    throw new Error(
      `GitHub metadata request failed (${response.status}${rateLimited ? ", rate limit exceeded" : ""}) for ${repository}`,
    );
  }
  if (!value || typeof value !== "object")
    throw new Error(`GitHub metadata response is invalid for ${repository}`);
  const record = value as Record<string, unknown>;
  const metadata: GitHubRepositoryMetadata = {
    repository,
    stars:
      typeof record.stargazers_count === "number" ? record.stargazers_count : 0,
    description:
      typeof record.description === "string" ? record.description : "",
    defaultBranch:
      typeof record.default_branch === "string"
        ? record.default_branch
        : "main",
    topics: Array.isArray(record.topics)
      ? record.topics.filter(
          (topic): topic is string => typeof topic === "string",
        )
      : [],
    openIssues:
      typeof record.open_issues_count === "number"
        ? record.open_issues_count
        : 0,
    archived: record.archived === true,
    lastUpdatedAt:
      typeof record.updated_at === "string"
        ? record.updated_at
        : new Date().toISOString(),
    pushedAt: typeof record.pushed_at === "string" ? record.pushed_at : null,
    fetchedAt: new Date().toISOString(),
  };
  await mkdir(join(loadoutHome(), "cache", "github-metadata"), {
    recursive: true,
  });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(metadata, null, 2), "utf8");
  await rename(temporary, path);
  return metadata;
}

/**
 * Read the latest public GitHub release and aggregate its asset downloads.
 * Repositories without releases return explicit null/zero values. Drafts are
 * never exposed by GitHub's public release listing.
 */
export async function fetchGitHubReleaseMetadata(
  input: string,
  options: GitHubMetadataOptions = {},
): Promise<GitHubReleaseMetadata> {
  const repository = normalizeRepository(input);
  const path = releaseCachePath(repository);
  const cached = await readCache<GitHubReleaseMetadata>(path);
  const maxAgeMs = options.maxAgeMs ?? 6 * 60 * 60 * 1000;
  if (
    cached &&
    !options.forceRefresh &&
    Date.now() - Date.parse(cached.fetchedAt) < maxAgeMs
  )
    return cached;

  const fetcher = options.fetcher ?? fetch;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "loadout-discovery",
  };
  if (process.env.GITHUB_TOKEN)
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let response: Response;
  let releases: unknown;
  try {
    ({ response, value: releases } = await boundedJson(
      fetcher,
      `https://api.github.com/repos/${repository}/releases?per_page=1`,
      { headers },
      {
        timeoutMs: 30_000,
        maxBytes: 4 * 1024 * 1024,
        label: "GitHub releases",
      },
    ));
  } catch (error) {
    if (cached) return cached;
    throw new Error(
      `Unable to reach GitHub releases for ${repository}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    if (cached) return cached;
    throw new Error(
      `GitHub release request failed (${response.status}) for ${repository}`,
    );
  }
  const release = Array.isArray(releases) ? releases[0] : undefined;
  const record = release && typeof release === "object" ? release : {};
  const assets = Array.isArray((record as { assets?: unknown }).assets)
    ? ((record as { assets: unknown[] }).assets as Array<
        Record<string, unknown>
      >)
    : [];
  const metadata: GitHubReleaseMetadata = {
    tag:
      typeof (record as { tag_name?: unknown }).tag_name === "string"
        ? (record as { tag_name: string }).tag_name
        : null,
    publishedAt:
      typeof (record as { published_at?: unknown }).published_at === "string"
        ? (record as { published_at: string }).published_at
        : null,
    downloadCount: assets.reduce(
      (total, asset) =>
        total +
        (typeof asset.download_count === "number" && asset.download_count >= 0
          ? asset.download_count
          : 0),
      0,
    ),
    fetchedAt: new Date().toISOString(),
  };
  await mkdir(join(loadoutHome(), "cache", "github-releases"), {
    recursive: true,
  });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(metadata, null, 2), "utf8");
  await rename(temporary, path);
  return metadata;
}
