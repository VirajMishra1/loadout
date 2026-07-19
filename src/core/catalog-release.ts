import { readFile, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { CatalogPackage } from "../shared/types.js";
import { writeFileAtomically } from "./atomic-file.js";
import {
  catalogTrustPath,
  loadEffectiveCatalog,
  readCatalogTrustState,
  readTrustedCatalogState,
  trustedCatalogPath,
  validateCatalog,
  type CatalogTrustState,
  type TrustedCatalogState,
} from "./catalog.js";
import { ensureDirectory } from "./paths.js";
import { loadoutHome } from "./paths.js";
import { withFileLock } from "./file-lock.js";
import { createSnapshot, recordSnapshotPostMutationState } from "./snapshot.js";
import { verifyEnvelope, type SignedEnvelope } from "./signing.js";
import {
  beginTransaction,
  completeTransaction,
  markTransactionCommitting,
  rollbackTransaction,
  recoverPendingTransactions,
} from "./transaction.js";

const MAX_RELEASE_BYTES = 5 * 1024 * 1024;
const MAX_PUBLIC_KEY_BYTES = 64 * 1024;
const catalogReleaseLockPath = (): string =>
  join(loadoutHome(), "catalog-releases", "apply.lock");

const envelopeDigest = (envelope: SignedEnvelope<unknown>): string =>
  createHash("sha256").update(envelope.signature).digest("hex");

export interface CatalogReleaseDiff {
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: number;
}

export interface CatalogReleasePreview {
  source: string;
  createdAt: string;
  fingerprint: string;
  packageCount: number;
  diff: CatalogReleaseDiff;
  replay: boolean;
  envelope: SignedEnvelope<CatalogPackage[]>;
  publicKeyPem: string;
}

function parseEnvelope(value: unknown): SignedEnvelope<unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Signed catalog snapshot must be an object");
  const envelope = value as Partial<SignedEnvelope<unknown>>;
  if (
    envelope.schemaVersion !== 1 ||
    envelope.algorithm !== "Ed25519" ||
    typeof envelope.createdAt !== "string" ||
    Number.isNaN(Date.parse(envelope.createdAt)) ||
    typeof envelope.publicKeyFingerprint !== "string" ||
    typeof envelope.signature !== "string" ||
    envelope.payload === undefined
  )
    throw new Error("Signed catalog envelope schema is invalid");
  return envelope as SignedEnvelope<unknown>;
}

async function readReleaseSource(
  source: string,
  fetcher: typeof fetch = fetch,
  requestTimeoutMs = 15_000,
): Promise<string> {
  if (/^https:\/\//i.test(source)) {
    if (
      !Number.isInteger(requestTimeoutMs) ||
      requestTimeoutMs < 1 ||
      requestTimeoutMs > 120_000
    )
      throw new Error("Catalog release timeout must be 1-120000 milliseconds");
    let current = new URL(source);
    const signal = AbortSignal.timeout(requestTimeoutMs);
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 5; redirects++) {
      try {
        response = await fetcher(current, {
          headers: { accept: "application/json" },
          redirect: "manual",
          signal,
        });
      } catch (error) {
        if (signal.aborted)
          throw new Error(
            `Catalog release request timed out after ${requestTimeoutMs}ms`,
            { cause: error },
          );
        throw error;
      }
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location)
        throw new Error("Catalog release redirect has no Location");
      if (redirects === 5)
        throw new Error("Catalog release exceeded five redirects");
      const next = new URL(location, current);
      if (next.protocol !== "https:" || next.username || next.password)
        throw new Error("Catalog release redirected to a non-HTTPS source");
      current = next;
    }
    if (!response) throw new Error("Catalog release request did not run");
    if (!response.ok)
      throw new Error(
        `Catalog release request failed with HTTP ${response.status}`,
      );
    if (response.url && new URL(response.url).protocol !== "https:")
      throw new Error("Catalog release redirected to a non-HTTPS source");
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_RELEASE_BYTES)
      throw new Error("Catalog release exceeds the 5 MiB limit");
    if (!response.body) throw new Error("Catalog release response has no body");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RELEASE_BYTES) {
        await reader.cancel();
        throw new Error("Catalog release exceeds the 5 MiB limit");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
      "utf8",
    );
  }
  if (/^[a-z]+:\/\//i.test(source))
    throw new Error("Remote catalog sources must use HTTPS");
  return readBoundedFile(resolve(source), MAX_RELEASE_BYTES, "catalog release");
}

async function readBoundedFile(
  path: string,
  maximum: number,
  label: string,
): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || info.size > maximum)
    throw new Error(`${label} exceeds the ${maximum} byte limit`);
  const content = await readFile(path, "utf8");
  if (Buffer.byteLength(content) > maximum)
    throw new Error(`${label} exceeds the ${maximum} byte limit`);
  return content;
}

function diffCatalogs(
  current: CatalogPackage[],
  candidate: CatalogPackage[],
): CatalogReleaseDiff {
  const currentById = new Map(current.map((item) => [item.id, item]));
  const candidateById = new Map(candidate.map((item) => [item.id, item]));
  const added = candidate
    .filter((item) => !currentById.has(item.id))
    .map((item) => item.id)
    .sort();
  const removed = current
    .filter((item) => !candidateById.has(item.id))
    .map((item) => item.id)
    .sort();
  const updated = candidate
    .filter((item) => {
      const previous = currentById.get(item.id);
      return previous && !isDeepStrictEqual(previous, item);
    })
    .map((item) => item.id)
    .sort();
  return {
    added,
    updated,
    removed,
    unchanged: candidate.length - added.length - updated.length,
  };
}

export async function previewCatalogRelease(options: {
  source: string;
  publicKeyPath: string;
  currentCatalog: CatalogPackage[];
  fetcher?: typeof fetch;
  requestTimeoutMs?: number;
}): Promise<CatalogReleasePreview> {
  const [raw, publicKeyPem, trusted, trust] = await Promise.all([
    readReleaseSource(
      options.source,
      options.fetcher,
      options.requestTimeoutMs,
    ),
    readBoundedFile(
      resolve(options.publicKeyPath),
      MAX_PUBLIC_KEY_BYTES,
      "public key",
    ),
    readTrustedCatalogState(),
    readCatalogTrustState(),
  ]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Catalog release is not valid JSON");
  }
  const envelope = parseEnvelope(parsed);
  const verification = verifyEnvelope(envelope, publicKeyPem);
  if (!verification.valid)
    throw new Error(
      `Catalog release signature is invalid for trusted key ${verification.fingerprint}`,
    );
  const pendingIsActive = Boolean(
    trust?.pendingCreatedAt &&
    trusted?.envelope.createdAt === trust.pendingCreatedAt &&
    envelopeDigest(trusted.envelope) === trust.pendingEnvelopeSha256,
  );
  const effectiveTrust =
    trust?.pendingFirstPin && !pendingIsActive ? undefined : trust;
  if (effectiveTrust && verification.fingerprint !== effectiveTrust.fingerprint)
    throw new Error(
      `Catalog signer ${verification.fingerprint} does not match pinned key ${effectiveTrust.fingerprint}; key rotation requires an explicit trust reset`,
    );
  validateCatalog(envelope.payload, { requireEvidence: true });
  const catalogEnvelope = envelope as SignedEnvelope<CatalogPackage[]>;
  const previousTime = Math.max(
    trusted ? Date.parse(trusted.envelope.createdAt) : -Infinity,
    effectiveTrust ? Date.parse(effectiveTrust.highWaterCreatedAt) : -Infinity,
  );
  return {
    source: options.source,
    createdAt: catalogEnvelope.createdAt,
    fingerprint: verification.fingerprint,
    packageCount: catalogEnvelope.payload.length,
    diff: diffCatalogs(options.currentCatalog, catalogEnvelope.payload),
    replay: Date.parse(catalogEnvelope.createdAt) <= previousTime,
    envelope: catalogEnvelope,
    publicKeyPem,
  };
}

export async function applyCatalogRelease(
  preview: CatalogReleasePreview,
  options: { allowRemovals?: boolean; now?: Date } = {},
): Promise<{ path: string; snapshotId: string; diff: CatalogReleaseDiff }> {
  return withFileLock(catalogReleaseLockPath(), async () => {
    await recoverPendingTransactions();
    const verification = verifyEnvelope(preview.envelope, preview.publicKeyPem);
    if (!verification.valid || verification.fingerprint !== preview.fingerprint)
      throw new Error(
        "Catalog release preview no longer has a valid trusted signature",
      );
    validateCatalog(preview.envelope.payload, { requireEvidence: true });
    let trust = await readCatalogTrustState();
    const trusted = await readTrustedCatalogState();
    let exactPending: TrustedCatalogState | undefined;
    if (trust?.pendingCreatedAt) {
      const pendingIsActive =
        trusted?.envelope.createdAt === trust.pendingCreatedAt &&
        envelopeDigest(trusted.envelope) === trust.pendingEnvelopeSha256;
      if (
        pendingIsActive &&
        envelopeDigest(preview.envelope) === trust.pendingEnvelopeSha256
      )
        exactPending = trusted;
      const base: CatalogTrustState = { ...trust };
      delete base.pendingCreatedAt;
      delete base.pendingEnvelopeSha256;
      delete base.pendingFirstPin;
      if (!pendingIsActive && trust.pendingFirstPin) {
        await rm(catalogTrustPath(), { force: true });
        trust = undefined;
      } else {
        trust = {
          ...base,
          ...(pendingIsActive
            ? {
                highWaterCreatedAt: new Date(
                  Math.max(
                    Date.parse(trust.highWaterCreatedAt),
                    Date.parse(trust.pendingCreatedAt),
                  ),
                ).toISOString(),
              }
            : {}),
        };
        await writeFileAtomically(
          catalogTrustPath(),
          `${JSON.stringify(trust, null, 2)}\n`,
        );
      }
    }
    if (exactPending) {
      if (!exactPending.snapshotId)
        throw new Error(
          "Finalized the active signed catalog, but its legacy state has no rollback snapshot id",
        );
      return {
        path: trustedCatalogPath(),
        snapshotId: exactPending.snapshotId,
        diff: diffCatalogs(
          await loadEffectiveCatalog(),
          preview.envelope.payload,
        ),
      };
    }
    if (trust && verification.fingerprint !== trust.fingerprint)
      throw new Error(
        `Catalog signer ${verification.fingerprint} does not match pinned key ${trust.fingerprint}; key rotation requires an explicit trust reset`,
      );
    const previousTime = Math.max(
      trusted ? Date.parse(trusted.envelope.createdAt) : -Infinity,
      trust ? Date.parse(trust.highWaterCreatedAt) : -Infinity,
    );
    if (Date.parse(preview.envelope.createdAt) <= previousTime)
      throw new Error(
        "Refusing an older or already-applied signed catalog release",
      );
    const diff = diffCatalogs(
      await loadEffectiveCatalog(),
      preview.envelope.payload,
    );
    if (diff.removed.length && !options.allowRemovals)
      throw new Error(
        `Release removes ${diff.removed.length} package(s); review and pass --allow-removals explicitly`,
      );
    const now = options.now ?? new Date();
    const target = trustedCatalogPath();
    const pinned: CatalogTrustState =
      trust ??
      ({
        schemaVersion: 1,
        fingerprint: verification.fingerprint,
        publicKeyPem: preview.publicKeyPem,
        highWaterCreatedAt: new Date(0).toISOString(),
        pinnedAt: now.toISOString(),
      } satisfies CatalogTrustState);
    await ensureDirectory(dirname(target));
    const snapshot = await createSnapshot([target], { persist: false });
    const transaction = await beginTransaction(snapshot, [target]);
    const state: TrustedCatalogState = {
      schemaVersion: 1,
      appliedAt: now.toISOString(),
      source: preview.source,
      publicKeyPem: pinned.publicKeyPem,
      envelope: preview.envelope,
      snapshotId: snapshot.id,
    };
    try {
      await writeFileAtomically(
        catalogTrustPath(),
        `${JSON.stringify(
          {
            ...pinned,
            pendingCreatedAt: preview.envelope.createdAt,
            pendingEnvelopeSha256: envelopeDigest(preview.envelope),
            ...(!trust ? { pendingFirstPin: true } : {}),
          },
          null,
          2,
        )}\n`,
      );
      await markTransactionCommitting(transaction);
      await writeFileAtomically(target, `${JSON.stringify(state, null, 2)}\n`);
      await recordSnapshotPostMutationState(snapshot);
      await completeTransaction(transaction, { releaseLock: false });
      await writeFileAtomically(
        catalogTrustPath(),
        `${JSON.stringify(
          {
            ...pinned,
            highWaterCreatedAt: preview.envelope.createdAt,
          },
          null,
          2,
        )}\n`,
      );
      await transaction.mutationLock.release();
    } catch (error) {
      await rollbackTransaction(transaction);
      if (!trust) await rm(catalogTrustPath(), { force: true });
      throw error;
    }
    return { path: target, snapshotId: snapshot.id, diff };
  });
}

export function formatCatalogReleasePreview(
  preview: CatalogReleasePreview,
): string {
  return [
    `Signed catalog: ${preview.packageCount} package(s)`,
    `Created: ${preview.createdAt}`,
    `Trusted key: ${preview.fingerprint}`,
    `Diff: +${preview.diff.added.length} ~${preview.diff.updated.length} -${preview.diff.removed.length} =${preview.diff.unchanged}`,
    ...(preview.diff.added.length
      ? [`Added: ${preview.diff.added.join(", ")}`]
      : []),
    ...(preview.diff.updated.length
      ? [`Updated: ${preview.diff.updated.join(", ")}`]
      : []),
    ...(preview.diff.removed.length
      ? [`Removed: ${preview.diff.removed.join(", ")}`]
      : []),
    preview.replay
      ? "Status: older or already applied; apply will be refused"
      : "Status: signature and evidence valid; no changes applied yet",
  ].join("\n");
}
