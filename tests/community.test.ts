import { describe, expect, it } from "vitest";
import { discoverHackerNewsRepositories } from "../src/core/community.js";

describe("Hacker News community discovery", () => {
  it("returns only scored GitHub repository leads with source evidence", async () => {
    const result = await discoverHackerNewsRepositories({
      limit: 3,
      minScore: 10,
      fetcher: async (input) => {
        const url = String(input);
        if (url.endsWith("/topstories.json"))
          return new Response(JSON.stringify([11, 12, 13]));
        if (url.endsWith("/item/11.json"))
          return new Response(
            JSON.stringify({
              id: 11,
              type: "story",
              title: "Show HN: Useful skills",
              url: "https://github.com/acme/skills",
              score: 42,
              descendants: 9,
              time: 1_700_000_000,
            }),
          );
        if (url.endsWith("/item/12.json"))
          return new Response(
            JSON.stringify({
              id: 12,
              type: "story",
              title: "No repository",
              score: 100,
              time: 1_700_000_000,
            }),
          );
        return new Response(
          JSON.stringify({
            id: 13,
            type: "story",
            title: "Too early",
            text: '<a href="https://github.com/acme/other">repo</a>',
            score: 9,
            time: 1_700_000_000,
          }),
        );
      },
    });
    expect(result.storiesScanned).toBe(3);
    expect(result.candidates).toEqual([
      expect.objectContaining({
        repository: "acme/skills",
        score: 42,
        discussionUrl: "https://news.ycombinator.com/item?id=11",
      }),
    ]);
  });

  it("deduplicates repeated repository mentions by strongest story", async () => {
    const result = await discoverHackerNewsRepositories({
      limit: 2,
      minScore: 0,
      fetcher: async (input) => {
        const url = String(input);
        if (url.endsWith("/topstories.json"))
          return new Response(JSON.stringify([1, 2]));
        const id = Number(url.match(/item\/(\d+)/)?.[1]);
        return new Response(
          JSON.stringify({
            id,
            type: "story",
            title: `Story ${id}`,
            url: "https://github.com/acme/skills/issues/4",
            score: id,
            time: 1_700_000_000,
          }),
        );
      },
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      repository: "acme/skills",
      storyId: 2,
    });
  });

  it("reports an actionable official-API failure", async () => {
    await expect(
      discoverHackerNewsRepositories({
        fetcher: async () => new Response("unavailable", { status: 503 }),
      }),
    ).rejects.toThrow("Hacker News top stories request failed (503)");
  });
});
