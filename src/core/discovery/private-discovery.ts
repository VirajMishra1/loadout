export interface PrivateRepositoryLead {
  id: number;
  repository: string;
  description: string;
  defaultBranch: string;
  updatedAt: string;
  topics: string[];
}

export interface PrivateRepositoryDiscoveryOptions {
  /** A short-lived token supplied by the caller; never persisted by Loadout. */
  token?: string;
  fetcher?: typeof fetch;
}

/**
 * Opt-in private discovery using a caller-provided GitHub token. OAuth/App
 * brokering remains a deployment concern; this function proves the safe data
 * boundary and never places the token in a URL, result, cache, or log.
 */
export async function discoverPrivateRepositories(
  options: PrivateRepositoryDiscoveryOptions = {},
): Promise<PrivateRepositoryLead[]> {
  const token = options.token ?? process.env.GITHUB_TOKEN;
  if (!token)
    throw new Error(
      "Private discovery requires an explicit GITHUB_TOKEN or token option; public discovery needs no credentials",
    );
  const response = await (options.fetcher ?? fetch)(
    "https://api.github.com/user/repos?visibility=private&affiliation=owner,collaborator,organization_member&per_page=100",
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "loadout-discovery",
      },
    },
  );
  if (!response.ok)
    throw new Error(`Private GitHub discovery failed (${response.status})`);
  const value: unknown = await response.json();
  if (!Array.isArray(value))
    throw new Error("Private GitHub discovery response is invalid");
  return value.flatMap((item): PrivateRepositoryLead[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (
      record.private !== true ||
      typeof record.id !== "number" ||
      typeof record.full_name !== "string"
    )
      return [];
    return [
      {
        id: record.id,
        repository: record.full_name,
        description:
          typeof record.description === "string" ? record.description : "",
        defaultBranch:
          typeof record.default_branch === "string"
            ? record.default_branch
            : "main",
        updatedAt:
          typeof record.updated_at === "string" ? record.updated_at : "",
        topics: Array.isArray(record.topics)
          ? record.topics.filter(
              (topic): topic is string => typeof topic === "string",
            )
          : [],
      },
    ];
  });
}
