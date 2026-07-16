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

export type SkillsShView = "all-time" | "trending" | "hot";

export interface SkillsShDiscoveryRecord extends NormalizedDiscoveryIdentity {
  source: "skills-sh";
  kind: "skill";
  externalId: string;
  slug: string;
  name: string;
  sourceName: string;
  sourceType: "github" | "well-known";
  installUrl: string | null;
  sourceUrl: string;
  installs: number;
  isDuplicate: boolean;
  repository?: {
    repository: string;
    url: string;
    immutable: false;
    limitation: string;
  };
  ranking: {
    provider: "skills.sh";
    view: SkillsShView;
    position: number;
    installs: number;
    installsYesterday?: number;
    change?: number;
    meaning: string;
    uncertainty: string;
  };
}

export interface SkillsShDiscoveryOptions {
  view?: SkillsShView;
  maxRecords?: number;
  pageSize?: number;
  maxPages?: number;
  token?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  cachePath?: string | false;
  now?: Date;
}

const SOURCE = "skills-sh" as const;
const API = "https://skills.sh/api/v1/skills";
const ATTRIBUTION = "https://skills.sh/docs/api";
const REPOSITORY_LIMITATION =
  "skills.sh leaderboard metadata identifies a mutable GitHub repository but supplies no Git commit; Loadout must resolve and inspect an immutable commit before review or installation.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeInteger(
  value: unknown,
  options: { signed?: boolean } = {},
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    (options.signed || value >= 0)
  );
}

function boundedString(
  value: unknown,
  maximum: number,
  options: { empty?: boolean } = {},
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    (options.empty || value.length > 0) &&
    !/[\0\r\n]/.test(value)
  );
}

function githubRepository(value: string): string | undefined {
  const normalized = value.replace(/\.git$/i, "").replace(/\/$/, "");
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)
    ? normalized
    : undefined;
}

function validHttpsUrl(value: string, origin?: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!origin || url.origin === origin)
    );
  } catch {
    return false;
  }
}

function rankingMeaning(view: SkillsShView): string {
  if (view === "all-time")
    return "skills.sh all-time leaderboard position and total deduplicated installs";
  if (view === "trending")
    return "skills.sh recent-growth leaderboard position; installs remains a total install count, not a growth rate";
  return "skills.sh hot leaderboard position; change compares the current hour with the same hour yesterday";
}

function normalizeSkill(
  value: unknown,
  view: SkillsShView,
  position: number,
  observedAt: string,
): SkillsShDiscoveryRecord | undefined {
  if (!isRecord(value)) return undefined;
  const {
    id,
    slug,
    name,
    source,
    installs,
    sourceType,
    installUrl,
    url,
    isDuplicate,
    installsYesterday,
    change,
  } = value;
  if (
    !boundedString(id, 512) ||
    !boundedString(slug, 200) ||
    !boundedString(name, 300) ||
    !boundedString(source, 300) ||
    id !== `${source}/${slug}` ||
    !safeInteger(installs) ||
    (sourceType !== "github" && sourceType !== "well-known") ||
    (installUrl !== null && !boundedString(installUrl, 2_048)) ||
    !boundedString(url, 2_048) ||
    !validHttpsUrl(url, "https://skills.sh") ||
    (isDuplicate !== undefined && typeof isDuplicate !== "boolean") ||
    (installsYesterday !== undefined && !safeInteger(installsYesterday)) ||
    (change !== undefined && !safeInteger(change, { signed: true }))
  )
    return undefined;
  let repository: SkillsShDiscoveryRecord["repository"];
  let repositoryKey: string | undefined;
  if (sourceType === "github") {
    const normalized = githubRepository(source);
    if (
      !normalized ||
      typeof installUrl !== "string" ||
      !validHttpsUrl(installUrl, "https://github.com")
    )
      return undefined;
    const installPath = new URL(installUrl).pathname
      .replace(/^\//, "")
      .replace(/\.git$/i, "")
      .replace(/\/$/, "");
    if (installPath.toLowerCase() !== normalized.toLowerCase())
      return undefined;
    repository = {
      repository: normalized,
      url: `https://github.com/${normalized}`,
      immutable: false,
      limitation: REPOSITORY_LIMITATION,
    };
    repositoryKey = `github:${normalized.toLowerCase()}`;
  } else if (installUrl !== null && !validHttpsUrl(installUrl))
    return undefined;
  return {
    source: SOURCE,
    kind: "skill",
    identityKey: `skills-sh:${id.toLowerCase()}`,
    ...(repositoryKey ? { repositoryKey } : {}),
    externalId: id,
    slug,
    name,
    sourceName: source,
    sourceType,
    installUrl,
    sourceUrl: url,
    installs,
    isDuplicate: isDuplicate ?? false,
    ...(repository ? { repository } : {}),
    ranking: {
      provider: "skills.sh",
      view,
      position,
      installs,
      ...(installsYesterday !== undefined ? { installsYesterday } : {}),
      ...(change !== undefined ? { change } : {}),
      meaning: rankingMeaning(view),
      uncertainty:
        "Anonymous install telemetry is an adoption signal only; it is not safety, quality, compatibility, or performance evidence.",
    },
    attribution: {
      source: SOURCE,
      sourceUrl: ATTRIBUTION,
      observedAt,
      meaning:
        "Metadata and leaderboard order reported by skills.sh; Loadout did not install or execute the skill.",
    },
  };
}

function parsePage(
  value: unknown,
  expectedPage: number,
  pageSize: number,
): {
  data: unknown[];
  hasMore: boolean;
  total: number;
} {
  if (
    !isRecord(value) ||
    !Array.isArray(value.data) ||
    !isRecord(value.pagination)
  )
    throw new Error("skills.sh response envelope is invalid");
  const page = value.pagination.page;
  const perPage = value.pagination.perPage;
  const total = value.pagination.total;
  const hasMore = value.pagination.hasMore;
  if (
    page !== expectedPage ||
    !safeInteger(perPage) ||
    perPage < 1 ||
    perPage > 500 ||
    !safeInteger(total) ||
    typeof hasMore !== "boolean" ||
    value.data.length > pageSize
  )
    throw new Error("skills.sh pagination metadata is invalid");
  return { data: value.data, hasMore, total };
}

export function isSkillsShDiscoveryRecord(
  value: unknown,
): value is SkillsShDiscoveryRecord {
  if (!isRecord(value)) return false;
  const record = value as Partial<SkillsShDiscoveryRecord>;
  return (
    record.source === SOURCE &&
    record.kind === "skill" &&
    boundedString(record.identityKey, 1_024) &&
    boundedString(record.externalId, 512) &&
    boundedString(record.slug, 200) &&
    boundedString(record.name, 300) &&
    boundedString(record.sourceName, 300) &&
    (record.sourceType === "github" || record.sourceType === "well-known") &&
    safeInteger(record.installs) &&
    typeof record.isDuplicate === "boolean" &&
    boundedString(record.sourceUrl, 2_048) &&
    isRecord(record.ranking) &&
    isRecord(record.attribution) &&
    record.attribution.source === SOURCE &&
    boundedString(record.attribution.observedAt, 64) &&
    Number.isFinite(Date.parse(record.attribution.observedAt))
  );
}

function issueFromError(error: unknown, page: number): DiscoveryConnectorIssue {
  if (error instanceof ConnectorRequestError) {
    return {
      code:
        error.status === 401
          ? "authentication-required"
          : error.status === 429
            ? "rate-limited"
            : "request-failed",
      message: `skills.sh page ${page} failed: ${error.message}`,
      page,
      ...(error.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
    };
  }
  return {
    code: "invalid-response",
    message: `skills.sh page ${page} was invalid: ${error instanceof Error ? error.message : String(error)}`,
    page,
  };
}

async function cachedOrUnavailable(
  cachePath: string | false,
  fetchedAt: string,
  issues: DiscoveryConnectorIssue[],
): Promise<DiscoveryConnectorResult<SkillsShDiscoveryRecord>> {
  const cachedPath = cachePath === false ? undefined : cachePath;
  const cache =
    cachedPath === undefined
      ? undefined
      : await readDiscoveryConnectorCache(
          cachedPath,
          SOURCE,
          isSkillsShDiscoveryRecord,
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

/**
 * Read the authenticated skills.sh leaderboard. Candidate files are never
 * downloaded; output remains metadata-only and requires later immutable review.
 */
export async function discoverSkillsSh(
  options: SkillsShDiscoveryOptions = {},
): Promise<DiscoveryConnectorResult<SkillsShDiscoveryRecord>> {
  const now = options.now ?? new Date();
  const fetchedAt = now.toISOString();
  const view = options.view ?? "trending";
  const pageSize = Math.max(1, Math.min(options.pageSize ?? 100, 100));
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 5, 10));
  const maxRecords = Math.max(1, Math.min(options.maxRecords ?? 500, 1_000));
  const cachePath =
    options.cachePath === false
      ? false
      : (options.cachePath ??
        join(loadoutHome(), "discovery-cache", `skills-sh-${view}.json`));
  const token = (options.token ?? process.env.VERCEL_OIDC_TOKEN)?.trim();
  if (!token || /[\0\r\n]/.test(token))
    return cachedOrUnavailable(cachePath, fetchedAt, [
      {
        code: "authentication-required",
        message:
          "skills.sh requires a request-scoped Vercel OIDC token; set VERCEL_OIDC_TOKEN or pass token without persisting it",
      },
    ]);

  const records: SkillsShDiscoveryRecord[] = [];
  const identities = new Set<string>();
  const issues: DiscoveryConnectorIssue[] = [];
  let pagesFetched = 0;
  let hasMore = true;
  let nextPage: number | undefined;
  let stoppedByFailure = false;
  let stoppedByRecordLimit = false;
  let truncatedWithinPage = false;
  let rateLimit: DiscoveryConnectorResult<SkillsShDiscoveryRecord>["rateLimit"];
  for (
    let page = 0;
    page < maxPages && hasMore && records.length < maxRecords;
    page++
  ) {
    const url = new URL(API);
    url.searchParams.set("view", view);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(pageSize));
    try {
      const response = await fetchBoundedJson(url.toString(), {
        fetcher: options.fetcher,
        timeoutMs: options.timeoutMs,
        maximumBytes: 5 * 1024 * 1024,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "user-agent": "loadout-ai-discovery",
        },
      });
      pagesFetched++;
      rateLimit = rateLimitFromHeaders(response.headers) ?? rateLimit;
      const parsed = parsePage(response.value, page, pageSize);
      hasMore = parsed.hasMore;
      if (hasMore && parsed.data.length === 0)
        throw new Error("skills.sh returned an empty page with hasMore=true");
      for (const [index, value] of parsed.data.entries()) {
        const normalized = normalizeSkill(
          value,
          view,
          page * pageSize + index + 1,
          fetchedAt,
        );
        if (!normalized) {
          issues.push({
            code: "invalid-record",
            message: `skills.sh page ${page} record ${index + 1} was skipped because it failed the bounded metadata schema`,
            page,
          });
          continue;
        }
        if (identities.has(normalized.identityKey)) {
          issues.push({
            code: "duplicate-record",
            message: `skills.sh repeated ${normalized.externalId}; the earliest leaderboard position was retained`,
            page,
          });
          continue;
        }
        identities.add(normalized.identityKey);
        records.push(normalized);
        if (records.length >= maxRecords) {
          truncatedWithinPage = index < parsed.data.length - 1;
          stoppedByRecordLimit = truncatedWithinPage || hasMore;
          break;
        }
      }
      nextPage = hasMore && !truncatedWithinPage ? page + 1 : undefined;
    } catch (error) {
      issues.push(issueFromError(error, page));
      stoppedByFailure = true;
      break;
    }
  }
  if (!stoppedByFailure && stoppedByRecordLimit)
    issues.push({
      code: "pagination-limit",
      message: `skills.sh pagination stopped at the configured ${maxRecords}-record limit${truncatedWithinPage ? "; no continuation is exposed because the limit was reached within a page" : ""}`,
      ...(nextPage !== undefined ? { page: nextPage } : {}),
    });
  else if (
    !stoppedByFailure &&
    hasMore &&
    nextPage !== undefined &&
    pagesFetched >= maxPages
  )
    issues.push({
      code: "pagination-limit",
      message: `skills.sh pagination stopped at the configured ${maxPages}-page limit`,
      page: nextPage,
    });
  if (!records.length && issues.length)
    return cachedOrUnavailable(cachePath, fetchedAt, issues);
  let status: DiscoveryConnectorResult<SkillsShDiscoveryRecord>["status"] =
    issues.length ? "partial" : "complete";
  if (status === "complete" && cachePath !== false) {
    try {
      await writeDiscoveryConnectorCache(cachePath, SOURCE, records, now);
    } catch (error) {
      status = "partial";
      issues.push({
        code: "cache-write-failed",
        message: `skills.sh metadata was fetched but its offline cache could not be written: ${error instanceof Error ? error.message : String(error)}`,
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
    ...(nextPage !== undefined && hasMore ? { next: String(nextPage) } : {}),
    ...(rateLimit ? { rateLimit } : {}),
  };
}
