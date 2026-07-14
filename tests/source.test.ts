import { describe, expect, it } from "vitest";
import { fetchRepositorySnapshot, normalizeRepository } from "../src/core/source.js";

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
});
