import { describe, expect, it } from "vitest";
import {
  buildArtifact,
  discoveryQueries,
  replaceReadmeDiscoveryStatus,
  renderReadmeDiscoveryStatus,
  renderMarkdown,
  type DiscoveryArtifact,
  type SearchRepository,
} from "../scripts/daily-discovery.mjs";

function repository(
  name: string,
  stars: number,
  overrides: Partial<SearchRepository> = {},
): SearchRepository {
  return {
    full_name: name,
    html_url: `https://github.com/${name}`,
    description: `${name} description`,
    stargazers_count: stars,
    forks_count: 2,
    open_issues_count: 1,
    language: "TypeScript",
    license: { spdx_id: "MIT" },
    topics: ["mcp"],
    created_at: "2026-01-01T00:00:00Z",
    pushed_at: "2026-07-16T00:00:00Z",
    updated_at: "2026-07-16T00:00:00Z",
    default_branch: "main",
    ...overrides,
  };
}

function search(
  id: string,
  items: SearchRepository[],
): {
  id: string;
  label: string;
  query: string;
  count: number;
  items: SearchRepository[];
} {
  return { id, label: id, query: `topic:${id}`, count: items.length, items };
}

describe("daily GitHub discovery artifact", () => {
  it("uses deterministic rolling query windows without unsupported OR syntax", () => {
    const queries = discoveryQueries("2026-07-16");
    expect(queries).toHaveLength(8);
    expect(queries[0].query).toContain("pushed:>=2026-05-17");
    expect(queries.at(-1)?.query).toContain("created:>=2026-01-17");
    expect(queries.every((item) => !item.query.includes(" OR "))).toBe(true);
  });

  it("deduplicates searches, separates reviewed records, and calculates auditable velocity", () => {
    const previous = buildArtifact({
      day: "2026-07-14",
      queryResults: [search("mcp", [repository("owner/fast", 100)])],
      catalog: [],
    });
    const artifact = buildArtifact({
      day: "2026-07-16",
      queryResults: [
        search("mcp", [repository("owner/fast", 120)]),
        search("skills", [
          repository("owner/fast", 120),
          repository("owner/reviewed", 500),
        ]),
      ],
      catalog: [{ repository: "OWNER/REVIEWED" }],
      previous,
    });
    const fast = artifact.repositories.find(
      (item) => item.repository === "owner/fast",
    );
    expect(artifact.repositories).toHaveLength(2);
    expect(fast).toMatchObject({
      catalogStatus: "candidate",
      matchedQueries: ["mcp", "skills"],
      starVelocityPerDay: 10,
      starVelocityWindowDays: 2,
    });
    expect(fast?.starsPerDaySinceCreation).toBeGreaterThan(0);
    expect(
      artifact.repositories.find((item) => item.repository === "owner/reviewed")
        ?.catalogStatus,
    ).toBe("reviewed");
  });

  it("refuses an empty run rather than overwriting healthy evidence", () => {
    expect(() =>
      buildArtifact({
        day: "2026-07-16",
        queryResults: [search("mcp", [])],
        catalog: [],
      }),
    ).toThrow(/refusing to overwrite/);
  });

  it("bounds retained history and always keeps current results ahead of stale ones", () => {
    const generatedAt = "2026-07-16T00:00:00.000Z";
    const stale = Array.from({ length: 500 }, (_, index) => ({
      repository: `stale/repository-${index}`,
      url: `https://github.com/stale/repository-${index}`,
      description: "stale",
      stars: 1_000_000 - index,
      forks: 0,
      openIssues: 0,
      language: null,
      license: "MIT",
      topics: [],
      createdAt: "2026-01-01T00:00:00Z",
      pushedAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
      defaultBranch: "main",
      matchedQueries: ["old"],
      catalogStatus: "candidate" as const,
      firstSeenAt: "2026-07-01T00:00:00.000Z",
      lastSeenAt: "2026-07-15T00:00:00.000Z",
      seenInLatestRun: true,
      observations: Array.from({ length: 100 }, (_, day) => ({
        observedAt: new Date(
          Date.parse(generatedAt) - (100 - day) * 86_400_000,
        ).toISOString(),
        stars: day,
        forks: 0,
      })),
    }));
    const previous: DiscoveryArtifact = {
      schemaVersion: 1,
      generatedAt: "2026-07-15T00:00:00.000Z",
      policy: {},
      queries: [],
      statistics: {},
      repositories: stale,
    };
    const artifact = buildArtifact({
      day: "2026-07-16",
      queryResults: [
        search("mcp", [
          repository("current/one", 1),
          repository("current/two", 2),
        ]),
      ],
      catalog: [],
      previous,
    });
    expect(artifact.repositories).toHaveLength(500);
    expect(
      artifact.repositories.slice(0, 2).map((item) => item.repository),
    ).toEqual(["current/two", "current/one"]);
    expect(
      Math.max(
        ...artifact.repositories.map((item) => item.observations.length),
      ),
    ).toBeLessThanOrEqual(90);
  });

  it("renders linked candidates with an explicit non-promotion warning", () => {
    const artifact = buildArtifact({
      day: "2026-07-16",
      queryResults: [search("mcp", [repository("owner/candidate", 42)])],
      catalog: [],
    });
    const markdown = renderMarkdown(artifact);
    expect(markdown).toContain(
      "[owner/candidate](https://github.com/owner/candidate)",
    );
    expect(markdown).toContain("not installed, trusted, or promoted");
    expect(markdown).toContain("not evidence of current growth");
    expect(markdown).toContain("catalog/discovered.json");
  });

  it("surfaces a young breakout by honest lifetime average before day-two velocity exists", () => {
    const artifact = buildArtifact({
      day: "2026-07-16",
      queryResults: [
        search("skills", [
          repository("old/giant", 1_000_000, {
            created_at: "2010-01-01T00:00:00Z",
          }),
          repository("new/breakout", 10_000, {
            created_at: "2026-07-15T00:00:00Z",
          }),
        ]),
      ],
      catalog: [],
    });
    expect(artifact.repositories.map((item) => item.repository)).toEqual([
      "new/breakout",
      "old/giant",
    ]);
    expect(artifact.repositories[0].starsPerDaySinceCreation).toBeCloseTo(
      5_000,
    );
    expect(artifact.repositories[0].starVelocityPerDay).toBeUndefined();
  });

  it("updates only one guarded README status block", () => {
    const artifact = buildArtifact({
      day: "2026-07-16",
      queryResults: [search("mcp", [repository("owner/candidate", 42)])],
      catalog: [],
    });
    const before = `Human introduction\n\n<!-- loadout:daily-discovery:start -->\nstale\n<!-- loadout:daily-discovery:end -->\n\nHuman footer\n`;
    const after = replaceReadmeDiscoveryStatus(before, artifact);
    expect(after).toContain("Human introduction");
    expect(after).toContain("Human footer");
    expect(after).toContain("generated 2026-07-16");
    expect(after).toContain("1 repositories observed");
    expect(after).toContain("1 uncataloged review candidates");
    expect(after).toContain("repositories already in the inspected catalog");
    expect(after).not.toContain("repositories already in the reviewed catalog");
    expect(after).toContain(renderReadmeDiscoveryStatus(artifact));
  });

  it("refuses missing, reversed, or duplicate README markers", () => {
    const artifact = buildArtifact({
      day: "2026-07-16",
      queryResults: [search("mcp", [repository("owner/candidate", 42)])],
      catalog: [],
    });
    const start = "<!-- loadout:daily-discovery:start -->";
    const end = "<!-- loadout:daily-discovery:end -->";
    expect(() => replaceReadmeDiscoveryStatus("human prose", artifact)).toThrow(
      /exactly one ordered/,
    );
    expect(() =>
      replaceReadmeDiscoveryStatus(`${end}\n${start}`, artifact),
    ).toThrow(/exactly one ordered/);
    expect(() =>
      replaceReadmeDiscoveryStatus(
        `${start}\n${end}\n${start}\n${end}`,
        artifact,
      ),
    ).toThrow(/exactly one ordered/);
  });
});
