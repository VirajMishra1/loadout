import {
  lstat,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
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

export interface RepositoryFetchOptions {
  ref?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxFiles?: number;
  fetcher?: typeof fetch;
}

async function enforceRepositoryBounds(
  root: string,
  options: RepositoryFetchOptions,
): Promise<void> {
  if (options.maxBytes === undefined && options.maxFiles === undefined) return;
  let bytes = 0;
  let files = 0;
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await lstat(path);
      bytes += info.size;
      files++;
      if (options.maxBytes !== undefined && bytes > options.maxBytes)
        throw new Error(
          `Repository exceeds the ${options.maxBytes} byte inspection limit`,
        );
      if (options.maxFiles !== undefined && files > options.maxFiles)
        throw new Error(
          `Repository exceeds the ${options.maxFiles} file inspection limit`,
        );
    }
  }
}

interface GitHubTreeResponse {
  truncated?: boolean;
  tree?: Array<{ type?: string; size?: number; path?: string }>;
}

export function validateGitHubTreeBounds(
  value: unknown,
  options: RepositoryFetchOptions,
): void {
  if (options.maxBytes === undefined && options.maxFiles === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("GitHub tree preflight returned an invalid response");
  const response = value as GitHubTreeResponse;
  if (response.truncated)
    throw new Error("GitHub tree preflight was truncated; refusing checkout");
  if (!Array.isArray(response.tree))
    throw new Error("GitHub tree preflight has no tree entries");
  let bytes = 0;
  let files = 0;
  for (const entry of response.tree) {
    if (entry.type !== "blob") continue;
    if (
      typeof entry.path !== "string" ||
      typeof entry.size !== "number" ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0
    )
      throw new Error("GitHub tree preflight contains invalid blob evidence");
    files++;
    bytes += entry.size;
    if (options.maxBytes !== undefined && bytes > options.maxBytes)
      throw new Error(
        `Repository exceeds the ${options.maxBytes} byte inspection limit`,
      );
    if (options.maxFiles !== undefined && files > options.maxFiles)
      throw new Error(
        `Repository exceeds the ${options.maxFiles} file inspection limit`,
      );
  }
}

async function enforceGitHubTreeBounds(
  repository: string,
  commit: string,
  options: RepositoryFetchOptions,
): Promise<void> {
  if (options.maxBytes === undefined && options.maxFiles === undefined) return;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 120_000);
  const token = process.env.GITHUB_TOKEN?.trim();
  const response = await (options.fetcher ?? fetch)(
    `https://api.github.com/repos/${repository}/git/trees/${commit}?recursive=1`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "loadout-ai",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal,
    },
  );
  if (!response.ok)
    throw new Error(
      `GitHub tree preflight failed with HTTP ${response.status}; refusing an unbounded checkout`,
    );
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > 25 * 1024 * 1024)
    throw new Error("GitHub tree preflight response exceeds 25 MiB");
  if (!response.body)
    throw new Error("GitHub tree preflight response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 25 * 1024 * 1024) {
      await reader.cancel();
      throw new Error("GitHub tree preflight response exceeds 25 MiB");
    }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("GitHub tree preflight returned invalid JSON");
  }
  validateGitHubTreeBounds(value, options);
}

async function isolatedGitEnvironment(
  root: string,
): Promise<NodeJS.ProcessEnv> {
  const sandbox = join(root, ".loadout-git-sandbox");
  const hooks = join(sandbox, "hooks");
  const templates = join(sandbox, "templates");
  const config = join(sandbox, "empty.gitconfig");
  await Promise.all([ensureDirectory(hooks), ensureDirectory(templates)]);
  await writeFile(config, "", { flag: "a", mode: 0o600 });
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  return {
    ...inherited,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: config,
    GIT_CONFIG_GLOBAL: config,
    GIT_TEMPLATE_DIR: templates,
    GIT_TERMINAL_PROMPT: "0",
    GIT_LFS_SKIP_SMUDGE: "1",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: hooks,
    GIT_CONFIG_KEY_1: "credential.helper",
    GIT_CONFIG_VALUE_1: "",
  };
}

/** Stable on-disk location used to retain fetched repository revisions. */
export function repositoryCachePath(
  repository: string,
  commit: string,
): string {
  return join(loadoutHome(), "cache", repository.replace("/", "__"), commit);
}

export function normalizeRepository(input: string): string {
  const value = input
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(
      `Expected a public GitHub repository like owner/repo, received: ${input}`,
    );
  }
  return value;
}

function normalizeRef(ref: string): string {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) ||
    ref.includes("..") ||
    ref.endsWith("/")
  )
    throw new Error(`Invalid Git ref: ${ref}`);
  return ref;
}

export async function fetchRepositorySnapshot(
  input: string,
  options: RepositoryFetchOptions = {},
): Promise<RepositorySnapshot> {
  const repository = normalizeRepository(input);
  const gitEnvironment = await isolatedGitEnvironment(loadoutHome());
  const ref = options.ref ? normalizeRef(options.ref) : undefined;
  if (ref && /^[0-9a-f]{40}$/i.test(ref)) {
    const cached = repositoryCachePath(repository, ref);
    let reusable = false;
    try {
      const [{ stdout: head }, { stdout: status }] = await Promise.all([
        execFileAsync("git", ["-C", cached, "rev-parse", "HEAD"], {
          timeout: options.timeoutMs,
          env: gitEnvironment,
        }),
        execFileAsync("git", ["-C", cached, "status", "--porcelain"], {
          timeout: options.timeoutMs,
          env: gitEnvironment,
        }),
      ]);
      reusable =
        head.trim().toLowerCase() === ref.toLowerCase() && status.trim() === "";
    } catch {
      /* missing or modified cache: fetch a clean reviewed snapshot below */
    }
    if (reusable) {
      await enforceRepositoryBounds(cached, options);
      return { repository, commit: ref, path: cached };
    }
  }
  const temporary = await mkdtemp(join(tmpdir(), "loadout-repository-"));
  try {
    const url = `https://github.com/${repository}.git`;
    const gitOptions = {
      maxBuffer: 10 * 1024 * 1024,
      timeout: options.timeoutMs,
      env: {
        ...gitEnvironment,
      },
    };
    if (ref && /^[0-9a-f]{40}$/i.test(ref)) {
      // `git clone --branch` accepts branch or tag names, not an arbitrary
      // reviewed commit. Fetch the immutable catalog commit directly so a
      // later default-branch change cannot alter what Loadout installs.
      await execFileAsync("git", ["init", "--quiet", temporary], gitOptions);
      await execFileAsync(
        "git",
        ["-C", temporary, "remote", "add", "origin", url],
        gitOptions,
      );
      await execFileAsync(
        "git",
        [
          "-C",
          temporary,
          "fetch",
          "--depth",
          "1",
          ...(options.maxBytes !== undefined || options.maxFiles !== undefined
            ? ["--filter=blob:none"]
            : []),
          "origin",
          ref,
        ],
        gitOptions,
      );
      const { stdout: fetchedCommit } = await execFileAsync(
        "git",
        ["-C", temporary, "rev-parse", "FETCH_HEAD"],
        gitOptions,
      );
      await enforceGitHubTreeBounds(repository, fetchedCommit.trim(), options);
      await execFileAsync(
        "git",
        ["-C", temporary, "checkout", "--quiet", "--detach", "FETCH_HEAD"],
        gitOptions,
      );
    } else {
      const refArgs = ref ? ["--branch", ref] : [];
      await execFileAsync(
        "git",
        [
          "clone",
          "--depth",
          "1",
          ...refArgs,
          ...(options.maxBytes !== undefined || options.maxFiles !== undefined
            ? ["--filter=blob:none", "--no-checkout"]
            : []),
          "--",
          url,
          temporary,
        ],
        gitOptions,
      );
      if (options.maxBytes !== undefined || options.maxFiles !== undefined) {
        const { stdout: headCommit } = await execFileAsync(
          "git",
          ["-C", temporary, "rev-parse", "HEAD"],
          gitOptions,
        );
        await enforceGitHubTreeBounds(repository, headCommit.trim(), options);
        await execFileAsync(
          "git",
          ["-C", temporary, "checkout", "--quiet", "HEAD"],
          gitOptions,
        );
      }
    }
    const { stdout } = await execFileAsync(
      "git",
      ["-C", temporary, "rev-parse", "HEAD"],
      { timeout: options.timeoutMs, env: gitEnvironment },
    );
    const commit = stdout.trim();
    if (!/^[0-9a-f]{40}$/i.test(commit))
      throw new Error(`Git returned an invalid commit for ${repository}`);
    await enforceRepositoryBounds(temporary, options);
    const cachePath = repositoryCachePath(repository, commit);
    await ensureDirectory(
      join(loadoutHome(), "cache", repository.replace("/", "__")),
    );
    await rm(cachePath, { recursive: true, force: true });
    await rename(temporary, cachePath);
    return { repository, commit, path: cachePath };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not fetch ${repository}: ${message}`);
  }
}

function normalizeGitUrl(input: string): string {
  const value = input.trim();
  if (value !== input || /[\0\r\n]/.test(value) || value.startsWith("-"))
    throw new Error("Invalid Git URL");
  const httpsOrSsh = /^(?:https|ssh):\/\/[^\s]+$/i.test(value);
  const scp =
    /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._~/-]+(?:\.git)?$/.test(value);
  if (!httpsOrSsh && !scp)
    throw new Error("Generic Git sources require an HTTPS or SSH URL");
  if (httpsOrSsh) {
    const parsed = new URL(value);
    // Git includes failing command arguments in its error text. Reject URLs
    // that can embed a token before invoking Git, rather than leaking one in
    // a clone failure.
    if (parsed.password || (parsed.protocol === "https:" && parsed.username)) {
      throw new Error(
        "Git URLs must not embed credentials; use an SSH agent or credential helper",
      );
    }
    if (parsed.search || parsed.hash)
      throw new Error("Git URLs must not include query strings or fragments");
  }
  return value;
}

/** Fetch a generic Git source without running repository hooks or lifecycle scripts. */
export async function fetchGitSnapshot(
  input: string,
  options: RepositoryFetchOptions = {},
): Promise<RepositorySnapshot> {
  if (options.maxBytes !== undefined || options.maxFiles !== undefined)
    throw new Error(
      "Pre-check size/file bounds are supported only for public GitHub owner/repository sources; refusing an unbounded generic Git clone",
    );
  const url = normalizeGitUrl(input);
  const temporary = await mkdtemp(join(tmpdir(), "loadout-git-"));
  try {
    const gitEnvironment = await isolatedGitEnvironment(loadoutHome());
    const refArgs = options.ref ? ["--branch", normalizeRef(options.ref)] : [];
    await execFileAsync(
      "git",
      ["clone", "--depth", "1", ...refArgs, "--", url, temporary],
      {
        maxBuffer: 10 * 1024 * 1024,
        timeout: options.timeoutMs,
        env: {
          ...gitEnvironment,
        },
      },
    );
    const { stdout } = await execFileAsync(
      "git",
      ["-C", temporary, "rev-parse", "HEAD"],
      { timeout: options.timeoutMs, env: gitEnvironment },
    );
    const commit = stdout.trim();
    if (!/^[0-9a-f]{40}$/i.test(commit))
      throw new Error("Git returned an invalid commit");
    await enforceRepositoryBounds(temporary, options);
    const key = createHash("sha256").update(url).digest("hex");
    const cachePath = join(loadoutHome(), "cache", "git", key, commit);
    await ensureDirectory(join(loadoutHome(), "cache", "git", key));
    await rm(cachePath, { recursive: true, force: true });
    await rename(temporary, cachePath);
    return { repository: url, commit, path: cachePath };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw new Error(
      `Could not fetch Git source: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
