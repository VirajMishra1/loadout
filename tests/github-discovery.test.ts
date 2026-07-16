import { describe, expect, it } from "vitest";
import {
  defaultGitHubDiscoveryQuery,
  defaultGitHubDiscoveryQueries,
  discoverGitHubRepositories,
} from "../src/core/github-discovery.js";

describe("GitHub public repository discovery", () => {
  it("uses a rolling six-month default window", () => {
    expect(
      defaultGitHubDiscoveryQuery(new Date("2026-07-16T00:00:00Z")),
    ).toContain("created:>=2026-01-17");
    expect(
      defaultGitHubDiscoveryQueries(new Date("2026-07-16T00:00:00Z")),
    ).toEqual([
      "topic:mcp created:>=2026-01-17",
      "topic:ai-agent created:>=2026-01-17",
      "topic:agent-skills created:>=2026-01-17",
    ]);
  });

  it("merges the valid built-in topic queries, deduplicates, and ranks globally", async () => {
    const requested: string[] = [];
    const result = await discoverGitHubRepositories({
      queries: defaultGitHubDiscoveryQueries(new Date("2026-07-16T00:00:00Z")),
      limit: 2,
      fetcher: async (input) => {
        const url = new URL(String(input));
        const query = url.searchParams.get("q")!;
        requested.push(query);
        const topic = query.match(/^topic:([^ ]+)/)?.[1];
        return new Response(
          JSON.stringify({
            items:
              topic === "mcp"
                ? [
                    repository("acme/shared", 20, 1),
                    repository("acme/mcp", 10, 1),
                  ]
                : topic === "ai-agent"
                  ? [
                      repository("acme/agent", 30, 1),
                      repository("ACME/shared", 20, 1),
                    ]
                  : [repository("acme/skills", 25, 1)],
          }),
        );
      },
    });
    expect(requested).toEqual(
      defaultGitHubDiscoveryQueries(new Date("2026-07-16T00:00:00Z")),
    );
    expect(result.map((lead) => lead.repository)).toEqual([
      "acme/agent",
      "acme/skills",
    ]);
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

function repository(fullName: string, stars: number, forks: number) {
  return {
    full_name: fullName,
    html_url: `https://github.com/${fullName}`,
    stargazers_count: stars,
    forks_count: forks,
    description: fullName,
    created_at: "2026-07-02T00:00:00Z",
    updated_at: "2026-07-15T00:00:00Z",
  };
}
