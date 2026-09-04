import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), "loadout-package-smoke-"));
const expectedVersion = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
).version;

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolveRun({ stdout, stderr });
      else
        reject(
          new Error(
            `${basename(command)} ${args[0] ?? ""} failed (${code})\n${stderr.slice(-4000)}`,
          ),
        );
    });
  });
}

function runMcpHandshake(cli, options) {
  return new Promise((resolveHandshake, reject) => {
    const child = spawn(process.execPath, [cli, "serve"], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let initialized = false;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Packaged MCP handshake timed out: ${stderr}`));
    }, 5_000);
    const finish = (error) => {
      clearTimeout(timeout);
      child.kill();
      if (error) reject(error);
      else resolveHandshake();
    };
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      while (stdout.includes("\n")) {
        const newline = stdout.indexOf("\n");
        const line = stdout.slice(0, newline);
        stdout = stdout.slice(newline + 1);
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          finish(new Error(`Packaged MCP emitted non-JSON stdout: ${line}`));
          return;
        }
        if (message.id === 1 && !initialized) {
          initialized = true;
          child.stdin.write(
            `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
          );
          child.stdin.write(
            `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`,
          );
        } else if (message.id === 2) {
          const names = message.result?.tools?.map((tool) => tool.name) ?? [];
          if (
            !names.includes("snapshot") ||
            !names.includes("release_ownership")
          ) {
            finish(new Error("Packaged MCP tool list is incomplete"));
            return;
          }
          finish();
        }
      }
    });
    child.once("error", finish);
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "package-smoke", version: "1.0.0" },
        },
      })}\n`,
    );
  });
}

try {
  const npmCli = process.env.npm_execpath;
  if (!npmCli)
    throw new Error("npm_execpath is required; run npm run test:package");
  const packed = await run(process.execPath, [
    npmCli,
    "pack",
    "--json",
    "--pack-destination",
    temporary,
  ]);
  const packResult = JSON.parse(packed.stdout);
  if (!Array.isArray(packResult) || !packResult[0]?.filename)
    throw new Error("npm pack did not report a tarball");
  const packedFiles = new Set(
    (packResult[0].files ?? []).map((entry) => entry.path),
  );
  const mcpServerArtifact = "dist/src/core/coordination/mcp-server.js";
  if (!packedFiles.has(mcpServerArtifact))
    throw new Error(
      `Packaged coordination MCP server is missing: ${mcpServerArtifact}`,
    );
  for (const removedArtifact of [
    "dist/src/dashboard.js",
    "dist/src/core/demo.js",
  ])
    if (packedFiles.has(removedArtifact))
      throw new Error(
        `Removed product surface leaked into the package: ${removedArtifact}`,
      );
  const tarball = join(temporary, packResult[0].filename);
  const consumer = join(temporary, "consumer");
  await mkdir(consumer, { recursive: true });
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({ name: "loadout-smoke-consumer", private: true }),
  );
  await run(
    process.execPath,
    [npmCli, "install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
    { cwd: consumer },
  );
  const cli = join(
    consumer,
    "node_modules",
    "loadout-ai",
    "dist",
    "src",
    "cli.js",
  );
  const packageRoot = join(consumer, "node_modules", "loadout-ai");
  const userHome = join(temporary, "home");
  const stateHome = join(temporary, "state");
  const skillSource = join(temporary, "fixture-skill");
  const environment = {
    ...process.env,
    LOADOUT_USER_HOME: userHome,
    LOADOUT_HOME: stateHome,
    NO_COLOR: "1",
  };
  await mkdir(join(userHome, ".agents", "skills"), { recursive: true });
  await mkdir(skillSource, { recursive: true });
  await writeFile(
    join(skillSource, "SKILL.md"),
    "---\nname: package-smoke\ndescription: Published package smoke fixture\n---\n\nVerify the installed tarball.\n",
  );

  const version = await run(process.execPath, [cli, "--version"], {
    cwd: packageRoot,
    env: environment,
  });
  if (version.stdout.trim() !== expectedVersion)
    throw new Error(`Unexpected packaged version: ${version.stdout}`);
  const coordinationHelp = await run(
    process.execPath,
    [cli, "coord", "agents", "--help"],
    { cwd: consumer, env: environment },
  );
  if (!coordinationHelp.stdout.includes("bridge"))
    throw new Error("Packaged provider bridge commands are unavailable");
  await runMcpHandshake(cli, { cwd: consumer, env: environment });
  const coverage = await run(
    process.execPath,
    [cli, "catalog", "--coverage", "--json"],
    { cwd: packageRoot, env: environment },
  );
  const coverageResult = JSON.parse(coverage.stdout);
  if (coverageResult.records < 50 || coverageResult.immutablePins < 50)
    throw new Error("Packaged catalog evidence is incomplete");
  const candidates = await run(
    process.execPath,
    [cli, "candidate", "list", "--limit", "1"],
    { cwd: consumer, env: environment },
  );
  if (!candidates.stdout.trim())
    throw new Error("Packaged candidate discovery feed is unavailable");

  await run(
    process.execPath,
    [
      cli,
      "install",
      "--source",
      skillSource,
      "--package",
      "package-smoke",
      "--agents",
      "codex",
      "--yes",
    ],
    { cwd: consumer, env: environment },
  );
  const installed = await readFile(
    join(userHome, ".agents", "skills", "package-smoke", "SKILL.md"),
    "utf8",
  );
  if (!installed.includes("Published package smoke fixture"))
    throw new Error("Packaged CLI did not install the fixture skill");
  await run(process.execPath, [cli, "rollback"], {
    cwd: consumer,
    env: environment,
  });
  try {
    await readFile(
      join(userHome, ".agents", "skills", "package-smoke", "SKILL.md"),
    );
    throw new Error("Packaged rollback left the fixture skill active");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  console.log(
    `Packaged CLI smoke passed on ${process.platform}, Node ${process.versions.node}.`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
