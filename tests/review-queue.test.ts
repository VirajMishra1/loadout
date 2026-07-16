import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatReviewQueue,
  mergeReviewQueue,
  readReviewQueue,
  setReviewDecision,
} from "../src/core/review-queue.js";
import type { CatalogPackage } from "../src/shared/types.js";
import type { SkillsShDiscoveryRecord } from "../src/core/skills-sh-discovery.js";
import type { McpRegistryDiscoveryRecord } from "../src/core/mcp-registry-discovery.js";

describe("candidate review queue", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    delete process.env.LOADOUT_HOME;
  });

  it("deduplicates connector repository identities without converting telemetry into stars", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-review-connectors-"));
    process.env.LOADOUT_HOME = root;
    const observedAt = "2026-07-16T00:00:00.000Z";
    const skills = {
      source: "skills-sh",
      kind: "skill",
      identityKey: "skills-sh:owner/repo/react",
      repositoryKey: "github:owner/repo",
      externalId: "owner/repo/react",
      slug: "react",
      name: "React",
      sourceName: "owner/repo",
      sourceType: "github",
      installUrl: "https://github.com/owner/repo",
      sourceUrl: "https://skills.sh/owner/repo/react",
      installs: 1200,
      isDuplicate: false,
      repository: {
        repository: "owner/repo",
        url: "https://github.com/owner/repo",
        immutable: false,
        limitation: "No immutable commit is supplied.",
      },
      ranking: {
        provider: "skills.sh",
        view: "trending",
        position: 2,
        installs: 1200,
        meaning: "install telemetry",
        uncertainty: "not quality or safety evidence",
      },
      attribution: {
        source: "skills-sh",
        sourceUrl: "https://skills.sh/docs/api",
        observedAt,
        meaning: "skills.sh install telemetry",
      },
    } satisfies SkillsShDiscoveryRecord;
    const mcp = {
      source: "official-mcp-registry",
      kind: "mcp-server",
      identityKey: "mcp-registry:io.github.owner/repo@1.0.0",
      repositoryKey: "github:owner/repo",
      externalId: "io.github.owner/repo@1.0.0",
      namespace: "io.github.owner",
      name: "io.github.owner/repo",
      title: "Owner MCP",
      description: "Reviewed later",
      version: "1.0.0",
      sourceUrl:
        "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.owner/repo/versions/1.0.0",
      repository: {
        url: "https://github.com/owner/repo",
        source: "github",
        repository: "OWNER/REPO",
      },
      distributions: [],
      verification: {
        registry: "Official MCP Registry",
        lifecycleStatus: "active",
        meaning: "identity and distribution evidence only",
        namespaceEvidence: "official registry namespace",
      },
      attribution: {
        source: "official-mcp-registry",
        sourceUrl: "https://registry.modelcontextprotocol.io/docs",
        observedAt,
        meaning: "official registry metadata",
      },
    } satisfies McpRegistryDiscoveryRecord;
    const queue = await mergeReviewQueue(
      [skills, mcp],
      [],
      new Date(observedAt),
    );
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({
      repository: "OWNER/REPO",
      sources: ["skills-sh", "official-mcp-registry"],
      installs: 1200,
      registryVersion: "1.0.0",
      lifecycleStatus: "active",
    });
    expect(queue.items[0].stars).toBeUndefined();
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

  it("uses an auditable GitHub-star velocity only after a full-day interval", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-review-velocity-"));
    process.env.LOADOUT_HOME = root;
    await mergeReviewQueue(
      [
        {
          source: "github-search",
          repository: "owner/fast",
          title: "fast",
          description: "",
          url: "https://github.com/owner/fast",
          stars: 100,
          forks: 0,
          createdAt: "",
          updatedAt: "",
          query: "skills",
        },
      ],
      [],
      new Date("2026-07-15T00:00:00Z"),
    );
    const subDay = await mergeReviewQueue(
      [
        {
          source: "github-search",
          repository: "owner/fast",
          title: "fast",
          description: "",
          url: "https://github.com/owner/fast",
          stars: 112,
          forks: 0,
          createdAt: "",
          updatedAt: "",
          query: "skills",
        },
      ],
      [],
      new Date("2026-07-15T12:00:00Z"),
    );
    expect(subDay.items[0]).toMatchObject({
      stars: 112,
      starVelocityBaselineStars: 100,
      starVelocityBaselineAt: "2026-07-15T00:00:00.000Z",
    });
    expect(subDay.items[0].starVelocity).toBeUndefined();
    const queue = await mergeReviewQueue(
      [
        {
          source: "github-search",
          repository: "owner/fast",
          title: "fast",
          description: "",
          url: "https://github.com/owner/fast",
          stars: 124,
          forks: 0,
          createdAt: "",
          updatedAt: "",
          query: "skills",
        },
      ],
      [],
      new Date("2026-07-17T00:00:00Z"),
    );
    expect(queue.items[0]).toMatchObject({
      stars: 124,
      starVelocity: 12,
      starVelocityWindowDays: 2,
      starVelocityMeasuredAt: "2026-07-17T00:00:00.000Z",
      starVelocityBaselineStars: 124,
      starVelocityBaselineAt: "2026-07-17T00:00:00.000Z",
    });
    expect(formatReviewQueue(queue)).toContain("+12.0/day over 2.00 days");
  });

  it("sorts ignored candidates behind pending candidates even when they are faster", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-review-decisions-"));
    process.env.LOADOUT_HOME = root;
    const lead = (repository: string, stars: number) => ({
      source: "github-search" as const,
      repository,
      title: repository,
      description: "",
      url: `https://github.com/${repository}`,
      stars,
      forks: 0,
      createdAt: "",
      updatedAt: "",
      query: "skills",
    });
    await mergeReviewQueue(
      [lead("owner/fast", 100), lead("owner/pending", 10)],
      [],
      new Date("2026-07-15T00:00:00Z"),
    );
    await setReviewDecision("owner/fast", "ignored");
    expect(
      (await readReviewQueue()).items.map((item) => item.repository),
    ).toEqual(["owner/pending", "owner/fast"]);
    const queue = await mergeReviewQueue(
      [lead("owner/fast", 300), lead("owner/pending", 11)],
      [],
      new Date("2026-07-17T00:00:00Z"),
    );
    expect(queue.items.map((item) => item.repository)).toEqual([
      "owner/pending",
      "owner/fast",
    ]);
  });
});
