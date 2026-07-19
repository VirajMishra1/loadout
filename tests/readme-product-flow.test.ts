import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "..");

describe("README product flow", () => {
  it("proves the documented install, library, activation, privacy, and rollback outcomes offline", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [resolve(repositoryRoot, "scripts/readme-product-flow.mjs"), "--json"],
      {
        cwd: repositoryRoot,
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    expect(JSON.parse(stdout)).toMatchObject({
      mode: "offline-fixture",
      verified: {
        stateDirectories: true,
        installRecords: true,
        fileHashes: true,
        snapshots: true,
        libraryTransitions: true,
        manifestLockConsistency: true,
        privacySafeCard: true,
        rollbackRestoration: true,
        unmanagedSentinelPreserved: true,
      },
    });
  }, 35_000);
});
