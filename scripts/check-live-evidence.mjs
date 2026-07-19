#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const checkIds = ["npm", "stable-install", "github"];

function unavailable(error) {
  const text = `${error?.code ?? ""} ${error?.message ?? ""} ${error?.stderr ?? ""}`;
  return /ENET|EAI_AGAIN|ENOTFOUND|ECONN|ETIMEDOUT|network|offline|timed out|could not resolve host(?:name)?|name resolution|DNS|SSL|TLS|certificate|socket|curl:\s*\((?:7|28|35)\)|failed to connect|fetch failed|authentication|unauthorized|forbidden/i.test(
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
  const integrity = /^(sha(?:256|384|512))-([A-Za-z0-9+/]+={0,2})$/.exec(
    String(metadata.dist.integrity ?? ""),
  );
  if (!integrity)
    return result(
      "npm",
      "failed",
      "npm metadata has no supported sha256/sha384/sha512 integrity value",
    );

  const temporary = await mkdtemp(join(tmpdir(), "loadout-live-npm-"));
  try {
    const userConfig = join(temporary, "npmrc");
    const globalConfig = join(temporary, "global-npmrc");
    await Promise.all([
      writeFile(userConfig, "", { mode: 0o600 }),
      writeFile(globalConfig, "", { mode: 0o600 }),
    ]);
    const isolatedEnvironment = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      COMSPEC: process.env.COMSPEC,
      PATHEXT: process.env.PATHEXT,
      TMPDIR: process.env.TMPDIR,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      HTTP_PROXY: process.env.HTTP_PROXY,
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      NO_PROXY: process.env.NO_PROXY,
      http_proxy: process.env.http_proxy,
      https_proxy: process.env.https_proxy,
      no_proxy: process.env.no_proxy,
      HOME: temporary,
      USERPROFILE: temporary,
      npm_config_cache: join(temporary, "npm-cache"),
      npm_config_userconfig: userConfig,
      NPM_CONFIG_USERCONFIG: userConfig,
      npm_config_globalconfig: globalConfig,
      NPM_CONFIG_GLOBALCONFIG: globalConfig,
      npm_config_registry: "https://registry.npmjs.org/",
    };
    let tarballResponse;
    try {
      tarballResponse = await fetchImpl(metadata.dist.tarball, {
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      return result(
        "npm",
        "not-verified",
        `npm tarball was unavailable: ${error.message}`,
      );
    }
    if (!tarballResponse.ok)
      return result(
        "npm",
        tarballResponse.status >= 500 ? "not-verified" : "failed",
        `npm tarball returned HTTP ${tarballResponse.status}`,
      );
    const tarballBytes = Buffer.from(await tarballResponse.arrayBuffer());
    if (!tarballBytes.length || tarballBytes.length > 100 * 1024 * 1024)
      return result(
        "npm",
        "failed",
        `npm tarball size ${tarballBytes.length} is outside the bounded inspection limit`,
      );
    const observedDigest = createHash(integrity[1])
      .update(tarballBytes)
      .digest();
    const expectedDigest = Buffer.from(integrity[2], "base64");
    if (
      observedDigest.length !== expectedDigest.length ||
      !timingSafeEqual(observedDigest, expectedDigest)
    )
      return result(
        "npm",
        "failed",
        `npm tarball content does not match metadata integrity ${integrity[1]}`,
      );
    const tarballPath = join(
      temporary,
      `${packageJson.name}-${packageJson.version}.tgz`,
    );
    await writeFile(tarballPath, tarballBytes, { mode: 0o600 });
    await runCommand(
      process.platform === "win32" ? "npm.cmd" : "npm",
      [
        "install",
        "--prefix",
        temporary,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        tarballPath,
      ],
      {
        cwd: temporary,
        env: isolatedEnvironment,
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      },
    );
    const installedRoot = join(temporary, "node_modules", packageJson.name);
    const installed = JSON.parse(
      await readFile(join(installedRoot, "package.json"), "utf8"),
    );
    if (
      installed.name !== packageJson.name ||
      installed.version !== packageJson.version
    )
      return result(
        "npm",
        "failed",
        `installed tarball identity ${String(installed.name)}@${String(installed.version)} does not match ${target}`,
      );
    const bin =
      typeof installed.bin === "string"
        ? installed.bin
        : installed.bin?.loadout;
    const cliPath =
      typeof bin === "string" ? resolve(installedRoot, bin) : undefined;
    const cliRelative = cliPath ? relative(installedRoot, cliPath) : "";
    if (
      typeof bin !== "string" ||
      !cliPath ||
      !cliRelative ||
      isAbsolute(cliRelative) ||
      cliRelative === ".." ||
      cliRelative.startsWith(`..${sep}`)
    )
      return result(
        "npm",
        "failed",
        "installed tarball does not expose a safe loadout CLI bin path",
      );
    const cliStat = await lstat(cliPath);
    if (cliStat.isSymbolicLink() || !cliStat.isFile())
      throw new Error(
        "installed CLI must be a regular non-symlink file inside the package",
      );
    const [realInstalledRoot, realCliPath] = await Promise.all([
      realpath(installedRoot),
      realpath(cliPath),
    ]);
    const realCliRelative = relative(realInstalledRoot, realCliPath);
    if (
      !realCliRelative ||
      isAbsolute(realCliRelative) ||
      realCliRelative === ".." ||
      realCliRelative.startsWith(`..${sep}`)
    )
      throw new Error(
        "installed CLI must be a regular file inside the real package root",
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
    `${target} metadata matched; the exact HTTPS tarball passed integrity verification and its package identity and non-symlink CLI file were inspected without invoking downloaded package or dependency executables`,
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
      stable.rollback !== true ||
      stable.filesystemRestoration !== true
    )
      return result(
        "stable-install",
        "failed",
        "Stable live flow did not prove pinned installation and rollback",
      );
    return result(
      "stable-install",
      "verified",
      `isolated Stable flow installed ${stable.packages} pinned packages and completed state and filesystem rollback assertions`,
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
    if (repositoryResponse.status >= 500)
      return result(
        "github",
        "not-verified",
        `GitHub repository service was unavailable (HTTP ${repositoryResponse.status})`,
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
    if (protectionResponse.status >= 500)
      return result(
        "github",
        "not-verified",
        `GitHub branch-protection service was unavailable (HTTP ${protectionResponse.status})`,
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

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`invalid ${label}`);
  const extras = Object.keys(value).filter((key) => !expected.includes(key));
  if (extras.length)
    throw new Error(`${label} has unexpected properties: ${extras.join(", ")}`);
}

function validDateTime(value) {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] =
    match;
  const daysInMonth = new Date(
    Date.UTC(Number(year), Number(month), 0),
  ).getUTCDate();
  return (
    Number(month) >= 1 &&
    Number(month) <= 12 &&
    Number(day) >= 1 &&
    Number(day) <= daysInMonth &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 59 &&
    (offsetHour === undefined ||
      (Number(offsetHour) <= 23 && Number(offsetMinute) <= 59))
  );
}

export function parseLiveCheckReport(value, expectedIds) {
  exactKeys(
    value,
    ["schemaVersion", "generatedAt", "repositoryCommit", "checks"],
    "live-check report",
  );
  if (value?.schemaVersion !== 1)
    throw new Error("invalid live-check report header");
  if (!validDateTime(value.generatedAt))
    throw new Error("invalid live-check report date-time");
  if (!/^[0-9a-f]{40}$/.test(value.repositoryCommit))
    throw new Error("invalid live-check report repository commit");
  if (!Array.isArray(value.checks))
    throw new Error("live-check report requires checks");
  const seen = new Set();
  for (const check of value.checks) {
    exactKeys(check, ["id", "status", "detail"], "live-check result");
    if (
      !checkIds.includes(check?.id) ||
      !["verified", "failed", "not-verified"].includes(check?.status) ||
      typeof check?.detail !== "string" ||
      !check.detail
    )
      throw new Error("invalid live-check result");
    if (seen.has(check.id))
      throw new Error(`duplicate live-check result: ${check.id}`);
    seen.add(check.id);
  }
  if (expectedIds) {
    for (const id of expectedIds)
      if (!seen.has(id)) throw new Error(`missing requested live check: ${id}`);
    for (const id of seen)
      if (!expectedIds.includes(id))
        throw new Error(`unexpected unrequested live check: ${id}`);
  }
  return value;
}

export async function runLiveChecks({
  requested = checkIds,
  packageJson,
  repositoryCommit,
  env = process.env,
  fetchImpl = globalThis.fetch,
  runCommand = execFileAsync,
} = {}) {
  const boundRepositoryCommit =
    repositoryCommit ??
    (
      await execFileAsync(
        "git",
        ["-C", repositoryRoot, "rev-parse", "--verify", "HEAD^{commit}"],
        { timeout: 10_000, windowsHide: true },
      )
    ).stdout.trim();
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
  return parseLiveCheckReport(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      repositoryCommit: boundRepositoryCommit,
      checks,
    },
    requested,
  );
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
