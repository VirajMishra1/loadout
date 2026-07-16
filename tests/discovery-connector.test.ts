import { describe, expect, it } from "vitest";
import {
  fetchBoundedJson,
  filterDiscoveryRecordsAgainstKeys,
  type NormalizedDiscoveryIdentity,
} from "../src/core/discovery-connector.js";

describe("shared discovery connector boundaries", () => {
  it("streams bounded JSON and rejects a cross-origin redirect before following it", async () => {
    let calls = 0;
    await expect(
      fetchBoundedJson("https://skills.sh/api/v1/skills", {
        fetcher: async () => {
          calls++;
          return new Response(null, {
            status: 302,
            headers: { location: "https://attacker.example/collect" },
          });
        },
      }),
    ).rejects.toThrow(/cross-origin/);
    expect(calls).toBe(1);

    await expect(
      fetchBoundedJson(
        "https://registry.modelcontextprotocol.io/v0.1/servers",
        {
          maximumBytes: 1_024,
          fetcher: async () =>
            new Response(new Uint8Array(1_025), {
              headers: { "content-type": "application/json" },
            }),
        },
      ),
    ).rejects.toThrow(/1024 byte limit/);
  });

  it("filters against normalized external identity or repository keys without re-ranking", () => {
    const attribution = {
      source: "skills-sh" as const,
      sourceUrl: "https://skills.sh/docs/api",
      observedAt: "2026-07-16T00:00:00Z",
      meaning: "fixture",
    };
    const records: NormalizedDiscoveryIdentity[] = [
      {
        source: "skills-sh",
        identityKey: "skills-sh:acme/skills/one",
        repositoryKey: "github:acme/skills",
        attribution,
      },
      {
        source: "skills-sh",
        identityKey: "skills-sh:other/skills/two",
        repositoryKey: "github:other/skills",
        attribution,
      },
      {
        source: "skills-sh",
        identityKey: "skills-sh:domain.example/three",
        attribution,
      },
    ];
    expect(
      filterDiscoveryRecordsAgainstKeys(records, [
        "GITHUB:ACME/SKILLS",
        "skills-sh:domain.example/three",
      ]).map((record) => record.identityKey),
    ).toEqual(["skills-sh:other/skills/two"]);
  });
});
