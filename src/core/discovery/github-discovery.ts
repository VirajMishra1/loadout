export interface GitHubRepositoryLead {
  source: "github-search";
  repository: string;
  title: string;
  description: string;
  url: string;
  stars: number;
  forks: number;
  createdAt: string;
  updatedAt: string;
  query: string;
}

export interface GitHubDiscoveryOptions {
  /** One caller-supplied query. It is sent to GitHub unchanged. */
  query?: string;
  /** Multiple independent queries, primarily used by the built-in discovery. */
  queries?: string[];
  limit?: number;
  token?: string;
  fetcher?: typeof fetch;
}

/** A rolling window prevents the default discovery query from aging in place. */
export function defaultGitHubDiscoveryQuery(now = new Date()): string {
  return defaultGitHubDiscoveryQueries(now)[0];
}

/**
 * GitHub repository search does not interpret parenthesized topic OR clauses
 * as three independent topic searches. Keep the built-in sweep broad with a
 * small number of valid queries, then merge them deterministically.
 */
export function defaultGitHubDiscoveryQueries(now = new Date()): string[] {
  const start = new Date(now.getTime() - 180 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return ["mcp", "ai-agent", "agent-skills"].map(
    (topic) => `topic:${topic} created:>=${start}`,
  );
}

/** Search public GitHub repositories through the documented REST API. */
export async function discoverGitHubRepositories(
  options: GitHubDiscoveryOptions,
): Promise<GitHubRepositoryLead[]> {
  if (options.query !== undefined && options.queries !== undefined)
    throw new Error(
      "GitHub discovery accepts either query or queries, not both",
    );
  const queries = (
    options.queries ??
    (options.query === undefined
      ? defaultGitHubDiscoveryQueries()
      : [options.query])
  )
    .map((query) => query.trim())
    .filter(Boolean);
  if (!queries.length)
    throw new Error("GitHub discovery requires a non-empty query");
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const token = options.token ?? process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "loadout-discovery",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const leads: GitHubRepositoryLead[] = [];
  for (const query of queries) {
    const params = new URLSearchParams({
      q: query,
      sort: "stars",
      order: "desc",
      per_page: String(limit),
    });
    const response = await (options.fetcher ?? fetch)(
      `https://api.github.com/search/repositories?${params}`,
      { headers },
    );
    if (!response.ok) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      const reset = response.headers.get("x-ratelimit-reset");
      const retryAfter = response.headers.get("retry-after");
      const resetAt =
        reset && /^\d+$/.test(reset)
          ? new Date(Number(reset) * 1000).toISOString()
          : undefined;
      throw new Error(
        `GitHub repository discovery failed (${response.status})${remaining === "0" ? `; rate limit exhausted${resetAt ? ` until ${resetAt}` : ""}` : retryAfter ? `; retry after ${retryAfter} second(s)` : ""}`,
      );
    }
    const value: unknown = await response.json();
    if (!value || typeof value !== "object")
      throw new Error("GitHub repository discovery response is invalid");
    const items = (value as { items?: unknown }).items;
    if (!Array.isArray(items))
      throw new Error("GitHub discovery items are invalid");
    leads.push(
      ...items.flatMap((item): GitHubRepositoryLead[] => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        if (
          typeof record.full_name !== "string" ||
          typeof record.html_url !== "string"
        )
          return [];
        return [
          {
            source: "github-search",
            repository: record.full_name,
            title: record.full_name,
            description:
              typeof record.description === "string" ? record.description : "",
            url: record.html_url,
            stars:
              typeof record.stargazers_count === "number"
                ? record.stargazers_count
                : 0,
            forks:
              typeof record.forks_count === "number" ? record.forks_count : 0,
            createdAt:
              typeof record.created_at === "string" ? record.created_at : "",
            updatedAt:
              typeof record.updated_at === "string" ? record.updated_at : "",
            query,
          },
        ];
      }),
    );
  }
  const unique = new Map<string, GitHubRepositoryLead>();
  for (const lead of leads) {
    const key = lead.repository.toLowerCase();
    const existing = unique.get(key);
    if (!existing || lead.stars > existing.stars) unique.set(key, lead);
  }
  return [...unique.values()]
    .sort(
      (a, b) =>
        b.stars - a.stars ||
        b.forks - a.forks ||
        a.repository.localeCompare(b.repository),
    )
    .slice(0, limit);
}
