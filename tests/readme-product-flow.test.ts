import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "..");

describe("README product flow", () => {
  it("presents the approved proof-first product journey", async () => {
    const readme = await readFile(resolve(repositoryRoot, "README.md"), "utf8");

    expect(readme).toContain("./docs/assets/loadout-mark.svg");
    expect(readme).toContain("Agent extensions, under control.");
    expect(readme).toContain("Choose -> Inspect -> Preview -> Apply -> Undo");
    expect(readme).toMatch(/abridged terminal transcript/i);
    expect(readme).toMatch(
      /npm install --global loadout-ai@0\.3\.2[^\n]*(?:not currently published|unavailable)|(?:not currently published|unavailable)[^\n]*npm install --global loadout-ai@0\.3\.2/i,
    );

    for (const name of [
      "catalog-coverage",
      "evidence-stages",
      "daily-discovery",
      "support-summary",
      "current-limits",
      "verification-summary",
    ]) {
      expect(
        readme.match(new RegExp(`<!-- loadout:${name}:start -->`, "g")),
      ).toHaveLength(1);
      expect(
        readme.match(new RegExp(`<!-- loadout:${name}:end -->`, "g")),
      ).toHaveLength(1);
    }
  });

  it("links concise README verification guidance to the detailed testing contract", async () => {
    const readme = await readFile(resolve(repositoryRoot, "README.md"), "utf8");
    expect(readme).toMatch(/\[[^\]]*testing[^\]]*\]\(\.\/docs\/TESTING\.md\)/i);
  });

  it("builds independently of repository dist and proves the documented outcomes offline", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [resolve(repositoryRoot, "scripts/readme-product-flow.mjs"), "--json"],
      {
        cwd: repositoryRoot,
        timeout: 60_000,
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
  }, 65_000);

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
