import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseLiveCheckReport } from "../scripts/check-live-evidence.mjs";
import {
  RELEASE_CLAIMS,
  auditReleaseClaims,
} from "../src/core/release-claims.js";

describe("release claim evidence gate", () => {
  it("links every bounded public claim to present evidence and current counts", async () => {
    const catalog = JSON.parse(
      await readFile("catalog/packages.json", "utf8"),
    ) as unknown[];
    const index = await auditReleaseClaims({
      root: process.cwd(),
      readme: await readFile("README.md", "utf8"),
      catalogCount: catalog.length,
    });
    expect(index.releaseBlocked).toBe(false);
    expect(index.blockers).toEqual([]);
    expect(index.claims).toHaveLength(RELEASE_CLAIMS.length);
    expect(
      index.claims.find(
        (claim) => claim.id === "benchmark-performance-evidence",
      ),
    ).toMatchObject({ status: "not-established" });
  });

  it("rejects absolute claims, stale counts, unsafe paths, and missing evidence", async () => {
    const index = await auditReleaseClaims({
      root: process.cwd(),
      readme: "Loadout is universally best and guaranteed safe.",
      catalogCount: 999,
      claims: [
        {
          id: "bad",
          status: "supported",
          statement: "Bad",
          boundary: "Missing",
          evidence: {
            files: ["../secret", "missing.file"],
            commands: [],
            sources: [],
          },
        },
      ],
    });
    expect(index.releaseBlocked).toBe(true);
    expect(index.blockers.join("\n")).toMatch(
      /universally best|guaranteed safe|catalog count|unsafe evidence path|missing\.file/,
    );
  });

  it("binds the current review to a reachable tested commit and a strict historical live report", async () => {
    const review = await readFile("docs/RELEASE_REVIEW.md", "utf8");
    const testedCommit = /exact tested commit\s+`([0-9a-f]{40})`/i.exec(
      review,
    )?.[1];
    expect(testedCommit).toBeTruthy();
    expect(() =>
      execFileSync("git", ["cat-file", "-e", `${testedCommit}^{commit}`], {
        stdio: "pipe",
      }),
    ).not.toThrow();

    const live = JSON.parse(
      await readFile("docs/evidence/live-checks-2026-07-19.json", "utf8"),
    );
    expect(() =>
      parseLiveCheckReport(live, ["npm", "stable-install", "github"]),
    ).not.toThrow();
    expect(review).toContain("./evidence/live-checks-2026-07-19.json");
    expect(review).toContain(live.generatedAt);
  });
});
