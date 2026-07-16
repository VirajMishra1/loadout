import { join } from "node:path";
import {
  ConnectorRequestError,
  fetchBoundedJson,
  rateLimitFromHeaders,
  readDiscoveryConnectorCache,
  writeDiscoveryConnectorCache,
  type DiscoveryConnectorIssue,
  type DiscoveryConnectorResult,
  type NormalizedDiscoveryIdentity,
} from "./discovery-connector.js";
import { loadoutHome } from "./paths.js";

export interface McpRegistryDistribution {
  kind: "package" | "remote";
  type: string;
  identifier: string;
  version?: string;
  transport: "stdio" | "sse" | "streamable-http";
  integritySha256?: string;
}

export interface McpRegistryDiscoveryRecord extends NormalizedDiscoveryIdentity {
  source: "official-mcp-registry";
  kind: "mcp-server";
  externalId: string;
  namespace: string;
  name: string;
  title?: string;
  description: string;
  version: string;
  sourceUrl: string;
  repository?: {
    url: string;
    source: string;
    id?: string;
    subfolder?: string;
    repository?: string;
  };
  distributions: McpRegistryDistribution[];
  verification: {
    registry: "Official MCP Registry";
    lifecycleStatus: "active" | "deprecated" | "deleted" | "unknown";
    statusMessage?: string;
    publishedAt?: string;
    updatedAt?: string;
    statusChangedAt?: string;
    isLatest?: boolean;
    namespaceEvidence: string;
    meaning: string;
  };
}

export interface McpRegistryDiscoveryOptions {
  search?: string;
  updatedSince?: string;
  latestOnly?: boolean;
  includeDeleted?: boolean;
  maxRecords?: number;
  pageSize?: number;
  maxPages?: number;
  cursor?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  cachePath?: string | false;
  now?: Date;
}

const SOURCE = "official-mcp-registry" as const;
const API = "https://registry.modelcontextprotocol.io/v0.1/servers";
const ATTRIBUTION = "https://registry.modelcontextprotocol.io/docs";
const SERVER_NAME = /^[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedString(
  value: unknown,
  maximum: number,
  options: { empty?: boolean; multiline?: boolean } = {},
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    (options.empty || value.length > 0) &&
    !value.includes("\0") &&
    (options.multiline || !/[\r\n]/.test(value))
  );
}

function validDate(value: unknown): value is string {
  return (
    boundedString(value, 64) && Number.isFinite(Date.parse(value as string))
  );
}

function safeRelativePath(value: unknown): value is string {
  return (
    boundedString(value, 1_024) &&
    !value.startsWith("/") &&
    !value.split(/[\\/]/).includes("..")
  );
}

function safeHttpsUrl(value: unknown): value is string {
  if (!boundedString(value, 2_048)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function githubRepository(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.origin !== "https://github.com") return undefined;
    const path = url.pathname
      .replace(/^\//, "")
      .replace(/\.git$/i, "")
      .replace(/\/$/, "");
    return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

function transportType(
  value: unknown,
): McpRegistryDistribution["transport"] | undefined {
  if (!isRecord(value)) return undefined;
  return value.type === "stdio" ||
    value.type === "sse" ||
    value.type === "streamable-http"
    ? value.type
    : undefined;
}

function normalizePackages(
  value: unknown,
): McpRegistryDistribution[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) return undefined;
  const distributions: McpRegistryDistribution[] = [];
  for (const item of value) {
    if (!isRecord(item)) return undefined;
    const transport = transportType(item.transport);
    if (
      !boundedString(item.registryType, 64) ||
      !boundedString(item.identifier, 2_048) ||
      !transport ||
      (item.version !== undefined && !boundedString(item.version, 255)) ||
      (item.fileSha256 !== undefined &&
        (typeof item.fileSha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(item.fileSha256)))
    )
      return undefined;
    distributions.push({
      kind: "package",
      type: item.registryType,
      identifier: item.identifier,
      ...(typeof item.version === "string" ? { version: item.version } : {}),
      transport,
      ...(typeof item.fileSha256 === "string"
        ? { integritySha256: item.fileSha256 }
        : {}),
    });
  }
  return distributions;
}

function normalizeRemotes(
  value: unknown,
): McpRegistryDistribution[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) return undefined;
  const distributions: McpRegistryDistribution[] = [];
  for (const item of value) {
    if (!isRecord(item)) return undefined;
    const transport = transportType(item);
    if (
      (transport !== "sse" && transport !== "streamable-http") ||
      !safeHttpsUrl(item.url)
    )
      return undefined;
    distributions.push({
      kind: "remote",
      type: transport,
      identifier: item.url,
      transport,
    });
  }
  return distributions;
}

function normalizeRepository(
  value: unknown,
): McpRegistryDiscoveryRecord["repository"] | undefined | false {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    !safeHttpsUrl(value.url) ||
    !boundedString(value.source, 100) ||
    (value.id !== undefined && !boundedString(value.id, 255)) ||
    (value.subfolder !== undefined && !safeRelativePath(value.subfolder))
  )
    return false;
  const repository =
    value.source.toLowerCase() === "github"
      ? githubRepository(value.url)
      : undefined;
  if (value.source.toLowerCase() === "github" && !repository) return false;
  return {
    url: value.url,
    source: value.source,
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    ...(typeof value.subfolder === "string"
      ? { subfolder: value.subfolder }
      : {}),
    ...(repository ? { repository } : {}),
  };
}

function officialMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const official = value["io.modelcontextprotocol.registry/official"];
  return isRecord(official) ? official : undefined;
}

function normalizeServer(
  value: unknown,
  observedAt: string,
): McpRegistryDiscoveryRecord | undefined {
  if (!isRecord(value) || !isRecord(value.server)) return undefined;
  const server = value.server;
  if (
    !boundedString(server.name, 200) ||
    !SERVER_NAME.test(server.name) ||
    !boundedString(server.description, 100, { multiline: true }) ||
    !boundedString(server.version, 255) ||
    server.version === "latest" ||
    (server.title !== undefined && !boundedString(server.title, 100))
  )
    return undefined;
  const repository = normalizeRepository(server.repository);
  const packages = normalizePackages(server.packages);
  const remotes = normalizeRemotes(server.remotes);
  if (repository === false || !packages || !remotes) return undefined;
  const meta = officialMetadata(value._meta);
  const status = meta?.status;
  const lifecycleStatus =
    status === "active" || status === "deprecated" || status === "deleted"
      ? status
      : "unknown";
  if (
    (meta?.status !== undefined && lifecycleStatus === "unknown") ||
    (meta?.statusMessage !== undefined &&
      !boundedString(meta.statusMessage, 500, { multiline: true })) ||
    (meta?.publishedAt !== undefined && !validDate(meta.publishedAt)) ||
    (meta?.updatedAt !== undefined && !validDate(meta.updatedAt)) ||
    (meta?.statusChangedAt !== undefined && !validDate(meta.statusChangedAt)) ||
    (meta?.isLatest !== undefined && typeof meta.isLatest !== "boolean")
  )
    return undefined;
  const namespace = server.name.split("/", 1)[0];
  const repositoryKey = repository?.repository
    ? `github:${repository.repository.toLowerCase()}`
    : undefined;
  const sourceUrl = `${API}/${encodeURIComponent(server.name)}/versions/${encodeURIComponent(server.version)}`;
  return {
    source: SOURCE,
    kind: "mcp-server",
    identityKey: `mcp-registry:${server.name.toLowerCase()}@${server.version}`,
    ...(repositoryKey ? { repositoryKey } : {}),
    externalId: `${server.name}@${server.version}`,
    namespace,
    name: server.name,
    ...(typeof server.title === "string" ? { title: server.title } : {}),
    description: server.description,
    version: server.version,
    sourceUrl,
    ...(repository ? { repository } : {}),
    distributions: [...packages, ...remotes],
    verification: {
      registry: "Official MCP Registry",
      lifecycleStatus,
      ...(typeof meta?.statusMessage === "string"
        ? { statusMessage: meta.statusMessage }
        : {}),
      ...(typeof meta?.publishedAt === "string"
        ? { publishedAt: meta.publishedAt }
        : {}),
      ...(typeof meta?.updatedAt === "string"
        ? { updatedAt: meta.updatedAt }
        : {}),
      ...(typeof meta?.statusChangedAt === "string"
        ? { statusChangedAt: meta.statusChangedAt }
        : {}),
      ...(typeof meta?.isLatest === "boolean"
        ? { isLatest: meta.isLatest }
        : {}),
      namespaceEvidence:
        "The official registry records publisher namespace verification for publication; Loadout did not independently re-prove namespace ownership.",
      meaning:
        "Registry membership establishes identity and distribution metadata only, not safety, popularity, availability, permissions, or performance.",
    },
    attribution: {
      source: SOURCE,
      sourceUrl: ATTRIBUTION,
      observedAt,
      meaning:
        "Metadata reported by the read-only Official MCP Registry v0.1 API; no server or package was installed or executed.",
    },
  };
}

function parsePage(
  value: unknown,
  pageSize: number,
): { servers: unknown[]; nextCursor?: string } {
  if (!isRecord(value) || !Array.isArray(value.servers))
    throw new Error("Official MCP Registry response envelope is invalid");
  if (value.servers.length > pageSize)
    throw new Error("Official MCP Registry exceeded the requested page size");
  if (value.metadata !== undefined && !isRecord(value.metadata))
    throw new Error("Official MCP Registry pagination metadata is invalid");
  const count = isRecord(value.metadata) ? value.metadata.count : undefined;
  const nextCursor = isRecord(value.metadata)
    ? value.metadata.nextCursor
    : undefined;
  if (
    (count !== undefined &&
      (!Number.isSafeInteger(count) || count !== value.servers.length)) ||
    (nextCursor !== undefined && !boundedString(nextCursor, 2_048))
  )
    throw new Error("Official MCP Registry pagination metadata is invalid");
  return {
    servers: value.servers,
    ...(typeof nextCursor === "string" && nextCursor ? { nextCursor } : {}),
  };
}

export function isMcpRegistryDiscoveryRecord(
  value: unknown,
): value is McpRegistryDiscoveryRecord {
  if (!isRecord(value)) return false;
  const record = value as Partial<McpRegistryDiscoveryRecord>;
  return (
    record.source === SOURCE &&
    record.kind === "mcp-server" &&
    boundedString(record.identityKey, 1_024) &&
    boundedString(record.externalId, 512) &&
    boundedString(record.namespace, 200) &&
    boundedString(record.name, 200) &&
    SERVER_NAME.test(record.name) &&
    boundedString(record.description, 100, { multiline: true }) &&
    boundedString(record.version, 255) &&
    boundedString(record.sourceUrl, 2_048) &&
    Array.isArray(record.distributions) &&
    record.distributions.length <= 100 &&
    isRecord(record.verification) &&
    isRecord(record.attribution) &&
    record.attribution.source === SOURCE &&
    validDate(record.attribution.observedAt)
  );
}

function issueFromError(error: unknown, page: number): DiscoveryConnectorIssue {
  if (error instanceof ConnectorRequestError)
    return {
      code: error.status === 429 ? "rate-limited" : "request-failed",
      message: `Official MCP Registry page ${page} failed: ${error.message}`,
      page,
      ...(error.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
    };
  return {
    code: "invalid-response",
    message: `Official MCP Registry page ${page} was invalid: ${error instanceof Error ? error.message : String(error)}`,
    page,
  };
}

async function cachedOrUnavailable(
  cachePath: string | false,
  fetchedAt: string,
  issues: DiscoveryConnectorIssue[],
): Promise<DiscoveryConnectorResult<McpRegistryDiscoveryRecord>> {
  const cachedPath = cachePath === false ? undefined : cachePath;
  const cache =
    cachedPath === undefined
      ? undefined
      : await readDiscoveryConnectorCache(
          cachedPath,
          SOURCE,
          isMcpRegistryDiscoveryRecord,
        );
  return cache
    ? {
        source: SOURCE,
        status: "cached",
        fetchedAt,
        records: cache.records,
        pagesFetched: 0,
        issues,
        cache: { path: cachedPath!, cachedAt: cache.cachedAt },
      }
    : {
        source: SOURCE,
        status: "unavailable",
        fetchedAt,
        records: [],
        pagesFetched: 0,
        issues,
      };
}

/** Read public identity/distribution metadata from the official v0.1 registry. */
export async function discoverOfficialMcpRegistry(
  options: McpRegistryDiscoveryOptions = {},
): Promise<DiscoveryConnectorResult<McpRegistryDiscoveryRecord>> {
  const now = options.now ?? new Date();
  const fetchedAt = now.toISOString();
  const pageSize = Math.max(1, Math.min(options.pageSize ?? 100, 100));
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 5, 10));
  const maxRecords = Math.max(1, Math.min(options.maxRecords ?? 500, 1_000));
  const search = options.search?.trim();
  if (search && (!boundedString(search, 200) || search.length < 2))
    throw new Error(
      "Official MCP Registry search must be 2-200 safe characters",
    );
  if (
    options.updatedSince !== undefined &&
    (!validDate(options.updatedSince) || options.updatedSince.length > 64)
  )
    throw new Error(
      "Official MCP Registry updatedSince must be an RFC3339 date",
    );
  if (options.cursor !== undefined && !boundedString(options.cursor, 2_048))
    throw new Error("Official MCP Registry cursor is invalid");
  const cachePath =
    options.cachePath === false
      ? false
      : (options.cachePath ??
        join(loadoutHome(), "discovery-cache", "official-mcp-registry.json"));
  const records: McpRegistryDiscoveryRecord[] = [];
  const positions = new Map<string, number>();
  const issues: DiscoveryConnectorIssue[] = [];
  const seenCursors = new Set<string>();
  let cursor = options.cursor;
  let pagesFetched = 0;
  let stoppedByFailure = false;
  let stoppedByRecordLimit = false;
  let truncatedWithinPage = false;
  let rateLimit: DiscoveryConnectorResult<McpRegistryDiscoveryRecord>["rateLimit"];
  for (let page = 0; page < maxPages && records.length < maxRecords; page++) {
    if (cursor) {
      if (seenCursors.has(cursor)) {
        issues.push({
          code: "pagination-replay",
          message:
            "Official MCP Registry repeated a pagination cursor; traversal stopped",
          page,
        });
        stoppedByFailure = true;
        break;
      }
      seenCursors.add(cursor);
    }
    const url = new URL(API);
    url.searchParams.set("limit", String(pageSize));
    if (cursor) url.searchParams.set("cursor", cursor);
    if (search) url.searchParams.set("search", search);
    if (options.updatedSince)
      url.searchParams.set("updated_since", options.updatedSince);
    if (options.latestOnly !== false) url.searchParams.set("version", "latest");
    if (options.includeDeleted) url.searchParams.set("include_deleted", "true");
    try {
      const response = await fetchBoundedJson(url.toString(), {
        fetcher: options.fetcher,
        // The public registry can take slightly over ten seconds from a cold
        // edge. Keep the request bounded while avoiding false offline results.
        timeoutMs: options.timeoutMs ?? 20_000,
        maximumBytes: 8 * 1024 * 1024,
        headers: {
          accept: "application/json",
          "user-agent": "loadout-ai-discovery",
        },
      });
      pagesFetched++;
      rateLimit = rateLimitFromHeaders(response.headers) ?? rateLimit;
      const parsed = parsePage(response.value, pageSize);
      for (const [index, value] of parsed.servers.entries()) {
        const normalized = normalizeServer(value, fetchedAt);
        if (!normalized) {
          issues.push({
            code: "invalid-record",
            message: `Official MCP Registry page ${page} record ${index + 1} was skipped because it failed the bounded v0.1 metadata schema`,
            page,
          });
          continue;
        }
        const existingIndex = positions.get(normalized.identityKey);
        if (existingIndex !== undefined) {
          const existing = records[existingIndex];
          const existingUpdated = Date.parse(
            existing.verification.updatedAt ??
              existing.verification.publishedAt ??
              new Date(0).toISOString(),
          );
          const candidateUpdated = Date.parse(
            normalized.verification.updatedAt ??
              normalized.verification.publishedAt ??
              new Date(0).toISOString(),
          );
          if (candidateUpdated > existingUpdated)
            records[existingIndex] = normalized;
          issues.push({
            code: "duplicate-record",
            message: `Official MCP Registry repeated ${normalized.externalId}; the most recently updated copy was retained`,
            page,
          });
          continue;
        }
        positions.set(normalized.identityKey, records.length);
        records.push(normalized);
        if (records.length >= maxRecords) {
          truncatedWithinPage = index < parsed.servers.length - 1;
          stoppedByRecordLimit =
            truncatedWithinPage || Boolean(parsed.nextCursor);
          break;
        }
      }
      cursor = truncatedWithinPage ? undefined : parsed.nextCursor;
      if (!cursor) break;
    } catch (error) {
      issues.push(issueFromError(error, page));
      stoppedByFailure = true;
      break;
    }
  }
  if (!stoppedByFailure && stoppedByRecordLimit)
    issues.push({
      code: "pagination-limit",
      message: `Official MCP Registry pagination stopped at the configured ${maxRecords}-record limit${truncatedWithinPage ? "; no continuation is exposed because the limit was reached within a page" : ""}`,
      page: pagesFetched,
    });
  else if (!stoppedByFailure && cursor && pagesFetched >= maxPages)
    issues.push({
      code: "pagination-limit",
      message: `Official MCP Registry pagination stopped at the configured ${maxPages}-page limit`,
      page: pagesFetched,
    });
  if (!records.length && issues.length)
    return cachedOrUnavailable(cachePath, fetchedAt, issues);
  let status: DiscoveryConnectorResult<McpRegistryDiscoveryRecord>["status"] =
    issues.length ? "partial" : "complete";
  if (status === "complete" && cachePath !== false) {
    try {
      await writeDiscoveryConnectorCache(cachePath, SOURCE, records, now);
    } catch (error) {
      status = "partial";
      issues.push({
        code: "cache-write-failed",
        message: `Official MCP Registry metadata was fetched but its offline cache could not be written: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return {
    source: SOURCE,
    status,
    fetchedAt,
    records,
    pagesFetched,
    issues,
    ...(cursor ? { next: cursor } : {}),
    ...(rateLimit ? { rateLimit } : {}),
  };
}
