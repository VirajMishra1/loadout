import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  RELEASE_CLAIMS,
  auditReleaseClaims,
} from "../src/core/release-claims.js";

describe("release claim evidence gate", () => {
  it("links every bounded public claim to present evidence and current counts", async () => {
    const catalog = JSON.parse(
      await readFile("catalog/packages.json", "utf8"),
    ) as unknown[];
    const index = await auditReleaseClaims({
      root: process.cwd(),
      readme: await readFile("README.md", "utf8"),
      catalogCount: catalog.length,
    });
    expect(index.releaseBlocked).toBe(false);
    expect(index.blockers).toEqual([]);
    expect(index.claims).toHaveLength(RELEASE_CLAIMS.length);
    expect(
      index.claims.find(
        (claim) => claim.id === "benchmark-performance-evidence",
      ),
    ).toMatchObject({ status: "not-established" });
  });

  it("rejects absolute claims, stale counts, unsafe paths, and missing evidence", async () => {
    const index = await auditReleaseClaims({
      root: process.cwd(),
      readme: "Loadout is universally best and guaranteed safe.",
      catalogCount: 999,
      claims: [
        {
          id: "bad",
          status: "supported",
          statement: "Bad",
          boundary: "Missing",
          evidence: {
            files: ["../secret", "missing.file"],
            commands: [],
            sources: [],
          },
        },
      ],
    });
    expect(index.releaseBlocked).toBe(true);
    expect(index.blockers.join("\n")).toMatch(
      /universally best|guaranteed safe|catalog count|unsafe evidence path|missing\.file/,
    );
  });
});
