import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "..");

describe("README product flow", () => {
  it("describes the harness as mixed core integration and CLI coverage", async () => {
    const readme = await readFile(resolve(repositoryRoot, "README.md"), "utf8");
    const prose = readme.replace(/\s+/g, " ");
    expect(prose).toContain("mixed core-integration/CLI flow");
    expect(prose).toContain(
      "Direct core calls cover fixture planning, library installation, manifest/lock generation, and audit; CLI subprocesses cover optimize preview/apply, card rendering, and rollback.",
    );
    expect(prose).not.toContain("two real CLI product flows");
  });

  it("builds independently of repository dist and proves the documented outcomes offline", async () => {
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
      build: "isolated",
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

  it.runIf(process.env.LOADOUT_TEST_LIVE_CATALOG === "1")(
    "proves pinned Stable catalog installation before the local rollback journey",
    async () => {
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          resolve(repositoryRoot, "scripts/readme-product-flow.mjs"),
          "--live-catalog",
          "--json",
        ],
        {
          cwd: repositoryRoot,
          timeout: 240_000,
          maxBuffer: 10 * 1024 * 1024,
        },
      );
      const result = JSON.parse(stdout);
      expect(result).toMatchObject({
        build: "isolated",
        mode: "live-catalog",
        liveCatalog: {
          pinnedCommits: true,
          persistedRecords: true,
          fileHashes: true,
          snapshot: true,
          rollback: true,
          filesystemRestoration: true,
        },
      });
      expect(result.liveCatalog.packages).toBeGreaterThan(0);
    },
    245_000,
  );
});
