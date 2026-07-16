import { readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { writeFileAtomically } from "./atomic-file.js";
import { ensureDirectory } from "./paths.js";

export type DiscoveryConnectorSource = "skills-sh" | "official-mcp-registry";

export type DiscoveryConnectorStatus =
  "complete" | "partial" | "cached" | "unavailable";

export type DiscoveryConnectorIssueCode =
  | "authentication-required"
  | "rate-limited"
  | "request-failed"
  | "invalid-response"
  | "invalid-record"
  | "pagination-replay"
  | "pagination-limit"
  | "duplicate-record"
  | "cache-read-failed"
  | "cache-write-failed";

export interface DiscoveryConnectorIssue {
  code: DiscoveryConnectorIssueCode;
  message: string;
  page?: number;
  retryAfterSeconds?: number;
}

export interface DiscoveryAttribution {
  source: DiscoveryConnectorSource;
  sourceUrl: string;
  observedAt: string;
  meaning: string;
}

/**
 * Common identity fields used to combine connector output with GitHub, Hacker
 * News, and reviewed-catalog observations without pretending that those sources
 * score the same thing.
 */
export interface NormalizedDiscoveryIdentity {
  source: DiscoveryConnectorSource;
  identityKey: string;
  /** Lowercase `github:owner/repository` when a public GitHub source is present. */
  repositoryKey?: string;
  attribution: DiscoveryAttribution;
}

export interface DiscoveryConnectorResult<
  T extends NormalizedDiscoveryIdentity,
> {
  source: DiscoveryConnectorSource;
  status: DiscoveryConnectorStatus;
  fetchedAt: string;
  records: T[];
  pagesFetched: number;
  issues: DiscoveryConnectorIssue[];
  next?: string;
  cache?: { path: string; cachedAt: string };
  rateLimit?: {
    limit?: number;
    remaining?: number;
    resetAfterSeconds?: number;
  };
}

export interface BoundedJsonResponse {
  value: unknown;
  headers: Headers;
  url: string;
}

export class ConnectorRequestError extends Error {
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    options: { status?: number; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = "ConnectorRequestError";
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

function nonnegativeInteger(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function rateLimitFromHeaders(
  headers: Headers,
): DiscoveryConnectorResult<NormalizedDiscoveryIdentity>["rateLimit"] {
  const limit = nonnegativeInteger(headers.get("x-ratelimit-limit"));
  const remaining = nonnegativeInteger(headers.get("x-ratelimit-remaining"));
  const resetAfterSeconds = nonnegativeInteger(
    headers.get("x-ratelimit-reset"),
  );
  return limit !== undefined ||
    remaining !== undefined ||
    resetAfterSeconds !== undefined
    ? { limit, remaining, resetAfterSeconds }
    : undefined;
}

function retryAfter(headers: Headers): number | undefined {
  const seconds = nonnegativeInteger(headers.get("retry-after"));
  if (seconds !== undefined) return seconds;
  const date = headers.get("retry-after");
  if (!date) return undefined;
  const parsed = Date.parse(date);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.ceil((parsed - Date.now()) / 1000));
}

/** Fetch one same-origin JSON page with a shared timeout and decoded body cap. */
export async function fetchBoundedJson(
  source: string,
  options: {
    fetcher?: typeof fetch;
    headers?: HeadersInit;
    timeoutMs?: number;
    maximumBytes?: number;
    maximumRedirects?: number;
  } = {},
): Promise<BoundedJsonResponse> {
  const original = new URL(source);
  if (original.protocol !== "https:" || original.username || original.password)
    throw new ConnectorRequestError(
      "Discovery endpoints must use credential-free HTTPS",
    );
  const signal = AbortSignal.timeout(
    Math.max(250, Math.min(options.timeoutMs ?? 10_000, 120_000)),
  );
  const maximum = Math.max(
    1_024,
    Math.min(options.maximumBytes ?? 5 * 1024 * 1024, 20 * 1024 * 1024),
  );
  const maximumRedirects = Math.max(
    0,
    Math.min(options.maximumRedirects ?? 3, 5),
  );
  let current = original;
  let response: Response | undefined;
  for (let redirects = 0; redirects <= maximumRedirects; redirects++) {
    try {
      response = await (options.fetcher ?? fetch)(current, {
        method: "GET",
        headers: options.headers,
        redirect: "manual",
        signal,
      });
    } catch (error) {
      throw new ConnectorRequestError(
        `Discovery request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    if (!location)
      throw new ConnectorRequestError(
        "Discovery redirect has no Location header",
        {
          status: response.status,
        },
      );
    if (redirects === maximumRedirects)
      throw new ConnectorRequestError(
        "Discovery request exceeded its redirect limit",
      );
    const next = new URL(location, current);
    if (
      next.protocol !== "https:" ||
      next.origin !== original.origin ||
      next.username ||
      next.password
    )
      throw new ConnectorRequestError(
        "Discovery request refused a cross-origin or non-HTTPS redirect",
      );
    current = next;
  }
  if (!response)
    throw new ConnectorRequestError(
      "Discovery request did not produce a response",
    );
  if (!response.ok)
    throw new ConnectorRequestError(
      `Discovery request failed with HTTP ${response.status}`,
      {
        status: response.status,
        retryAfterSeconds: retryAfter(response.headers),
      },
    );
  const declared = nonnegativeInteger(response.headers.get("content-length"));
  if (declared !== undefined && declared > maximum)
    throw new ConnectorRequestError(
      `Discovery response exceeds the ${maximum} byte limit`,
      { status: response.status },
    );
  if (!response.body)
    throw new ConnectorRequestError("Discovery response has no body", {
      status: response.status,
    });
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (error) {
      throw new ConnectorRequestError(
        `Discovery response could not be read: ${error instanceof Error ? error.message : String(error)}`,
        { status: response.status },
      );
    }
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > maximum) {
      await reader.cancel().catch(() => undefined);
      throw new ConnectorRequestError(
        `Discovery response exceeds the ${maximum} byte limit`,
        { status: response.status },
      );
    }
    chunks.push(chunk.value);
  }
  let value: unknown;
  try {
    value = JSON.parse(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"),
    );
  } catch {
    throw new ConnectorRequestError("Discovery response is not valid JSON", {
      status: response.status,
    });
  }
  return { value, headers: response.headers, url: current.toString() };
}

interface ConnectorCache<T> {
  schemaVersion: 1;
  source: DiscoveryConnectorSource;
  cachedAt: string;
  records: T[];
}

export async function readDiscoveryConnectorCache<
  T extends NormalizedDiscoveryIdentity,
>(
  path: string,
  source: DiscoveryConnectorSource,
  validate: (value: unknown) => value is T,
  maximumRecords = 2_000,
): Promise<ConnectorCache<T> | undefined> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > 10 * 1024 * 1024) return undefined;
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      return undefined;
    const cache = value as Partial<ConnectorCache<unknown>>;
    if (
      cache.schemaVersion !== 1 ||
      cache.source !== source ||
      typeof cache.cachedAt !== "string" ||
      !Number.isFinite(Date.parse(cache.cachedAt)) ||
      !Array.isArray(cache.records) ||
      cache.records.length > maximumRecords ||
      !cache.records.every(validate)
    )
      return undefined;
    return cache as ConnectorCache<T>;
  } catch {
    return undefined;
  }
}

export async function writeDiscoveryConnectorCache<
  T extends NormalizedDiscoveryIdentity,
>(
  path: string,
  source: DiscoveryConnectorSource,
  records: T[],
  now = new Date(),
): Promise<void> {
  await ensureDirectory(dirname(path));
  await writeFileAtomically(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        source,
        cachedAt: now.toISOString(),
        records,
      } satisfies ConnectorCache<T>,
      null,
      2,
    )}\n`,
  );
}

/** Remove records already represented by another source without re-ranking. */
export function filterDiscoveryRecordsAgainstKeys<
  T extends NormalizedDiscoveryIdentity,
>(records: T[], occupiedKeys: Iterable<string>): T[] {
  const occupied = new Set(
    [...occupiedKeys].map((key) => key.trim().toLowerCase()).filter(Boolean),
  );
  return records.filter(
    (record) =>
      !occupied.has(record.identityKey.toLowerCase()) &&
      (!record.repositoryKey ||
        !occupied.has(record.repositoryKey.toLowerCase())),
  );
}
