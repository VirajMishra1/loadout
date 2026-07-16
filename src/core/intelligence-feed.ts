import { createHash, createPublicKey } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { writeFileAtomically } from "./atomic-file.js";
import { compatibilityNoticeSchema } from "./compatibility-intelligence.js";
import { fetchBoundedJson } from "./discovery-connector.js";
import { withFileLock } from "./file-lock.js";
import { loadoutHome } from "./paths.js";
import {
  publicKeyFingerprint,
  signPayload,
  verifyEnvelope,
  type SignedEnvelope,
} from "./signing.js";

const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_KEY_BYTES = 64 * 1024;
const DEFAULT_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const DEFAULT_MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;

const timestamp = z.string().datetime({ offset: true });
const httpsUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "credential-free HTTPS URL required");
const identifier = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/);

const discoveryObservationSchema = z
  .object({
    id: identifier,
    source: z.enum([
      "github",
      "hacker-news",
      "skills-sh",
      "official-mcp-registry",
    ]),
    observedAt: timestamp,
    sourceUrl: httpsUrl,
    identityKey: z.string().min(1).max(300),
    signal: z.string().min(1).max(300),
  })
  .strict();

const candidateSummarySchema = z
  .object({
    id: identifier,
    repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    observedAt: timestamp,
    status: z.enum(["inspected", "candidate", "rejected"]),
    summary: z.string().min(1).max(500),
    dossierSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const benchmarkChangeSchema = z
  .object({
    evidenceId: identifier,
    candidateId: identifier,
    taskFamily: identifier,
    change: z.enum(["added", "superseded", "withdrawn"]),
    evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const catalogPointerSchema = z
  .object({
    url: httpsUrl,
    createdAt: timestamp,
    signerFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    envelopeSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const intelligenceFeedPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    createdAt: timestamp,
    expiresAt: timestamp,
    publicDataOnly: z.literal(true),
    discoveryObservations: z.array(discoveryObservationSchema).max(5_000),
    compatibilityNotices: z.array(compatibilityNoticeSchema).max(2_000),
    candidateSummaries: z.array(candidateSummarySchema).max(2_000),
    benchmarkChanges: z.array(benchmarkChangeSchema).max(2_000),
    catalogRelease: catalogPointerSchema.optional(),
  })
  .strict();

export type IntelligenceFeedPayload = z.infer<
  typeof intelligenceFeedPayloadSchema
>;

const envelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    algorithm: z.literal("Ed25519"),
    createdAt: timestamp,
    publicKeyFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    payload: intelligenceFeedPayloadSchema,
    signature: z.string().min(1).max(1024),
  })
  .strict();

export interface IntelligenceFeedTrustState {
  schemaVersion: 1;
  fingerprint: string;
  highWaterSequence: number;
  highWaterCreatedAt: string;
  pendingRotationFingerprint?: string;
}

export interface IntelligenceFeedPreview {
  source: string;
  status: "current";
  fingerprint: string;
  payload: IntelligenceFeedPayload;
  envelope: SignedEnvelope<IntelligenceFeedPayload>;
  envelopeSha256: string;
  firstPin: boolean;
  keyRotation: boolean;
  cachePath: string;
  statePath: string;
  publicKeyPem: string;
  summary: {
    discoveryObservations: number;
    compatibilityNotices: number;
    candidateSummaries: number;
    benchmarkChanges: number;
    hasCatalogPointer: boolean;
  };
  boundary: "read-only-intelligence-no-install-promotion-or-execution";
}

export interface LoadedIntelligenceFeed {
  status: "current" | "stale-cache";
  payload: IntelligenceFeedPayload;
  fingerprint: string;
  stale: boolean;
  issue?: string;
  boundary: "read-only-intelligence-no-install-promotion-or-execution";
}

function defaultStatePath(): string {
  return join(loadoutHome(), "intelligence", "trust.json");
}

function defaultCachePath(): string {
  return join(loadoutHome(), "intelligence", "latest.json");
}

function feedLockPath(statePath: string): string {
  return join(dirname(statePath), "feed.lock");
}

async function readBounded(
  path: string,
  maximum: number,
  label: string,
): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || info.size > maximum)
    throw new Error(`${label} exceeds its byte limit`);
  const content = await readFile(path, "utf8");
  if (Buffer.byteLength(content) > maximum)
    throw new Error(`${label} exceeds its byte limit`);
  return content;
}

async function readTrustState(
  path: string,
): Promise<IntelligenceFeedTrustState | undefined> {
  try {
    const value: unknown = JSON.parse(
      await readBounded(path, 64 * 1024, "Intelligence trust state"),
    );
    const state = value as Partial<IntelligenceFeedTrustState>;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      state.schemaVersion !== 1 ||
      typeof state.fingerprint !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(state.fingerprint) ||
      !Number.isSafeInteger(state.highWaterSequence) ||
      Number(state.highWaterSequence) < 0 ||
      typeof state.highWaterCreatedAt !== "string" ||
      !Number.isFinite(Date.parse(state.highWaterCreatedAt)) ||
      (state.pendingRotationFingerprint !== undefined &&
        !/^sha256:[a-f0-9]{64}$/.test(state.pendingRotationFingerprint))
    )
      throw new Error("Intelligence trust state is invalid");
    return state as IntelligenceFeedTrustState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readSource(
  source: string,
  fetcher?: typeof fetch,
): Promise<unknown> {
  if (/^https:\/\//i.test(source))
    return (
      await fetchBoundedJson(source, { fetcher, maximumBytes: MAX_FEED_BYTES })
    ).value;
  if (/^[a-z]+:\/\//i.test(source))
    throw new Error("Remote intelligence feeds must use HTTPS");
  return JSON.parse(
    await readBounded(resolve(source), MAX_FEED_BYTES, "Intelligence feed"),
  );
}

function envelopeHash(
  envelope: SignedEnvelope<IntelligenceFeedPayload>,
): string {
  return createHash("sha256").update(JSON.stringify(envelope)).digest("hex");
}

function validateFreshness(
  payload: IntelligenceFeedPayload,
  now: Date,
  maxAgeMs: number,
): void {
  const created = Date.parse(payload.createdAt);
  const expires = Date.parse(payload.expiresAt);
  if (expires <= created)
    throw new Error("Intelligence feed expiry must follow creation");
  if (created > now.getTime() + 5 * 60 * 1000)
    throw new Error("Intelligence feed is dated in the future");
  if (now.getTime() - created > maxAgeMs || expires <= now.getTime())
    throw new Error("Intelligence feed is stale");
}

export function createSignedIntelligenceFeed(
  payload: IntelligenceFeedPayload,
  privateKeyPem: string,
): SignedEnvelope<IntelligenceFeedPayload> {
  const validated = intelligenceFeedPayloadSchema.parse(payload);
  return signPayload(validated, privateKeyPem, validated.createdAt);
}

/** Preview is read-only: it verifies but never installs, promotes, executes, or changes trust. */
export async function previewIntelligenceFeed(options: {
  source: string;
  publicKeyPath: string;
  statePath?: string;
  cachePath?: string;
  now?: Date;
  maxAgeMs?: number;
  fetcher?: typeof fetch;
}): Promise<IntelligenceFeedPreview> {
  const statePath = resolve(options.statePath ?? defaultStatePath());
  const cachePath = resolve(options.cachePath ?? defaultCachePath());
  const [rawEnvelope, publicKeyPem, state] = await Promise.all([
    readSource(options.source, options.fetcher),
    readBounded(
      resolve(options.publicKeyPath),
      MAX_KEY_BYTES,
      "Intelligence public key",
    ),
    readTrustState(statePath),
  ]);
  const envelope = envelopeSchema.parse(
    rawEnvelope,
  ) as SignedEnvelope<IntelligenceFeedPayload>;
  const verification = verifyEnvelope(envelope, publicKeyPem);
  if (!verification.valid)
    throw new Error("Intelligence feed signature is invalid");
  if (envelope.createdAt !== envelope.payload.createdAt)
    throw new Error("Intelligence envelope and payload creation times differ");
  validateFreshness(
    envelope.payload,
    options.now ?? new Date(),
    options.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
  );
  const keyRotation = Boolean(
    state && verification.fingerprint !== state.fingerprint,
  );
  if (
    keyRotation &&
    verification.fingerprint !== state?.pendingRotationFingerprint
  )
    throw new Error(
      "Intelligence signer does not match the pinned or explicitly authorized next key",
    );
  if (state && envelope.payload.sequence <= state.highWaterSequence)
    throw new Error("Refusing replayed or downgraded intelligence sequence");
  if (
    state &&
    Date.parse(envelope.payload.createdAt) <=
      Date.parse(state.highWaterCreatedAt)
  )
    throw new Error(
      "Refusing intelligence older than the trust high-water mark",
    );
  return {
    source: options.source,
    status: "current",
    fingerprint: verification.fingerprint,
    payload: envelope.payload,
    envelope,
    envelopeSha256: envelopeHash(envelope),
    firstPin: !state,
    keyRotation,
    cachePath,
    statePath,
    publicKeyPem,
    summary: {
      discoveryObservations: envelope.payload.discoveryObservations.length,
      compatibilityNotices: envelope.payload.compatibilityNotices.length,
      candidateSummaries: envelope.payload.candidateSummaries.length,
      benchmarkChanges: envelope.payload.benchmarkChanges.length,
      hasCatalogPointer: Boolean(envelope.payload.catalogRelease),
    },
    boundary: "read-only-intelligence-no-install-promotion-or-execution",
  };
}

/** Apply only caches verified public intelligence and advances replay protection. */
export async function applyIntelligenceFeed(
  preview: IntelligenceFeedPreview,
): Promise<{ cachePath: string; sequence: number }> {
  return withFileLock(feedLockPath(preview.statePath), async () => {
    const verification = verifyEnvelope(preview.envelope, preview.publicKeyPem);
    if (!verification.valid || verification.fingerprint !== preview.fingerprint)
      throw new Error("Intelligence preview signature no longer verifies");
    const state = await readTrustState(preview.statePath);
    if (state && preview.payload.sequence <= state.highWaterSequence)
      throw new Error("Refusing replayed or downgraded intelligence sequence");
    const allowed =
      !state ||
      verification.fingerprint === state.fingerprint ||
      verification.fingerprint === state.pendingRotationFingerprint;
    if (!allowed)
      throw new Error(
        "Intelligence signer is not pinned or authorized for rotation",
      );
    const next: IntelligenceFeedTrustState = {
      schemaVersion: 1,
      fingerprint: verification.fingerprint,
      highWaterSequence: preview.payload.sequence,
      highWaterCreatedAt: preview.payload.createdAt,
    };
    await writeFileAtomically(
      preview.cachePath,
      `${JSON.stringify(preview.envelope, null, 2)}\n`,
    );
    await writeFileAtomically(
      preview.statePath,
      `${JSON.stringify(next, null, 2)}\n`,
    );
    return { cachePath: preview.cachePath, sequence: preview.payload.sequence };
  });
}

/** Explicitly authorize one new key; no feed can rotate trust merely by claiming it. */
export async function authorizeIntelligenceFeedKeyRotation(options: {
  statePath?: string;
  currentPublicKeyPath: string;
  nextPublicKeyPath: string;
}): Promise<string> {
  const statePath = resolve(options.statePath ?? defaultStatePath());
  return withFileLock(feedLockPath(statePath), async () => {
    const [state, currentPem, nextPem] = await Promise.all([
      readTrustState(statePath),
      readBounded(
        resolve(options.currentPublicKeyPath),
        MAX_KEY_BYTES,
        "Current public key",
      ),
      readBounded(
        resolve(options.nextPublicKeyPath),
        MAX_KEY_BYTES,
        "Next public key",
      ),
    ]);
    if (!state)
      throw new Error("Cannot rotate an intelligence key before first pin");
    if (publicKeyFingerprint(currentPem) !== state.fingerprint)
      throw new Error("Current rotation key does not match pinned trust");
    const pendingRotationFingerprint = publicKeyFingerprint(nextPem);
    if (pendingRotationFingerprint === state.fingerprint)
      throw new Error("Next intelligence key must differ from the pinned key");
    await writeFileAtomically(
      statePath,
      `${JSON.stringify({ ...state, pendingRotationFingerprint }, null, 2)}\n`,
    );
    return pendingRotationFingerprint;
  });
}

/** Explicit compromise recovery removes only feed trust/cache; catalog trust is separate. */
export async function resetIntelligenceFeedTrust(options: {
  statePath?: string;
  cachePath?: string;
  acknowledgeCompromiseRecovery: boolean;
}): Promise<void> {
  if (!options.acknowledgeCompromiseRecovery)
    throw new Error("Compromise recovery requires explicit acknowledgement");
  await Promise.all([
    rm(resolve(options.statePath ?? defaultStatePath()), { force: true }),
    rm(resolve(options.cachePath ?? defaultCachePath()), { force: true }),
  ]);
}

/** On refresh failure, return only a previously verified bounded cache and mark it stale. */
export async function loadIntelligenceFeed(
  options: Parameters<typeof previewIntelligenceFeed>[0] & {
    maxStaleMs?: number;
  },
): Promise<LoadedIntelligenceFeed> {
  try {
    const preview = await previewIntelligenceFeed(options);
    return {
      status: "current",
      payload: preview.payload,
      fingerprint: preview.fingerprint,
      stale: false,
      boundary: preview.boundary,
    };
  } catch (error) {
    const statePath = resolve(options.statePath ?? defaultStatePath());
    const cachePath = resolve(options.cachePath ?? defaultCachePath());
    const [state, publicKeyPem, cached] = await Promise.all([
      readTrustState(statePath),
      readBounded(
        resolve(options.publicKeyPath),
        MAX_KEY_BYTES,
        "Intelligence public key",
      ),
      readBounded(cachePath, MAX_FEED_BYTES, "Cached intelligence feed"),
    ]);
    if (!state) throw error;
    const envelope = envelopeSchema.parse(
      JSON.parse(cached),
    ) as SignedEnvelope<IntelligenceFeedPayload>;
    const verification = verifyEnvelope(envelope, publicKeyPem);
    if (!verification.valid || verification.fingerprint !== state.fingerprint)
      throw new Error(
        "Cached intelligence feed no longer verifies against pinned trust",
      );
    if (
      (options.now ?? new Date()).getTime() -
        Date.parse(envelope.payload.createdAt) >
      (options.maxStaleMs ?? DEFAULT_MAX_STALE_MS)
    )
      throw new Error(
        "Cached intelligence feed exceeds the stale fallback limit",
      );
    return {
      status: "stale-cache",
      payload: envelope.payload,
      fingerprint: verification.fingerprint,
      stale: true,
      issue: error instanceof Error ? error.message : String(error),
      boundary: "read-only-intelligence-no-install-promotion-or-execution",
    };
  }
}

/** Read the last explicitly applied feed and verify it against pinned local trust. */
export async function readCachedIntelligenceFeed(options: {
  publicKeyPath: string;
  statePath?: string;
  cachePath?: string;
  now?: Date;
}): Promise<LoadedIntelligenceFeed> {
  const statePath = resolve(options.statePath ?? defaultStatePath());
  const cachePath = resolve(options.cachePath ?? defaultCachePath());
  const [state, publicKeyPem, cached] = await Promise.all([
    readTrustState(statePath),
    readBounded(
      resolve(options.publicKeyPath),
      MAX_KEY_BYTES,
      "Intelligence public key",
    ),
    readBounded(cachePath, MAX_FEED_BYTES, "Cached intelligence feed"),
  ]);
  if (!state) throw new Error("No pinned intelligence feed is available");
  const envelope = envelopeSchema.parse(
    JSON.parse(cached),
  ) as SignedEnvelope<IntelligenceFeedPayload>;
  const verification = verifyEnvelope(envelope, publicKeyPem);
  if (!verification.valid || verification.fingerprint !== state.fingerprint)
    throw new Error(
      "Cached intelligence feed does not verify against pinned trust",
    );
  if (envelope.payload.sequence !== state.highWaterSequence)
    throw new Error("Cached intelligence sequence does not match trust state");
  const stale =
    Date.parse(envelope.payload.expiresAt) <=
    (options.now ?? new Date()).getTime();
  return {
    status: stale ? "stale-cache" : "current",
    payload: envelope.payload,
    fingerprint: verification.fingerprint,
    stale,
    ...(stale ? { issue: "Cached intelligence feed is expired" } : {}),
    boundary: "read-only-intelligence-no-install-promotion-or-execution",
  };
}

export function intelligenceFeedPublicFields(): readonly string[] {
  return Object.keys(intelligenceFeedPayloadSchema.shape).sort();
}

export function validateIntelligencePublicBoundary(
  value: unknown,
): IntelligenceFeedPayload {
  const serialized = JSON.stringify(value).toLowerCase();
  for (const forbidden of [
    "prompt",
    "projectpath",
    "projectsource",
    "private repository",
    "credentialvalue",
    "apikeyvalue",
  ])
    if (serialized.includes(forbidden))
      throw new Error(
        `Public intelligence feed contains forbidden private field marker: ${forbidden}`,
      );
  return intelligenceFeedPayloadSchema.parse(value);
}

export function intelligencePublicKeySpkiSha256(publicKeyPem: string): string {
  return createHash("sha256")
    .update(
      createPublicKey(publicKeyPem).export({ type: "spki", format: "der" }),
    )
    .digest("hex");
}
