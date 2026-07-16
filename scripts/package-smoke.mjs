import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), "loadout-package-smoke-"));

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
  if (!/^0\.1\.0\s*$/.test(version.stdout))
    throw new Error(`Unexpected packaged version: ${version.stdout}`);
  const coverage = await run(
    process.execPath,
    [cli, "catalog", "--coverage", "--json"],
    { cwd: packageRoot, env: environment },
  );
  const coverageResult = JSON.parse(coverage.stdout);
  if (coverageResult.records < 50 || coverageResult.immutablePins < 50)
    throw new Error("Packaged catalog evidence is incomplete");

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
