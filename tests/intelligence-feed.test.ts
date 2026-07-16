import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyIntelligenceFeed,
  authorizeIntelligenceFeedKeyRotation,
  createSignedIntelligenceFeed,
  loadIntelligenceFeed,
  previewIntelligenceFeed,
  readCachedIntelligenceFeed,
  resetIntelligenceFeedTrust,
  validateIntelligencePublicBoundary,
  type IntelligenceFeedPayload,
} from "../src/core/intelligence-feed.js";

function keys(): { privatePem: string; publicPem: string } {
  const pair = generateKeyPairSync("ed25519");
  return {
    privatePem: pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    publicPem: pair.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
  };
}

function payload(
  sequence: number,
  createdAt = "2026-07-16T10:00:00.000Z",
): IntelligenceFeedPayload {
  return {
    schemaVersion: 1,
    sequence,
    createdAt,
    expiresAt: new Date(
      Date.parse(createdAt) + 24 * 60 * 60 * 1000,
    ).toISOString(),
    publicDataOnly: true,
    discoveryObservations: [
      {
        id: "github:example/tool",
        source: "github",
        observedAt: createdAt,
        sourceUrl: "https://github.com/example/tool",
        identityKey: "github:example/tool",
        signal: "public repository observation; not a safety or quality claim",
      },
    ],
    compatibilityNotices: [],
    candidateSummaries: [],
    benchmarkChanges: [],
  };
}

async function fixture(sequence = 1, key = keys(), createdAt?: string) {
  const root = await mkdtemp(join(tmpdir(), "loadout-feed-"));
  const source = join(root, "feed.json");
  const publicKeyPath = join(root, "feed.pub");
  const statePath = join(root, "trust.json");
  const cachePath = join(root, "cache.json");
  await writeFile(publicKeyPath, key.publicPem);
  await writeFile(
    source,
    JSON.stringify(
      createSignedIntelligenceFeed(
        payload(sequence, createdAt),
        key.privatePem,
      ),
    ),
  );
  return { root, source, publicKeyPath, statePath, cachePath, key };
}

describe("signed daily intelligence feed", () => {
  it("previews and caches a local feed without installing or promoting anything", async () => {
    const item = await fixture();
    const preview = await previewIntelligenceFeed({
      ...item,
      now: new Date("2026-07-16T12:00:00.000Z"),
    });
    expect(preview).toMatchObject({
      firstPin: true,
      boundary: "read-only-intelligence-no-install-promotion-or-execution",
    });
    await applyIntelligenceFeed(preview);
    const cached = await readCachedIntelligenceFeed({
      publicKeyPath: item.publicKeyPath,
      statePath: item.statePath,
      cachePath: item.cachePath,
      now: new Date("2026-07-16T12:00:00.000Z"),
    });
    expect(cached).toMatchObject({ status: "current", stale: false });
    const state = JSON.parse(await readFile(item.statePath, "utf8"));
    expect(state).toMatchObject({
      highWaterSequence: 1,
      fingerprint: preview.fingerprint,
    });
  });

  it("rejects tampering, replay, downgrade, stale data, unknown fields, and private markers", async () => {
    const item = await fixture();
    const now = new Date("2026-07-16T12:00:00.000Z");
    const preview = await previewIntelligenceFeed({ ...item, now });
    await applyIntelligenceFeed(preview);
    await expect(previewIntelligenceFeed({ ...item, now })).rejects.toThrow(
      /replayed|downgraded/,
    );
    const tampered = JSON.parse(await readFile(item.source, "utf8"));
    tampered.payload.sequence = 2;
    await writeFile(item.source, JSON.stringify(tampered));
    await expect(previewIntelligenceFeed({ ...item, now })).rejects.toThrow(
      /signature/,
    );
    const stale = await fixture(1, keys(), "2026-07-01T10:00:00.000Z");
    await expect(previewIntelligenceFeed({ ...stale, now })).rejects.toThrow(
      /stale/,
    );
    expect(() =>
      validateIntelligencePublicBoundary({ ...payload(1), prompt: "secret" }),
    ).toThrow();
  });

  it("requires explicit pinned-key rotation and then promotes the authorized key", async () => {
    const first = await fixture();
    const now = new Date("2026-07-16T12:00:00.000Z");
    await applyIntelligenceFeed(
      await previewIntelligenceFeed({ ...first, now }),
    );
    const next = keys();
    const nextPublic = join(first.root, "next.pub");
    const rotatedSource = join(first.root, "rotated.json");
    await writeFile(nextPublic, next.publicPem);
    await writeFile(
      rotatedSource,
      JSON.stringify(
        createSignedIntelligenceFeed(
          payload(2, "2026-07-16T11:00:00.000Z"),
          next.privatePem,
        ),
      ),
    );
    await expect(
      previewIntelligenceFeed({
        source: rotatedSource,
        publicKeyPath: nextPublic,
        statePath: first.statePath,
        cachePath: first.cachePath,
        now,
      }),
    ).rejects.toThrow(/pinned|authorized/);
    await authorizeIntelligenceFeedKeyRotation({
      statePath: first.statePath,
      currentPublicKeyPath: first.publicKeyPath,
      nextPublicKeyPath: nextPublic,
    });
    const rotated = await previewIntelligenceFeed({
      source: rotatedSource,
      publicKeyPath: nextPublic,
      statePath: first.statePath,
      cachePath: first.cachePath,
      now,
    });
    expect(rotated.keyRotation).toBe(true);
    await applyIntelligenceFeed(rotated);
    expect(JSON.parse(await readFile(first.statePath, "utf8"))).toMatchObject({
      fingerprint: rotated.fingerprint,
      highWaterSequence: 2,
    });
  });

  it("returns a verified stale cache on refresh failure and supports explicit compromise recovery", async () => {
    const item = await fixture();
    const now = new Date("2026-07-16T12:00:00.000Z");
    await applyIntelligenceFeed(
      await previewIntelligenceFeed({ ...item, now }),
    );
    const loaded = await loadIntelligenceFeed({
      source: join(item.root, "missing.json"),
      publicKeyPath: item.publicKeyPath,
      statePath: item.statePath,
      cachePath: item.cachePath,
      now,
    });
    expect(loaded).toMatchObject({ status: "stale-cache", stale: true });
    await expect(
      resetIntelligenceFeedTrust({
        statePath: item.statePath,
        cachePath: item.cachePath,
        acknowledgeCompromiseRecovery: false,
      }),
    ).rejects.toThrow(/acknowledgement/);
    await resetIntelligenceFeedTrust({
      statePath: item.statePath,
      cachePath: item.cachePath,
      acknowledgeCompromiseRecovery: true,
    });
    await expect(readFile(item.statePath)).rejects.toThrow();
  });

  it("accepts a bounded credential-free HTTPS source", async () => {
    const item = await fixture();
    const envelope = await readFile(item.source, "utf8");
    const fetcher: typeof fetch = async () =>
      new Response(envelope, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const preview = await previewIntelligenceFeed({
      source: "https://feeds.example/loadout.json",
      publicKeyPath: item.publicKeyPath,
      statePath: item.statePath,
      cachePath: item.cachePath,
      now: new Date("2026-07-16T12:00:00.000Z"),
      fetcher,
    });
    expect(preview.summary.discoveryObservations).toBe(1);
  });
});
