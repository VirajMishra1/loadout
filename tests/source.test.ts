import { describe, expect, it } from "vitest";
import { fetchGitSnapshot, fetchRepositorySnapshot, normalizeRepository } from "../src/core/source.js";

describe("repository sources", () => {
  it("normalizes supported GitHub references", () => {
    expect(normalizeRepository("https://github.com/obra/superpowers.git")).toBe("obra/superpowers");
    expect(normalizeRepository("git@github.com:upstash/context7.git")).toBe("upstash/context7");
  });

  it("rejects non-GitHub or malformed references", () => {
    expect(() => normalizeRepository("https://example.com/tool.git")).toThrow();
    expect(() => normalizeRepository("owner/repo/extra")).toThrow();
  });

  it("rejects unsafe Git refs before invoking Git", async () => {
    await expect(fetchRepositorySnapshot("owner/repo", { ref: "--upload-pack=bad" })).rejects.toThrow(/Invalid Git ref/);
    await expect(fetchRepositorySnapshot("owner/repo", { ref: "../escape" })).rejects.toThrow(/Invalid Git ref/);
  });

  it("rejects local, insecure, and option-like generic Git sources", async () => {
    await expect(fetchGitSnapshot("file:///tmp/repo")).rejects.toThrow(/HTTPS or SSH/);
    await expect(fetchGitSnapshot("http://example.com/repo.git")).rejects.toThrow(/HTTPS or SSH/);
    await expect(fetchGitSnapshot("--upload-pack=bad")).rejects.toThrow(/Invalid Git URL/);
  });

  it("rejects credential-bearing generic Git URLs before invoking Git", async () => {
    await expect(fetchGitSnapshot("https://token:secret@example.com/team/repo.git")).rejects.toThrow(/must not embed credentials/);
    await expect(fetchGitSnapshot("https://token@example.com/team/repo.git")).rejects.toThrow(/must not embed credentials/);
  });
});
