import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import {
  fetchGitSnapshot,
  fetchRepositorySnapshot,
  normalizeRepository,
  parseRepositoryHead,
  repositoryCachePath,
  validateGitHubTreeBounds,
} from "../src/core/source.js";

const exec = promisify(execFile);

describe("repository sources", () => {
  it("normalizes supported GitHub references", () => {
    expect(normalizeRepository("https://github.com/obra/superpowers.git")).toBe(
      "obra/superpowers",
    );
    expect(normalizeRepository("git@github.com:upstash/context7.git")).toBe(
      "upstash/context7",
    );
  });

  it("rejects non-GitHub or malformed references", () => {
    expect(() => normalizeRepository("https://example.com/tool.git")).toThrow();
    expect(() => normalizeRepository("owner/repo/extra")).toThrow();
  });

  it("parses only a full SHA bound to the remote HEAD ref", () => {
    const commit = "a".repeat(40);
    expect(
      parseRepositoryHead(
        "owner/repo",
        `ref: refs/heads/main\tHEAD\n${commit}\tHEAD\n`,
      ),
    ).toBe(commit);
    expect(() =>
      parseRepositoryHead("owner/repo", "ref: refs/heads/main\tHEAD\n"),
    ).toThrow(/invalid default-branch HEAD/);
  });

  it("rejects unsafe Git refs before invoking Git", async () => {
    await expect(
      fetchRepositorySnapshot("owner/repo", { ref: "--upload-pack=bad" }),
    ).rejects.toThrow(/Invalid Git ref/);
    await expect(
      fetchRepositorySnapshot("owner/repo", { ref: "../escape" }),
    ).rejects.toThrow(/Invalid Git ref/);
  });

  it("reuses a clean cache only when it matches the exact reviewed commit", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-source-cache-"));
    const previous = process.env.LOADOUT_HOME;
    process.env.LOADOUT_HOME = join(root, ".loadout");
    try {
      const repository = join(root, "repository");
      await mkdir(repository);
      await exec("git", ["init", "--quiet", repository]);
      await exec("git", [
        "-C",
        repository,
        "config",
        "user.email",
        "test@example.com",
      ]);
      await exec("git", [
        "-C",
        repository,
        "config",
        "user.name",
        "Loadout Test",
      ]);
      await writeFile(join(repository, "SKILL.md"), "reviewed\n");
      await exec("git", ["-C", repository, "add", "SKILL.md"]);
      await exec("git", [
        "-C",
        repository,
        "commit",
        "--quiet",
        "-m",
        "fixture",
      ]);
      const { stdout } = await exec("git", [
        "-C",
        repository,
        "rev-parse",
        "HEAD",
      ]);
      const commit = stdout.trim();
      const cached = repositoryCachePath("example/unpublished-fixture", commit);
      await mkdir(dirname(cached), { recursive: true });
      await rename(repository, cached);

      await expect(
        fetchRepositorySnapshot("example/unpublished-fixture", { ref: commit }),
      ).resolves.toEqual({
        repository: "example/unpublished-fixture",
        commit,
        path: cached,
      });
      await expect(
        fetchRepositorySnapshot("example/unpublished-fixture", {
          ref: commit,
          maxBytes: 1,
          maxFiles: 10,
          timeoutMs: 5_000,
        }),
      ).rejects.toThrow(/byte inspection limit/);
    } finally {
      if (previous === undefined) delete process.env.LOADOUT_HOME;
      else process.env.LOADOUT_HOME = previous;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects local, insecure, and option-like generic Git sources", async () => {
    await expect(fetchGitSnapshot("file:///tmp/repo")).rejects.toThrow(
      /HTTPS or SSH/,
    );
    await expect(
      fetchGitSnapshot("http://example.com/repo.git"),
    ).rejects.toThrow(/HTTPS or SSH/);
    await expect(fetchGitSnapshot("--upload-pack=bad")).rejects.toThrow(
      /Invalid Git URL/,
    );
    await expect(
      fetchGitSnapshot("https://example.com/repo.git", { maxBytes: 1 }),
    ).rejects.toThrow(/refusing an unbounded generic Git clone/);
  });

  it("rejects credential-bearing generic Git URLs before invoking Git", async () => {
    await expect(
      fetchGitSnapshot("https://token:secret@example.com/team/repo.git"),
    ).rejects.toThrow(/must not embed credentials/);
    await expect(
      fetchGitSnapshot("https://token@example.com/team/repo.git"),
    ).rejects.toThrow(/must not embed credentials/);
  });

  it("rejects oversized or truncated GitHub trees before checkout", () => {
    expect(() =>
      validateGitHubTreeBounds(
        {
          truncated: false,
          tree: [
            { type: "blob", path: "one", size: 6 },
            { type: "blob", path: "two", size: 6 },
          ],
        },
        { maxBytes: 10, maxFiles: 10 },
      ),
    ).toThrow(/byte inspection limit/);
    expect(() =>
      validateGitHubTreeBounds(
        {
          truncated: false,
          tree: [
            { type: "blob", path: "one", size: 1 },
            { type: "blob", path: "two", size: 1 },
          ],
        },
        { maxBytes: 10, maxFiles: 1 },
      ),
    ).toThrow(/file inspection limit/);
    expect(() =>
      validateGitHubTreeBounds(
        { truncated: true, tree: [] },
        { maxBytes: 10, maxFiles: 1 },
      ),
    ).toThrow(/truncated/);
  });
});
