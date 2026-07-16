import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverSkillsSh } from "../src/core/skills-sh-discovery.js";

const observedAt = new Date("2026-07-16T12:00:00.000Z");

function skill(
  id: string,
  installs: number,
  overrides: Record<string, unknown> = {},
) {
  const parts = id.split("/");
  const slug = parts.at(-1)!;
  const source = parts.slice(0, -1).join("/");
  return {
    id,
    slug,
    name: slug,
    source,
    installs,
    sourceType: "github",
    installUrl: `https://github.com/${source}`,
    url: `https://skills.sh/${id}`,
    ...overrides,
  };
}

function page(
  data: unknown[],
  pageNumber: number,
  hasMore: boolean,
  perPage = 2,
) {
  return new Response(
    JSON.stringify({
      data,
      pagination: {
        page: pageNumber,
        perPage,
        total: 10,
        hasMore,
      },
    }),
    {
      headers: {
        "content-type": "application/json",
        "x-ratelimit-limit": "600",
        "x-ratelimit-remaining": "599",
        "x-ratelimit-reset": "60",
      },
    },
  );
}

describe("skills.sh discovery connector", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  it("paginates the documented API, preserves ranking meaning, and deduplicates identities", async () => {
    const requests: Array<{ url: URL; authorization: string | null }> = [];
    const result = await discoverSkillsSh({
      view: "hot",
      token: "request-scoped-token",
      pageSize: 2,
      maxPages: 4,
      cachePath: false,
      now: observedAt,
      fetcher: async (input, init) => {
        const url = new URL(String(input));
        requests.push({
          url,
          authorization: new Headers(init?.headers).get("authorization"),
        });
        const number = Number(url.searchParams.get("page"));
        return number === 0
          ? page(
              [
                skill("acme/skills/react", 100, {
                  installsYesterday: 4,
                  change: 7,
                }),
                skill("acme/skills/testing", 90),
              ],
              0,
              true,
            )
          : page(
              [
                skill("acme/skills/react", 110),
                {
                  id: "mintlify.com/mintlify",
                  slug: "mintlify",
                  name: "Mintlify",
                  source: "mintlify.com",
                  installs: 80,
                  sourceType: "well-known",
                  installUrl: "https://mintlify.com",
                  url: "https://skills.sh/mintlify.com/mintlify",
                },
              ],
              1,
              false,
            );
      },
    });

    expect(requests).toHaveLength(2);
    expect(requests[0].url.pathname).toBe("/api/v1/skills");
    expect(requests[0].url.searchParams.get("view")).toBe("hot");
    expect(requests[0].authorization).toBe("Bearer request-scoped-token");
    expect(result.status).toBe("partial");
    expect(result.records.map((record) => record.externalId)).toEqual([
      "acme/skills/react",
      "acme/skills/testing",
      "mintlify.com/mintlify",
    ]);
    expect(result.records[0]).toMatchObject({
      repositoryKey: "github:acme/skills",
      repository: { immutable: false },
      ranking: {
        view: "hot",
        position: 1,
        installs: 100,
        installsYesterday: 4,
        change: 7,
      },
    });
    expect(result.records[0].ranking.meaning).toMatch(/hot leaderboard/);
    expect(result.records[0].ranking.uncertainty).toMatch(/not safety/);
    expect(result.records[0].repository?.limitation).toMatch(/no Git commit/);
    expect(result.records[2].repository).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "duplicate-record" }),
    ]);
    expect(result.rateLimit).toEqual({
      limit: 600,
      remaining: 599,
      resetAfterSeconds: 60,
    });
    expect(JSON.stringify(result)).not.toContain("request-scoped-token");
  });

  it("keeps earlier pages when a later page is rate limited", async () => {
    const result = await discoverSkillsSh({
      token: "token",
      cachePath: false,
      pageSize: 1,
      now: observedAt,
      fetcher: async (input) => {
        const pageNumber = Number(
          new URL(String(input)).searchParams.get("page"),
        );
        return pageNumber === 0
          ? page([skill("acme/skills/one", 10)], 0, true, 1)
          : new Response(JSON.stringify({ error: "rate_limited" }), {
              status: 429,
              headers: { "retry-after": "12" },
            });
      },
    });
    expect(result.status).toBe("partial");
    expect(result.records).toHaveLength(1);
    expect(result.pagesFetched).toBe(1);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "rate-limited",
        retryAfterSeconds: 12,
        page: 1,
      }),
    ]);
  });

  it("writes only complete metadata and uses it when authentication is unavailable", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-skills-sh-cache-"));
    const cachePath = join(root, "skills.json");
    const live = await discoverSkillsSh({
      token: "token",
      cachePath,
      pageSize: 1,
      now: observedAt,
      fetcher: async () => page([skill("acme/skills/one", 10)], 0, false, 1),
    });
    expect(live.status).toBe("complete");

    let called = false;
    const cached = await discoverSkillsSh({
      token: " ",
      cachePath,
      now: new Date("2026-07-17T12:00:00Z"),
      fetcher: async () => {
        called = true;
        return new Response();
      },
    });
    expect(called).toBe(false);
    expect(cached.status).toBe("cached");
    expect(cached.records[0].externalId).toBe("acme/skills/one");
    expect(cached.cache).toEqual({
      path: cachePath,
      cachedAt: observedAt.toISOString(),
    });
    expect(cached.issues[0].code).toBe("authentication-required");
  });

  it("fails closed on mismatched attribution and ignores a malformed cache", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-skills-sh-invalid-"));
    const cachePath = join(root, "skills.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 1,
        source: "skills-sh",
        cachedAt: observedAt.toISOString(),
        records: [{ source: "skills-sh", kind: "skill" }],
      }),
    );
    const result = await discoverSkillsSh({
      token: "token",
      cachePath,
      pageSize: 1,
      now: observedAt,
      fetcher: async () =>
        page(
          [
            skill("acme/skills/one", 10, {
              installUrl: "https://github.com/attacker/other",
            }),
          ],
          0,
          false,
          1,
        ),
    });
    expect(result.status).toBe("unavailable");
    expect(result.records).toEqual([]);
    expect(result.issues[0].code).toBe("invalid-record");
  });

  it("stops at configured pagination bounds without inventing completeness", async () => {
    const result = await discoverSkillsSh({
      token: "token",
      cachePath: false,
      pageSize: 1,
      maxPages: 1,
      maxRecords: 10,
      now: observedAt,
      fetcher: async () => page([skill("acme/skills/one", 10)], 0, true, 1),
    });
    expect(result.status).toBe("partial");
    expect(result.next).toBe("1");
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "pagination-limit" }),
    ]);
  });

  it("reports a record cap as partial and does not skip within-page records via continuation", async () => {
    const result = await discoverSkillsSh({
      token: "token",
      cachePath: false,
      pageSize: 2,
      maxRecords: 1,
      now: observedAt,
      fetcher: async () =>
        page(
          [skill("acme/skills/one", 10), skill("acme/skills/two", 9)],
          0,
          false,
        ),
    });
    expect(result.status).toBe("partial");
    expect(result.records).toHaveLength(1);
    expect(result.next).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "pagination-limit" }),
    ]);
  });
});
