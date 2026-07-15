import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  formatStarHistory,
  readCatalogObservations,
  recordCatalogObservations,
} from "../src/core/observations.js";

describe("catalog observations", () => {
  let home: string;
  afterEach(async () => {
    if (home) await rm(home, { recursive: true, force: true });
    delete process.env.LOADOUT_HOME;
  });

  it("stores release/download facts without inventing repeated daily velocity", async () => {
    home = await mkdtemp(`${tmpdir()}/loadout-observations-`);
    process.env.LOADOUT_HOME = home;
    const result = await recordCatalogObservations(
      [{ id: "demo", repository: "acme/demo", stars: 12 } as never],
      {
        fetcher: async () =>
          new Response(
            JSON.stringify([
              {
                tag_name: "v1.2.0",
                published_at: "2026-07-10T00:00:00Z",
                assets: [{ download_count: 7 }, { download_count: 4 }],
              },
            ]),
          ),
      },
    );
    expect(result).toEqual({ recorded: 1, failures: [] });
    const history = await readCatalogObservations("acme/demo");
    expect(history).toEqual([
      expect.objectContaining({
        stars: 12,
        latestReleaseTag: "v1.2.0",
        latestReleaseDownloads: 11,
      }),
    ]);
    expect(formatStarHistory(history)).toContain("first observation");
  });

  it("keeps release lookup failures separate from the catalog refresh path", async () => {
    home = await mkdtemp(`${tmpdir()}/loadout-observations-`);
    process.env.LOADOUT_HOME = home;
    const result = await recordCatalogObservations(
      [{ id: "demo", repository: "acme/demo", stars: 12 } as never],
      { fetcher: async () => new Response("no", { status: 503 }) },
    );
    expect(result.recorded).toBe(0);
    expect(result.failures[0]?.error).toContain("release request failed (503)");
  });
});
