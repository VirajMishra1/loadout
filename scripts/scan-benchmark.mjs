import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "loadout-scan-benchmark-"));
const home = join(temporary, "home");
const state = join(temporary, "state");
const skills = join(home, ".agents", "skills");
const cli = join(root, "dist", "src", "cli.js");

function runScan() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "scan", "--json"], {
      cwd: root,
      env: {
        ...process.env,
        LOADOUT_USER_HOME: home,
        LOADOUT_HOME: state,
        NO_COLOR: "1",
      },
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
      if (code !== 0)
        return reject(
          new Error(`scan benchmark failed: ${stderr.slice(-2000)}`),
        );
      try {
        JSON.parse(stdout);
        resolve();
      } catch {
        reject(new Error("scan benchmark did not emit valid JSON"));
      }
    });
  });
}

try {
  await mkdir(skills, { recursive: true });
  for (let start = 0; start < 1_000; start += 100) {
    await Promise.all(
      Array.from({ length: 100 }, async (_, offset) => {
        const index = start + offset;
        const directory = join(
          skills,
          `benchmark-${String(index).padStart(4, "0")}`,
        );
        await mkdir(directory);
        await writeFile(
          join(directory, "SKILL.md"),
          `---\nname: benchmark-${index}\ndescription: Local scan performance fixture ${index}\n---\n\nRead-only benchmark input.\n`,
        );
      }),
    );
  }
  const samples = [];
  for (let index = 0; index < 7; index++) {
    const started = performance.now();
    await runScan();
    samples.push(performance.now() - started);
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  if (p95 >= 5_000)
    throw new Error(
      `Local scan p95 ${p95.toFixed(1)}ms exceeds the 5000ms beta budget`,
    );
  console.log(
    `Local scan benchmark passed: 1,000 skills, p95 ${p95.toFixed(1)}ms across ${samples.length} real CLI runs.`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
