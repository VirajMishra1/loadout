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
  query: string;
  limit?: number;
  token?: string;
  fetcher?: typeof fetch;
}

/** A rolling window prevents the default discovery query from aging in place. */
export function defaultGitHubDiscoveryQuery(now = new Date()): string {
  const start = new Date(now.getTime() - 180 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return `(topic:mcp OR topic:agent OR topic:skills) created:>=${start}`;
}

/** Search public GitHub repositories through the documented REST API. */
export async function discoverGitHubRepositories(
  options: GitHubDiscoveryOptions,
): Promise<GitHubRepositoryLead[]> {
  const query = options.query.trim();
  if (!query) throw new Error("GitHub discovery requires a non-empty query");
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const params = new URLSearchParams({
    q: query,
    sort: "stars",
    order: "desc",
    per_page: String(limit),
  });
  const token = options.token ?? process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "loadout-discovery",
  };
  if (token) headers.authorization = `Bearer ${token}`;
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
  return items.flatMap((item): GitHubRepositoryLead[] => {
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
        forks: typeof record.forks_count === "number" ? record.forks_count : 0,
        createdAt:
          typeof record.created_at === "string" ? record.created_at : "",
        updatedAt:
          typeof record.updated_at === "string" ? record.updated_at : "",
        query,
      },
    ];
  });
}
