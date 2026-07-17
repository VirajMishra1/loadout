import { describe, expect, it } from "vitest";
import { parseReadmeClaimManifest } from "../src/core/readme-claims.js";

describe("README claim manifest", () => {
  it("rejects proven claims without authoritative evidence", () => {
    expect(() =>
      parseReadmeClaimManifest({
        schemaVersion: 1,
        claims: [
          {
            id: "catalog.coverage",
            section: "What Loadout manages",
            summary: "The catalog has generated coverage facts.",
            evidenceClass: "structural",
            status: "proven",
            evidence: [],
          },
        ],
      }),
    ).toThrow(/authoritative evidence/i);
  });
});
