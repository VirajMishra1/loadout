#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const checkIds = ["npm", "stable-install", "github"];

function unavailable(error) {
  const text = `${error?.code ?? ""} ${error?.message ?? ""} ${error?.stderr ?? ""}`;
  return /ENET|EAI_AGAIN|ECONN|ETIMEDOUT|network|offline|timed out|authentication|unauthorized|forbidden/i.test(
    text,
  );
}

function result(id, status, detail) {
  return { id, status, detail };
}

async function npmCheck({ packageJson, fetchImpl, runCommand }) {
  const target = `${packageJson.name}@${packageJson.version}`;
  let response;
  try {
    response = await fetchImpl(
      `https://registry.npmjs.org/${encodeURIComponent(packageJson.name)}/${encodeURIComponent(packageJson.version)}`,
      { signal: AbortSignal.timeout(15_000) },
    );
  } catch (error) {
    return result(
      "npm",
      "not-verified",
      `npm registry was unavailable: ${error.message}`,
    );
  }
  if (!response.ok) {
    if (
      response.status === 401 ||
      response.status === 403 ||
      response.status >= 500
    )
      return result(
        "npm",
        "not-verified",
        `npm registry returned HTTP ${response.status}`,
      );
    return result(
      "npm",
      "failed",
      `npm registry returned HTTP ${response.status} for ${target}`,
    );
  }
  let metadata;
  try {
    metadata = await response.json();
  } catch {
    return result(
      "npm",
      "failed",
      "npm registry returned invalid JSON metadata",
    );
  }
  if (metadata.version !== packageJson.version)
    return result(
      "npm",
      "failed",
      `npm metadata version ${String(metadata.version)} does not match package.json ${packageJson.version}`,
    );
  if (
    typeof metadata.dist?.tarball !== "string" ||
    !metadata.dist.tarball.startsWith("https://")
  )
    return result(
      "npm",
      "failed",
      "npm metadata has no HTTPS distribution tarball",
    );

  const temporary = await mkdtemp(join(tmpdir(), "loadout-live-npm-"));
  try {
    await runCommand(
      process.platform === "win32" ? "npm.cmd" : "npm",
      [
        "install",
        "--prefix",
        temporary,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        target,
      ],
      { timeout: 120_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
    );
  } catch (error) {
    return result(
      "npm",
      unavailable(error) ? "not-verified" : "failed",
      `npm tarball installation did not complete: ${error.message}`,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return result(
    "npm",
    "verified",
    `${target} metadata matched and its tarball installed without lifecycle scripts`,
  );
}

async function stableCheck({ runCommand }) {
  try {
    const { stdout } = await runCommand(
      process.execPath,
      [
        join(repositoryRoot, "scripts", "readme-product-flow.mjs"),
        "--live-catalog",
        "--json",
      ],
      {
        cwd: repositoryRoot,
        timeout: 240_000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      },
    );
    const report = JSON.parse(stdout);
    const stable = report.liveCatalog;
    if (
      report.mode !== "live-catalog" ||
      !stable ||
      !(stable.packages > 0) ||
      stable.pinnedCommits !== true ||
      stable.rollback !== true
    )
      return result(
        "stable-install",
        "failed",
        "Stable live flow did not prove pinned installation and rollback",
      );
    return result(
      "stable-install",
      "verified",
      `isolated Stable flow installed ${stable.packages} pinned packages and completed rollback assertions`,
    );
  } catch (error) {
    return result(
      "stable-install",
      unavailable(error) ? "not-verified" : "failed",
      `isolated Stable flow did not complete: ${error.message}`,
    );
  }
}

function githubRepository(packageJson) {
  const source = packageJson.repository?.url ?? packageJson.repository;
  return /github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/.exec(String(source))?.[1];
}

async function githubCheck({ packageJson, env, fetchImpl, runCommand }) {
  let token = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (!token) {
    try {
      token = (
        await runCommand("gh", ["auth", "token"], { timeout: 10_000 })
      ).stdout.trim();
    } catch {
      // No connected gh session is a bounded absence of access, not success.
    }
  }
  if (!token)
    return result(
      "github",
      "not-verified",
      "GH_TOKEN, GITHUB_TOKEN, or a connected gh session is required to verify repository access and branch protection",
    );
  const repository = githubRepository(packageJson);
  if (!repository)
    return result(
      "github",
      "failed",
      "package.json does not identify a GitHub repository",
    );
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  try {
    const repositoryResponse = await fetchImpl(
      `https://api.github.com/repos/${repository}`,
      {
        headers,
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (repositoryResponse.status === 401 || repositoryResponse.status === 403)
      return result(
        "github",
        "not-verified",
        `GitHub access was not authorized (HTTP ${repositoryResponse.status})`,
      );
    if (!repositoryResponse.ok)
      return result(
        "github",
        "failed",
        `GitHub repository lookup returned HTTP ${repositoryResponse.status}`,
      );
    const repositoryMetadata = await repositoryResponse.json();
    const branch = repositoryMetadata.default_branch;
    if (typeof branch !== "string" || !branch)
      return result(
        "github",
        "failed",
        "GitHub repository response has no default branch",
      );
    const protectionResponse = await fetchImpl(
      `https://api.github.com/repos/${repository}/branches/${encodeURIComponent(branch)}/protection`,
      { headers, signal: AbortSignal.timeout(15_000) },
    );
    if (protectionResponse.status === 401 || protectionResponse.status === 403)
      return result(
        "github",
        "not-verified",
        `GitHub branch-protection access was unavailable (HTTP ${protectionResponse.status})`,
      );
    if (!protectionResponse.ok)
      return result(
        "github",
        "failed",
        `GitHub branch protection is not verified for ${branch} (HTTP ${protectionResponse.status})`,
      );
    return result(
      "github",
      "verified",
      `repository access and branch protection verified for ${repository}:${branch}`,
    );
  } catch (error) {
    return result(
      "github",
      "not-verified",
      `GitHub API was unavailable: ${error.message}`,
    );
  }
}

export function parseLiveCheckReport(value) {
  if (
    value?.schemaVersion !== 1 ||
    !Number.isFinite(Date.parse(value?.generatedAt))
  )
    throw new Error("invalid live-check report header");
  if (!Array.isArray(value.checks))
    throw new Error("live-check report requires checks");
  for (const check of value.checks) {
    if (
      !checkIds.includes(check?.id) ||
      !["verified", "failed", "not-verified"].includes(check?.status) ||
      typeof check?.detail !== "string" ||
      !check.detail
    )
      throw new Error("invalid live-check result");
  }
  return value;
}

export async function runLiveChecks({
  requested = checkIds,
  packageJson,
  env = process.env,
  fetchImpl = globalThis.fetch,
  runCommand = execFileAsync,
} = {}) {
  const checks = [];
  for (const id of requested) {
    if (!checkIds.includes(id)) throw new Error(`unknown live check: ${id}`);
    if (id === "npm")
      checks.push(await npmCheck({ packageJson, fetchImpl, runCommand }));
    if (id === "stable-install") checks.push(await stableCheck({ runCommand }));
    if (id === "github")
      checks.push(
        await githubCheck({ packageJson, env, fetchImpl, runCommand }),
      );
  }
  return parseLiveCheckReport({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    checks,
  });
}

async function main() {
  const selected = checkIds.filter((id) => process.argv.includes(`--${id}`));
  const packageJson = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
  );
  const report = await runLiveChecks({
    requested: selected.length ? selected : checkIds,
    packageJson,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.checks.some((check) => check.status === "failed"))
    process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
