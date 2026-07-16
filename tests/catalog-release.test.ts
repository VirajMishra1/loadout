import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  applyCatalogRelease,
  previewCatalogRelease,
} from "../src/core/catalog-release.js";
import {
  catalogTrustPath,
  loadCatalog,
  loadEffectiveCatalog,
  readCatalogTrustState,
  trustedCatalogPath,
} from "../src/core/catalog.js";
import {
  generateSigningKeys,
  publicKeyFingerprint,
  signPayload,
} from "../src/core/signing.js";
import {
  createSnapshot,
  readSnapshot,
  restoreSnapshot,
} from "../src/core/snapshot.js";
import {
  beginTransaction,
  markTransactionCommitting,
  recoverPendingTransactions,
} from "../src/core/transaction.js";

describe("signed catalog releases", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    await rm(dirname(trustedCatalogPath()), { recursive: true, force: true });
  });

  async function signedFixture(createdAt = "2026-07-16T12:00:00.000Z") {
    root = await mkdtemp(join(tmpdir(), "loadout-release-"));
    const privatePath = join(root, "private.pem");
    const publicPath = join(root, "public.pem");
    await generateSigningKeys(privatePath, publicPath);
    const catalog = await loadCatalog();
    const added = {
      ...catalog[0],
      id: "signed-release-fixture",
      displayName: "Signed Release Fixture",
      repository: "example/signed-release-fixture",
      source: {
        ...catalog[0].source!,
        url: "https://github.com/example/signed-release-fixture",
      },
    };
    const payload = [...catalog, added];
    const envelope = signPayload(
      payload,
      await readFile(privatePath, "utf8"),
      createdAt,
    );
    const source = join(root, "catalog.signed.json");
    await writeFile(source, JSON.stringify(envelope));
    return { source, publicPath, catalog, payload, envelope };
  }

  it("previews a verified diff and atomically activates the trusted catalog", async () => {
    const fixture = await signedFixture();
    const preview = await previewCatalogRelease({
      source: fixture.source,
      publicKeyPath: fixture.publicPath,
      currentCatalog: fixture.catalog,
    });
    expect(preview.diff.added).toEqual(["signed-release-fixture"]);
    expect(preview.replay).toBe(false);
    const applied = await applyCatalogRelease(preview, {
      now: new Date("2026-07-16T12:01:00Z"),
    });
    expect(applied.snapshotId).toMatch(/^\d+-[a-f0-9]{12}$/);
    expect((await loadEffectiveCatalog()).at(-1)?.id).toBe(
      "signed-release-fixture",
    );

    const replay = await previewCatalogRelease({
      source: fixture.source,
      publicKeyPath: fixture.publicPath,
      currentCatalog: fixture.payload,
    });
    expect(replay.replay).toBe(true);
    await expect(applyCatalogRelease(replay)).rejects.toThrow(
      /already-applied/,
    );

    await restoreSnapshot(await readSnapshot(applied.snapshotId));
    const afterRollback = await previewCatalogRelease({
      source: fixture.source,
      publicKeyPath: fixture.publicPath,
      currentCatalog: fixture.catalog,
    });
    expect(afterRollback.replay).toBe(true);
  });

  it("rejects tampering and requires explicit approval for removals", async () => {
    const fixture = await signedFixture();
    await writeFile(
      fixture.source,
      JSON.stringify({
        ...fixture.envelope,
        payload: fixture.envelope.payload.slice(1),
      }),
    );
    await expect(
      previewCatalogRelease({
        source: fixture.source,
        publicKeyPath: fixture.publicPath,
        currentCatalog: fixture.catalog,
      }),
    ).rejects.toThrow(/signature is invalid/);

    const removalEnvelope = signPayload(
      fixture.catalog.slice(1),
      await readFile(join(root, "private.pem"), "utf8"),
      "2026-07-16T13:00:00.000Z",
    );
    await writeFile(fixture.source, JSON.stringify(removalEnvelope));
    const preview = await previewCatalogRelease({
      source: fixture.source,
      publicKeyPath: fixture.publicPath,
      currentCatalog: fixture.catalog,
    });
    expect(preview.diff.removed).toEqual([fixture.catalog[0].id]);
    preview.diff.removed = [];
    await expect(applyCatalogRelease(preview)).rejects.toThrow(
      /allow-removals/,
    );
  });

  it("refuses non-HTTPS remote catalog sources", async () => {
    const fixture = await signedFixture();
    await expect(
      previewCatalogRelease({
        source: "http://example.com/catalog.json",
        publicKeyPath: fixture.publicPath,
        currentCatalog: fixture.catalog,
      }),
    ).rejects.toThrow(/must use HTTPS/);
  });

  it("refuses an HTTPS source redirected to HTTP", async () => {
    const fixture = await signedFixture();
    const fetcher = async (): Promise<Response> => {
      const response = new Response("{}", { status: 200 });
      Object.defineProperty(response, "url", {
        value: "http://internal.example/catalog.json",
      });
      return response;
    };
    await expect(
      previewCatalogRelease({
        source: "https://releases.example/catalog.json",
        publicKeyPath: fixture.publicPath,
        currentCatalog: fixture.catalog,
        fetcher,
      }),
    ).rejects.toThrow(/redirected to a non-HTTPS/);
  });

  it("accepts a bounded signed HTTPS response and times out stalled fetches", async () => {
    const fixture = await signedFixture();
    const preview = await previewCatalogRelease({
      source: "https://releases.example/catalog.json",
      publicKeyPath: fixture.publicPath,
      currentCatalog: fixture.catalog,
      fetcher: async () =>
        new Response(JSON.stringify(fixture.envelope), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    expect(preview.diff.added).toEqual(["signed-release-fixture"]);

    await expect(
      previewCatalogRelease({
        source: "https://releases.example/stalled.json",
        publicKeyPath: fixture.publicPath,
        currentCatalog: fixture.catalog,
        requestTimeoutMs: 20,
        fetcher: ((_url: URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          })) as typeof fetch,
      }),
    ).rejects.toThrow(/timed out after 20ms/);
  });

  it("rejects a non-HTTPS intermediate redirect before following it", async () => {
    const fixture = await signedFixture();
    let calls = 0;
    await expect(
      previewCatalogRelease({
        source: "https://releases.example/catalog.json",
        publicKeyPath: fixture.publicPath,
        currentCatalog: fixture.catalog,
        fetcher: async () => {
          calls += 1;
          return new Response(null, {
            status: 302,
            headers: { location: "http://internal.example/catalog.json" },
          });
        },
      }),
    ).rejects.toThrow(/redirected to a non-HTTPS/);
    expect(calls).toBe(1);
  });

  it("re-verifies a preview at the apply boundary", async () => {
    const fixture = await signedFixture();
    const preview = await previewCatalogRelease({
      source: fixture.source,
      publicKeyPath: fixture.publicPath,
      currentCatalog: fixture.catalog,
    });
    preview.envelope.payload = preview.envelope.payload.slice(1);
    await expect(applyCatalogRelease(preview)).rejects.toThrow(
      /no longer has a valid trusted signature/,
    );
  });

  it("pins the first trusted signing key and rejects silent replacement", async () => {
    const fixture = await signedFixture();
    await applyCatalogRelease(
      await previewCatalogRelease({
        source: fixture.source,
        publicKeyPath: fixture.publicPath,
        currentCatalog: fixture.catalog,
      }),
    );
    const otherPrivate = join(root, "other-private.pem");
    const otherPublic = join(root, "other-public.pem");
    await generateSigningKeys(otherPrivate, otherPublic);
    await writeFile(
      fixture.source,
      JSON.stringify(
        signPayload(
          fixture.payload,
          await readFile(otherPrivate, "utf8"),
          "2026-07-16T14:00:00.000Z",
        ),
      ),
    );
    await expect(
      previewCatalogRelease({
        source: fixture.source,
        publicKeyPath: otherPublic,
        currentCatalog: fixture.payload,
      }),
    ).rejects.toThrow(/does not match pinned key/);
  });

  it("rejects a trust anchor whose PEM does not match its fingerprint", async () => {
    const fixture = await signedFixture();
    await applyCatalogRelease(
      await previewCatalogRelease({
        source: fixture.source,
        publicKeyPath: fixture.publicPath,
        currentCatalog: fixture.catalog,
      }),
    );
    const trust = (await readCatalogTrustState())!;
    const otherPrivate = join(root, "mismatch-private.pem");
    const otherPublic = join(root, "mismatch-public.pem");
    await generateSigningKeys(otherPrivate, otherPublic);
    await writeFile(
      catalogTrustPath(),
      JSON.stringify({
        ...trust,
        publicKeyPem: await readFile(otherPublic, "utf8"),
      }),
    );
    await expect(readCatalogTrustState()).rejects.toThrow(
      /trust anchor is invalid/,
    );
  });

  it("clears an uncommitted pending marker and applies the release", async () => {
    const fixture = await signedFixture();
    const publicKeyPem = await readFile(fixture.publicPath, "utf8");
    await mkdir(dirname(catalogTrustPath()), { recursive: true });
    await writeFile(
      catalogTrustPath(),
      JSON.stringify({
        schemaVersion: 1,
        fingerprint: publicKeyFingerprint(publicKeyPem),
        publicKeyPem,
        highWaterCreatedAt: new Date(0).toISOString(),
        pinnedAt: "2026-07-16T11:00:00.000Z",
        pendingCreatedAt: fixture.envelope.createdAt,
        pendingEnvelopeSha256: createHash("sha256")
          .update(fixture.envelope.signature)
          .digest("hex"),
      }),
    );

    await applyCatalogRelease(
      await previewCatalogRelease({
        source: fixture.source,
        publicKeyPath: fixture.publicPath,
        currentCatalog: fixture.catalog,
      }),
    );
    const trust = (await readCatalogTrustState())!;
    expect(trust.highWaterCreatedAt).toBe(fixture.envelope.createdAt);
    expect(trust.pendingCreatedAt).toBeUndefined();
  });

  it("finalizes a committed pending release before applying the next one", async () => {
    const fixture = await signedFixture();
    await applyCatalogRelease(
      await previewCatalogRelease({
        source: fixture.source,
        publicKeyPath: fixture.publicPath,
        currentCatalog: fixture.catalog,
      }),
    );
    const trust = (await readCatalogTrustState())!;
    await writeFile(
      catalogTrustPath(),
      JSON.stringify({
        ...trust,
        highWaterCreatedAt: new Date(0).toISOString(),
        pendingCreatedAt: fixture.envelope.createdAt,
        pendingEnvelopeSha256: createHash("sha256")
          .update(fixture.envelope.signature)
          .digest("hex"),
      }),
    );
    expect((await loadEffectiveCatalog()).at(-1)?.id).toBe(
      "signed-release-fixture",
    );
    const exactRetry = await applyCatalogRelease(
      await previewCatalogRelease({
        source: fixture.source,
        publicKeyPath: fixture.publicPath,
        currentCatalog: fixture.payload,
      }),
    );
    expect(exactRetry.snapshotId).toMatch(/^\d+-[a-f0-9]{12}$/);
    expect((await readCatalogTrustState())?.pendingCreatedAt).toBeUndefined();

    const nextCreatedAt = "2026-07-16T13:00:00.000Z";
    const nextPayload = fixture.payload.map((item) =>
      item.id === "signed-release-fixture"
        ? { ...item, description: "Second signed revision" }
        : item,
    );
    await writeFile(
      fixture.source,
      JSON.stringify(
        signPayload(
          nextPayload,
          await readFile(join(root, "private.pem"), "utf8"),
          nextCreatedAt,
        ),
      ),
    );
    await applyCatalogRelease(
      await previewCatalogRelease({
        source: fixture.source,
        publicKeyPath: fixture.publicPath,
        currentCatalog: fixture.payload,
      }),
    );
    const finalized = (await readCatalogTrustState())!;
    expect(finalized.highWaterCreatedAt).toBe(nextCreatedAt);
    expect(finalized.pendingCreatedAt).toBeUndefined();
  });

  it("never exposes a trusted catalog while its transaction journal is pending", async () => {
    const fixture = await signedFixture();
    const publicKeyPem = await readFile(fixture.publicPath, "utf8");
    const target = trustedCatalogPath();
    const draft = await createSnapshot([target], { persist: false });
    const transaction = await beginTransaction(draft, [target]);
    await markTransactionCommitting(transaction);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(
      catalogTrustPath(),
      JSON.stringify({
        schemaVersion: 1,
        fingerprint: publicKeyFingerprint(publicKeyPem),
        publicKeyPem,
        highWaterCreatedAt: new Date(0).toISOString(),
        pinnedAt: "2026-07-16T11:00:00.000Z",
        pendingCreatedAt: fixture.envelope.createdAt,
        pendingEnvelopeSha256: createHash("sha256")
          .update(fixture.envelope.signature)
          .digest("hex"),
        pendingFirstPin: true,
      }),
    );
    await writeFile(
      target,
      JSON.stringify({
        schemaVersion: 1,
        appliedAt: "2026-07-16T12:01:00.000Z",
        source: fixture.source,
        publicKeyPem,
        envelope: fixture.envelope,
        snapshotId: transaction.snapshotId,
      }),
    );

    await expect(loadEffectiveCatalog()).rejects.toThrow(
      /pending transaction recovery/,
    );
    await transaction.mutationLock.release();
    expect(await recoverPendingTransactions()).toEqual([transaction.id]);
    expect(
      (await loadEffectiveCatalog()).some(
        (item) => item.id === "signed-release-fixture",
      ),
    ).toBe(false);
  });

  it("streams and aborts a lengthless response above five MiB", async () => {
    const fixture = await signedFixture();
    await expect(
      previewCatalogRelease({
        source: "https://releases.example/huge.json",
        publicKeyPath: fixture.publicPath,
        currentCatalog: fixture.catalog,
        fetcher: async () =>
          new Response(new Uint8Array(5 * 1024 * 1024 + 1), { status: 200 }),
      }),
    ).rejects.toThrow(/5 MiB limit/);
  });
});
