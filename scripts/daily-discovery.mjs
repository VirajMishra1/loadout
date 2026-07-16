#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const DAY_MS = 86_400_000;
const MAX_REPOSITORIES = 500;
const MAX_OBSERVATIONS = 90;
const RETENTION_DAYS = 180;
const README_START = "<!-- loadout:daily-discovery:start -->";
const README_END = "<!-- loadout:daily-discovery:end -->";

function isoDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid --date ${JSON.stringify(value)}; use YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`Invalid --date ${JSON.stringify(value)}; use YYYY-MM-DD`);
  }
  return parsed;
}

export function discoveryQueries(day) {
  const generated = isoDay(day);
  const activeSince = new Date(generated.getTime() - 60 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const createdSince = new Date(generated.getTime() - 180 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const common = `archived:false fork:false pushed:>=${activeSince}`;
  return [
    { id: "mcp", label: "MCP", query: `topic:mcp ${common}` },
    {
      id: "model-context-protocol",
      label: "Model Context Protocol",
      query: `topic:model-context-protocol ${common}`,
    },
    {
      id: "agent-skills",
      label: "Agent skills",
      query: `topic:agent-skills ${common}`,
    },
    {
      id: "claude-code",
      label: "Claude Code",
      query: `topic:claude-code ${common}`,
    },
    { id: "codex", label: "Codex", query: `topic:codex ${common}` },
    {
      id: "ai-agents",
      label: "AI agents",
      query: `topic:ai-agents ${common}`,
    },
    {
      id: "recent-mcp",
      label: "Recently created MCP repositories",
      query: `mcp in:name,description archived:false fork:false created:>=${createdSince}`,
    },
    {
      id: "recent-agent-skills",
      label: "Recently created agent-skill repositories",
      query: `skills agent in:name,description archived:false fork:false created:>=${createdSince}`,
    },
  ];
}

function parseArguments(argv) {
  const values = {
    date: new Date().toISOString().slice(0, 10),
    limit: 40,
    outputJson: resolve(PROJECT_ROOT, "catalog/discovered.json"),
    outputMarkdown: resolve(PROJECT_ROOT, "docs/DISCOVERED.md"),
    readme: resolve(PROJECT_ROOT, "README.md"),
    catalog: resolve(PROJECT_ROOT, "catalog/packages.json"),
    apiUrl: "https://api.github.com",
    fromExisting: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = argv[index + 1];
    if (flag === "--date" && next) values.date = next;
    else if (flag === "--limit" && next) values.limit = Number(next);
    else if (flag === "--output-json" && next)
      values.outputJson = resolve(next);
    else if (flag === "--output-markdown" && next)
      values.outputMarkdown = resolve(next);
    else if (flag === "--readme" && next) values.readme = resolve(next);
    else if (flag === "--catalog" && next) values.catalog = resolve(next);
    else if (flag === "--api-url" && next)
      values.apiUrl = next.replace(/\/$/, "");
    else if (flag === "--from-existing") {
      values.fromExisting = true;
      continue;
    } else if (flag === "--help") {
      process.stdout.write(
        "Usage: node scripts/daily-discovery.mjs [--date YYYY-MM-DD] [--limit 1..100]\n" +
          "       [--output-json PATH] [--output-markdown PATH] [--readme PATH] [--catalog PATH]\n" +
          "       [--from-existing]\n",
      );
      process.exit(0);
    } else if (flag.startsWith("--")) {
      throw new Error(`Unknown or incomplete argument: ${flag}`);
    }
    if (flag !== "--help" && next && flag.startsWith("--")) index += 1;
  }
  isoDay(values.date);
  if (
    !Number.isInteger(values.limit) ||
    values.limit < 1 ||
    values.limit > 100
  ) {
    throw new Error("--limit must be an integer from 1 to 100");
  }
  return values;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw new Error(`Could not read ${path}: ${error.message}`);
  }
}

function validateCatalog(value) {
  if (!Array.isArray(value)) throw new Error("Catalog must be a JSON array");
  const repositories = new Set();
  for (const item of value) {
    if (!item || typeof item.repository !== "string") {
      throw new Error("Every catalog record must have a repository string");
    }
    repositories.add(item.repository.toLowerCase());
  }
  return repositories;
}

function previousRepositoryMap(value) {
  if (value === undefined) return new Map();
  if (
    !value ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.repositories)
  ) {
    throw new Error("Existing discovery artifact has an unsupported schema");
  }
  return new Map(
    value.repositories
      .filter((item) => item && typeof item.repository === "string")
      .map((item) => [item.repository.toLowerCase(), item]),
  );
}

async function githubSearch({ apiUrl, query, limit, token, fetcher = fetch }) {
  const parameters = new URLSearchParams({
    q: query,
    sort: "stars",
    order: "desc",
    per_page: String(limit),
  });
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "loadout-daily-discovery",
    "x-github-api-version": "2022-11-28",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetcher(
    `${apiUrl}/search/repositories?${parameters.toString()}`,
    { headers },
  );
  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = response.headers.get("x-ratelimit-reset");
    const resetAt =
      reset && /^\d+$/.test(reset)
        ? new Date(Number(reset) * 1000).toISOString()
        : undefined;
    throw new Error(
      `GitHub search failed (${response.status}) for ${JSON.stringify(query)}` +
        (remaining === "0"
          ? `; rate limit exhausted${resetAt ? ` until ${resetAt}` : ""}`
          : ""),
    );
  }
  const body = await response.json();
  if (!body || !Array.isArray(body.items)) {
    throw new Error(
      `GitHub returned an invalid search response for ${JSON.stringify(query)}`,
    );
  }
  return body.items;
}

function normalizeRepository(item, queryId) {
  if (
    !item ||
    typeof item.full_name !== "string" ||
    typeof item.html_url !== "string" ||
    !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(
      item.html_url,
    )
  ) {
    return undefined;
  }
  if (item.archived || item.disabled || item.fork) return undefined;
  return {
    repository: item.full_name,
    url: item.html_url.replace(/\/$/, ""),
    description: typeof item.description === "string" ? item.description : "",
    stars: Number.isFinite(item.stargazers_count) ? item.stargazers_count : 0,
    forks: Number.isFinite(item.forks_count) ? item.forks_count : 0,
    openIssues: Number.isFinite(item.open_issues_count)
      ? item.open_issues_count
      : 0,
    language: typeof item.language === "string" ? item.language : null,
    license:
      item.license && typeof item.license.spdx_id === "string"
        ? item.license.spdx_id
        : "NOASSERTION",
    topics: Array.isArray(item.topics)
      ? [
          ...new Set(item.topics.filter((topic) => typeof topic === "string")),
        ].sort()
      : [],
    createdAt: typeof item.created_at === "string" ? item.created_at : "",
    pushedAt: typeof item.pushed_at === "string" ? item.pushed_at : "",
    updatedAt: typeof item.updated_at === "string" ? item.updated_at : "",
    defaultBranch:
      typeof item.default_branch === "string" ? item.default_branch : "",
    matchedQueries: [queryId],
  };
}

function repositorySort(left, right) {
  return (
    Number(right.seenInLatestRun) - Number(left.seenInLatestRun) ||
    Number(left.catalogStatus === "reviewed") -
      Number(right.catalogStatus === "reviewed") ||
    (right.starVelocityPerDay ?? right.starsPerDaySinceCreation ?? 0) -
      (left.starVelocityPerDay ?? left.starsPerDaySinceCreation ?? 0) ||
    right.stars - left.stars ||
    left.repository.localeCompare(right.repository)
  );
}

export function buildArtifact({ day, queryResults, catalog, previous }) {
  const generatedAt = `${day}T00:00:00.000Z`;
  const generatedTime = isoDay(day).getTime();
  const cataloged = validateCatalog(catalog);
  const old = previousRepositoryMap(previous);
  const current = new Map();
  for (const result of queryResults) {
    for (const raw of result.items) {
      const item = normalizeRepository(raw, result.id);
      if (!item) continue;
      const key = item.repository.toLowerCase();
      const existing = current.get(key);
      if (existing) {
        existing.matchedQueries = [
          ...new Set([...existing.matchedQueries, result.id]),
        ].sort();
      } else {
        current.set(key, item);
      }
    }
  }
  if (current.size === 0) {
    throw new Error(
      "GitHub discovery returned no valid repositories; refusing to overwrite the last healthy artifact",
    );
  }

  const merged = [];
  for (const [key, item] of current) {
    const prior = old.get(key);
    const observation = {
      observedAt: generatedAt,
      stars: item.stars,
      forks: item.forks,
    };
    const observations = [
      ...(Array.isArray(prior?.observations) ? prior.observations : []).filter(
        (entry) => entry?.observedAt !== generatedAt,
      ),
      observation,
    ]
      .filter((entry) => {
        const time = Date.parse(entry.observedAt);
        return (
          Number.isFinite(time) &&
          generatedTime - time <= RETENTION_DAYS * DAY_MS
        );
      })
      .sort((left, right) => left.observedAt.localeCompare(right.observedAt))
      .slice(-MAX_OBSERVATIONS);
    const baseline = [...observations]
      .reverse()
      .find(
        (entry) =>
          entry.observedAt !== generatedAt &&
          generatedTime - Date.parse(entry.observedAt) >= DAY_MS,
      );
    const windowDays = baseline
      ? (generatedTime - Date.parse(baseline.observedAt)) / DAY_MS
      : undefined;
    const createdTime = Date.parse(item.createdAt);
    // The observation represents a UTC date. Use the end of that date and a
    // one-day floor so same-day repositories never divide by zero or imply an
    // hourly measurement we did not take.
    const ageDays = Number.isFinite(createdTime)
      ? Math.max(1, (generatedTime + DAY_MS - createdTime) / DAY_MS)
      : undefined;
    merged.push({
      ...item,
      catalogStatus: cataloged.has(key) ? "reviewed" : "candidate",
      firstSeenAt: prior?.firstSeenAt ?? generatedAt,
      lastSeenAt: generatedAt,
      seenInLatestRun: true,
      ...(baseline && windowDays
        ? {
            starVelocityPerDay: (item.stars - baseline.stars) / windowDays,
            starVelocityWindowDays: windowDays,
          }
        : {}),
      ...(ageDays ? { starsPerDaySinceCreation: item.stars / ageDays } : {}),
      observations,
    });
  }

  for (const [key, prior] of old) {
    if (current.has(key)) continue;
    const lastSeen = Date.parse(prior.lastSeenAt);
    if (
      !Number.isFinite(lastSeen) ||
      generatedTime - lastSeen > RETENTION_DAYS * DAY_MS
    )
      continue;
    const observations = (
      Array.isArray(prior.observations) ? prior.observations : []
    )
      .filter((entry) => {
        const time = Date.parse(entry?.observedAt);
        return (
          Number.isFinite(time) &&
          generatedTime - time <= RETENTION_DAYS * DAY_MS
        );
      })
      .sort((left, right) => left.observedAt.localeCompare(right.observedAt))
      .slice(-MAX_OBSERVATIONS);
    merged.push({
      ...prior,
      catalogStatus: cataloged.has(key) ? "reviewed" : "candidate",
      seenInLatestRun: false,
      observations,
    });
  }
  merged.sort(repositorySort);
  const repositories = merged.slice(0, MAX_REPOSITORIES);
  const currentRepositories = repositories.filter(
    (item) => item.seenInLatestRun,
  );
  const queries = queryResults.map(({ id, label, query, count }) => ({
    id,
    label,
    query,
    resultCount: count,
  }));
  return {
    schemaVersion: 1,
    generatedAt,
    source: {
      provider: "GitHub REST API",
      endpoint: "GET /search/repositories",
    },
    policy: {
      automaticCatalogPromotion: false,
      automaticInstallation: false,
      humanReviewRequired: true,
      repositoryRetentionDays: RETENTION_DAYS,
      observationLimitPerRepository: MAX_OBSERVATIONS,
      repositoryLimit: MAX_REPOSITORIES,
      starVelocityMinimumWindowDays: 1,
      lifetimeAverageMinimumAgeDays: 1,
    },
    queries,
    statistics: {
      currentRepositories: currentRepositories.length,
      uncatalogedCandidates: currentRepositories.filter(
        (item) => item.catalogStatus === "candidate",
      ).length,
      reviewedRepositories: currentRepositories.filter(
        (item) => item.catalogStatus === "reviewed",
      ).length,
      retainedRepositories: repositories.length - currentRepositories.length,
    },
    repositories,
  };
}

function markdownText(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .replaceAll("\r", " ")
    .trim();
}

function compactNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function renderMarkdown(artifact) {
  const current = artifact.repositories.filter((item) => item.seenInLatestRun);
  const candidates = current.filter(
    (item) => item.catalogStatus === "candidate",
  );
  const reviewed = current.filter((item) => item.catalogStatus === "reviewed");
  const newToday = candidates.filter(
    (item) => item.firstSeenAt === artifact.generatedAt,
  );
  const measured = candidates.filter(
    (item) => item.starVelocityPerDay !== undefined,
  );
  const rows = candidates.map((item) => {
    const velocity =
      item.starVelocityPerDay === undefined
        ? "—"
        : `${item.starVelocityPerDay >= 0 ? "+" : ""}${item.starVelocityPerDay.toFixed(1)}/day (${item.starVelocityWindowDays.toFixed(1)}d)`;
    const lifetimeAverage =
      item.starsPerDaySinceCreation === undefined
        ? "—"
        : `${item.starsPerDaySinceCreation.toFixed(1)}/day`;
    return `| [${markdownText(item.repository)}](${item.url}) | ${compactNumber(item.stars)} | ${velocity} | ${lifetimeAverage} | ${markdownText(item.createdAt.slice(0, 10)) || "—"} | ${markdownText(item.license)} | ${item.matchedQueries.map(markdownText).join(", ")} | ${markdownText(item.firstSeenAt.slice(0, 10))} |`;
  });
  const reviewedRows = reviewed.map(
    (item) =>
      `| [${markdownText(item.repository)}](${item.url}) | ${compactNumber(item.stars)} | ${item.matchedQueries.map(markdownText).join(", ")} |`,
  );
  return `# Daily repository discovery

_Generated from the GitHub REST API on ${artifact.generatedAt.slice(0, 10)}. Do not edit by hand._

This is a discovery feed, not a list of recommendations. A repository appearing here is **not installed, trusted, or promoted into Loadout's reviewed catalog automatically**. Catalog admission still requires provenance, license, safety, compatibility, and capability review.

## Today at a glance

- ${current.length} repositories appeared across ${artifact.queries.length} bounded searches.
- ${candidates.length} are uncataloged review candidates; ${newToday.length} were first observed today.
- ${reviewed.length} already exist in the reviewed catalog.
- ${measured.length} candidates have a star-velocity measurement based on at least one full day of observations.
- Historical observations are bounded to ${artifact.policy.observationLimitPerRepository} per repository and candidates are retained for ${artifact.policy.repositoryRetentionDays} days.

Candidates are ordered by an observed daily star change when Loadout has observations at least one day apart. Until that exists, ordering falls back to **lifetime stars divided by repository age** (with a one-day floor). The lifetime average helps surface young breakouts on day one, but it is not evidence of current growth.

## Uncataloged candidates

| Repository | Stars | Observed velocity | Lifetime star average | Created | License API value | Matched searches | First seen |
| --- | ---: | ---: | ---: | --- | --- | --- | --- |
${rows.length ? rows.join("\n") : "| _No uncataloged candidates in today's bounded searches._ | — | — | — | — | — | — | — |"}

## Reviewed catalog repositories seen today

| Repository | Stars | Matched searches |
| --- | ---: | --- |
${reviewedRows.length ? reviewedRows.join("\n") : "| _None seen in today's bounded searches._ | — | — |"}

## Search evidence

${artifact.queries.map((query) => `- **${markdownText(query.label)}** (${query.resultCount} API results): \`${markdownText(query.query)}\``).join("\n")}

The machine-readable evidence, query counts, bounded observation history, and catalog status are in [\`catalog/discovered.json\`](../catalog/discovered.json).
`;
}

export function renderReadmeDiscoveryStatus(artifact) {
  return `${README_START}\n\n**Discovery snapshot (generated ${artifact.generatedAt.slice(0, 10)}):** [${artifact.statistics.currentRepositories} repositories observed](./docs/DISCOVERED.md), including ${artifact.statistics.uncatalogedCandidates} uncataloged review candidates and ${artifact.statistics.reviewedRepositories} repositories already in the reviewed catalog.\n${README_END}`;
}

/** Replace exactly one machine-owned block while preserving all human prose. */
export function replaceReadmeDiscoveryStatus(readme, artifact) {
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);
  if (
    start === -1 ||
    end === -1 ||
    start >= end ||
    start !== readme.lastIndexOf(README_START) ||
    end !== readme.lastIndexOf(README_END)
  ) {
    throw new Error(
      "README must contain exactly one ordered daily-discovery marker block",
    );
  }
  return `${readme.slice(0, start)}${renderReadmeDiscoveryStatus(artifact)}${readme.slice(end + README_END.length)}`;
}

async function writeAtomically(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const catalog = await readJson(options.catalog);
  const previous = await readJson(options.outputJson, undefined);
  const readme = await readFile(options.readme, "utf8");
  if (options.fromExisting) {
    if (!previous) {
      throw new Error(
        "--from-existing requires an existing discovery artifact",
      );
    }
    const nextReadme = replaceReadmeDiscoveryStatus(readme, previous);
    await writeAtomically(options.outputMarkdown, renderMarkdown(previous));
    await writeAtomically(options.readme, nextReadme);
    process.stdout.write(
      `Refreshed README discovery status from ${previous.generatedAt}.\n`,
    );
    return;
  }
  const queries = discoveryQueries(options.date);
  const queryResults = [];
  for (const query of queries) {
    const items = await githubSearch({
      apiUrl: options.apiUrl,
      query: query.query,
      limit: options.limit,
      token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
    });
    queryResults.push({ ...query, count: items.length, items });
  }
  const artifact = buildArtifact({
    day: options.date,
    queryResults,
    catalog,
    previous,
  });
  const nextReadme = replaceReadmeDiscoveryStatus(readme, artifact);
  await writeAtomically(
    options.outputJson,
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
  await writeAtomically(options.outputMarkdown, renderMarkdown(artifact));
  await writeAtomically(options.readme, nextReadme);
  process.stdout.write(
    `Recorded ${artifact.statistics.currentRepositories} current repositories (${artifact.statistics.uncatalogedCandidates} candidates, ${artifact.statistics.reviewedRepositories} reviewed) from ${queries.length} GitHub searches.\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
