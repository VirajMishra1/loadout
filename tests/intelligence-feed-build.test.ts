import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildIntelligenceFeedPayload } from "../src/core/intelligence-feed-build.js";
import {
  createSignedIntelligenceFeed,
  validateIntelligencePublicBoundary,
} from "../src/core/intelligence-feed.js";
import { verifyEnvelope } from "../src/core/signing.js";

const discovery = {
  schemaVersion: 1,
  generatedAt: "2026-07-16T00:00:00.000Z",
  privateNoise: "ignored instead of copied",
  repositories: [
    {
      repository: "Example/Tool",
      url: "https://github.com/Example/Tool",
      catalogStatus: "candidate",
      description: "not copied into the bounded feed",
      lastObservedAt: "2026-07-16T00:00:00.000Z",
    },
  ],
};

describe("central intelligence feed builder", () => {
  it("projects discovery into a strict public-only signed payload", () => {
    const payload = buildIntelligenceFeedPayload({
      discovery,
      sequence: 20260716,
      expiresAt: "2026-07-18T00:00:00.000Z",
    });
    expect(payload.discoveryObservations[0]).toMatchObject({
      id: "github:example/tool",
      signal: expect.stringContaining("not trusted or recommended"),
    });
    expect(JSON.stringify(payload)).not.toContain("privateNoise");
    expect(JSON.stringify(payload)).not.toContain("not copied");
    expect(validateIntelligencePublicBoundary(payload)).toEqual(payload);
    const pair = generateKeyPairSync("ed25519");
    const privatePem = pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    const publicPem = pair.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    expect(
      verifyEnvelope(
        createSignedIntelligenceFeed(payload, privatePem),
        publicPem,
      ).valid,
    ).toBe(true);
  });

  it("rejects duplicate, credential-bearing, and non-GitHub public identities", () => {
    expect(() =>
      buildIntelligenceFeedPayload({
        discovery: {
          ...discovery,
          repositories: [
            ...discovery.repositories,
            {
              ...discovery.repositories[0],
              repository: "example/tool",
              url: "https://github.com/example/tool",
            },
          ],
        },
        sequence: 1,
        expiresAt: "2026-07-18T00:00:00.000Z",
      }),
    ).toThrow(/Duplicate/);
    expect(() =>
      buildIntelligenceFeedPayload({
        discovery: {
          ...discovery,
          repositories: [
            {
              ...discovery.repositories[0],
              url: "https://token@github.com/Example/Tool",
            },
          ],
        },
        sequence: 1,
        expiresAt: "2026-07-18T00:00:00.000Z",
      }),
    ).toThrow(/non-public|invalid/);
  });
});
