import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fetchGitHubMetadata } from "../src/core/github.js";

describe("GitHub metadata", () => {
  let home: string;
  afterEach(async () => { if (home) await rm(home, { recursive: true, force: true }); delete process.env.LOADOUT_HOME; });
  it("fetches and caches real API-shaped metadata", async () => {
    home = await mkdtemp(`${tmpdir()}/loadout-github-`); process.env.LOADOUT_HOME = home;
    let calls = 0;
    const fetcher = async () => { calls++; return new Response(JSON.stringify({ stargazers_count: 42, description: "x", default_branch: "main", topics: ["ai"], open_issues_count: 2, archived: false, updated_at: "2025-01-01T00:00:00Z", pushed_at: "2025-01-02T00:00:00Z" }), { status: 200 }); };
    const first = await fetchGitHubMetadata("owner/repo", { fetcher });
    const second = await fetchGitHubMetadata("owner/repo", { fetcher });
    expect(first.stars).toBe(42); expect(second.repository).toBe("owner/repo"); expect(calls).toBe(1);
  });
  it("uses stale cache when GitHub is rate limited", async () => {
    home = await mkdtemp(`${tmpdir()}/loadout-github-`); process.env.LOADOUT_HOME = home;
    const fetcher = async () => new Response("rate limited", { status: 429 });
    await expect(fetchGitHubMetadata("owner/repo", { fetcher })).rejects.toThrow(/rate limit/);
  });
});
