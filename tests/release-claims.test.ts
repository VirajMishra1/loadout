import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLiveCheckReport } from "../scripts/check-live-evidence.mjs";
import {
  assertRepositoryCommitIsAncestor,
  validateReleaseEvidenceBindings,
} from "../scripts/check-release-claims.js";
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
      assertRepositoryCommitIsAncestor(process.cwd(), testedCommit!),
    ).not.toThrow();

    const live = JSON.parse(
      await readFile("docs/evidence/live-checks-2026-07-19.json", "utf8"),
    );
    expect(() =>
      parseLiveCheckReport(live, ["npm", "stable-install", "github"]),
    ).not.toThrow();
    expect(() =>
      assertRepositoryCommitIsAncestor(process.cwd(), live.repositoryCommit),
    ).not.toThrow();
    expect(review).toContain("./evidence/live-checks-2026-07-19.json");
    expect(review).toContain(live.generatedAt);
  });

  it("rejects nonexistent and unreachable evidence commits", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-release-commit-"));
    try {
      execFileSync("git", ["init", "--quiet", root]);
      await writeFile(join(root, "main.txt"), "main\n");
      execFileSync("git", ["-C", root, "add", "main.txt"]);
      execFileSync("git", [
        "-C",
        root,
        "-c",
        "user.name=fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "main",
      ]);
      const main = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim();
      execFileSync("git", ["-C", root, "checkout", "--orphan", "side"], {
        stdio: "pipe",
      });
      await writeFile(join(root, "side.txt"), "side\n");
      execFileSync("git", ["-C", root, "add", "side.txt"]);
      execFileSync("git", [
        "-C",
        root,
        "-c",
        "user.name=fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "side",
      ]);

      expect(() =>
        assertRepositoryCommitIsAncestor(root, "f".repeat(40)),
      ).toThrow(/does not exist/i);
      expect(() => assertRepositoryCommitIsAncestor(root, main)).toThrow(
        /not an ancestor/i,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a live artifact bound to a different valid ancestor than the deterministic run", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-release-mismatch-"));
    try {
      execFileSync("git", ["init", "--quiet", root]);
      await writeFile(join(root, "first.txt"), "first\n");
      execFileSync("git", ["-C", root, "add", "first.txt"]);
      const commit = (message: string) =>
        execFileSync("git", [
          "-C",
          root,
          "-c",
          "user.name=fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "commit",
          "--quiet",
          "-m",
          message,
        ]);
      commit("first");
      const testedCommit = execFileSync(
        "git",
        ["-C", root, "rev-parse", "HEAD"],
        { encoding: "utf8" },
      ).trim();
      await writeFile(join(root, "second.txt"), "second\n");
      execFileSync("git", ["-C", root, "add", "second.txt"]);
      commit("second");
      const liveCommit = execFileSync(
        "git",
        ["-C", root, "rev-parse", "HEAD"],
        { encoding: "utf8" },
      ).trim();
      await mkdir(join(root, "docs", "evidence"), { recursive: true });
      await writeFile(
        join(root, "docs", "RELEASE_REVIEW.md"),
        `Exact tested commit \`${testedCommit}\`.\n`,
      );
      await writeFile(
        join(root, "docs", "evidence", "live-checks-2026-07-19.json"),
        JSON.stringify({
          schemaVersion: 1,
          generatedAt: "2026-07-19T13:45:14.945Z",
          repositoryCommit: liveCommit,
          checks: [
            { id: "npm", status: "failed", detail: "historical fixture" },
            {
              id: "stable-install",
              status: "verified",
              detail: "historical fixture",
            },
            {
              id: "github",
              status: "failed",
              detail: "historical fixture",
            },
          ],
        }),
      );

      await expect(validateReleaseEvidenceBindings(root)).rejects.toThrow(
        /same repository commit/i,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
