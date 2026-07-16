import { describe, expect, it } from "vitest";
import {
  defaultGitHubDiscoveryQuery,
  discoverGitHubRepositories,
} from "../src/core/github-discovery.js";

describe("GitHub public repository discovery", () => {
  it("uses a rolling six-month default window", () => {
    expect(
      defaultGitHubDiscoveryQuery(new Date("2026-07-16T00:00:00Z")),
    ).toContain("created:>=2026-01-17");
  });
  it("uses the official search endpoint and returns no credentials", async () => {
    let requested = "";
    const result = await discoverGitHubRepositories({
      query: "topic:mcp created:>=2026-07-01",
      limit: 1,
      token: "ephemeral-token",
      fetcher: async (input, init) => {
        requested = `${String(input)} ${new Headers(init?.headers).get("authorization")}`;
        return new Response(
          JSON.stringify({
            items: [
              {
                full_name: "acme/new-mcp",
                html_url: "https://github.com/acme/new-mcp",
                stargazers_count: 88,
                forks_count: 7,
                description: "A new MCP server",
                created_at: "2026-07-02T00:00:00Z",
                updated_at: "2026-07-15T00:00:00Z",
              },
            ],
          }),
        );
      },
    });
    expect(result).toEqual([
      expect.objectContaining({ repository: "acme/new-mcp", stars: 88 }),
    ]);
    expect(requested).toContain("topic%3Amcp");
    expect(JSON.stringify(result)).not.toContain("ephemeral-token");
  });

  it("reports an actionable rate-limit reset", async () => {
    await expect(
      discoverGitHubRepositories({
        query: "topic:skills",
        fetcher: async () =>
          new Response("limited", {
            status: 403,
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": String(
                Date.parse("2026-07-16T12:00:00Z") / 1000,
              ),
            },
          }),
      }),
    ).rejects.toThrow(/rate limit exhausted.*2026-07-16T12:00:00/);
  });
});
