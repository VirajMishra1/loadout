import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDashboardServer } from "../../src/dashboard.js";

const sandbox = await mkdtemp(join(tmpdir(), "loadout-dashboard-e2e-"));
const loadoutHome = join(sandbox, "loadout-home");
const userHome = join(sandbox, "user-home");
const manifestPath = join(sandbox, "loadout.json");
const lockPath = join(sandbox, "loadout.lock");

// These overrides are deliberately set before serving a request. Every
// Loadout read/write made by this process stays in its disposable sandbox.
process.env.LOADOUT_HOME = loadoutHome;
process.env.LOADOUT_USER_HOME = userHome;
await Promise.all([
  mkdir(loadoutHome, { recursive: true }),
  mkdir(userHome, { recursive: true }),
]);
await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      name: "isolated-dashboard-first-run",
      scope: "project",
      agents: [],
      packages: [],
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const port = Number(process.env.LOADOUT_E2E_PORT ?? "4173");
const dashboard = await startDashboardServer({ manifestPath, lockPath }, port);
console.log(
  `Isolated dashboard test server: http://${dashboard.host}:${dashboard.port}`,
);

let closing = false;
async function close(exitCode: number): Promise<void> {
  if (closing) return;
  closing = true;
  try {
    await dashboard.close();
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
  process.exit(exitCode);
}

process.once("SIGINT", () => void close(0));
process.once("SIGTERM", () => void close(0));
process.once("uncaughtException", (error) => {
  console.error(error);
  void close(1);
});
process.once("unhandledRejection", (error) => {
  console.error(error);
  void close(1);
});
