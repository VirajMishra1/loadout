import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  mergeReviewQueue,
  readReviewQueue,
  setReviewDecision,
} from "../src/core/review-queue.js";
import type { CatalogPackage } from "../src/shared/types.js";

describe("candidate review queue", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("deduplicates sources, marks cataloged repos, and preserves human decisions", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-review-queue-"));
    process.env.LOADOUT_HOME = root;
    const catalog: CatalogPackage[] = [
      {
        id: "existing",
        displayName: "Existing",
        repository: "owner/existing",
        description: "existing",
        category: "skills",
        tier: "stable",
      },
    ];
    await mergeReviewQueue(
      [
        {
          source: "github-search",
          repository: "owner/new",
          title: "owner/new",
          description: "new",
          url: "https://github.com/owner/new",
          stars: 6000,
          forks: 10,
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-15T00:00:00Z",
          query: "skills",
        },
        {
          source: "github-search",
          repository: "owner/existing",
          title: "owner/existing",
          description: "existing",
          url: "https://github.com/owner/existing",
          stars: 5000,
          forks: 5,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-07-15T00:00:00Z",
          query: "skills",
        },
      ],
      catalog,
      new Date("2026-07-15T00:00:00Z"),
    );
    await setReviewDecision("owner/new", "shortlisted");
    await mergeReviewQueue(
      [
        {
          source: "hacker-news",
          repository: "OWNER/NEW",
          title: "Show HN",
          storyId: 1,
          storyUrl: "https://github.com/owner/new",
          discussionUrl: "https://news.ycombinator.com/item?id=1",
          score: 200,
          comments: 20,
          createdAt: "2026-07-15T00:00:00Z",
        },
      ],
      catalog,
      new Date("2026-07-16T00:00:00Z"),
    );

    const queue = await readReviewQueue();
    expect(queue.items).toHaveLength(2);
    expect(
      queue.items.find((item) => item.repository.toLowerCase() === "owner/new"),
    ).toMatchObject({
      decision: "shortlisted",
      sources: ["github-search", "hacker-news"],
      firstSeenAt: "2026-07-15T00:00:00.000Z",
      lastSeenAt: "2026-07-16T00:00:00.000Z",
    });
    expect(
      queue.items.find((item) => item.repository === "owner/existing"),
    ).toMatchObject({ alreadyCataloged: true });
  });
});
