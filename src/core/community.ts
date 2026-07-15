export interface HackerNewsStory {
  id: number;
  type: "story";
  title: string;
  url?: string;
  text?: string;
  score?: number;
  descendants?: number;
  time?: number;
  dead?: boolean;
  deleted?: boolean;
}

export interface CommunityRepositoryCandidate {
  source: "hacker-news";
  repository: string;
  title: string;
  storyId: number;
  storyUrl: string;
  discussionUrl: string;
  score: number;
  comments: number;
  createdAt: string;
}

export interface HackerNewsDiscoveryResult {
  source: "hacker-news";
  fetchedAt: string;
  storiesScanned: number;
  candidates: CommunityRepositoryCandidate[];
}

export interface HackerNewsDiscoveryOptions {
  /** Scan this many front-page IDs at most. The official endpoint is public. */
  limit?: number;
  /** Ignore low-signal stories without hiding their source evidence. */
  minScore?: number;
  fetcher?: typeof fetch;
}

const API_BASE = "https://hacker-news.firebaseio.com/v0";
const GITHUB_REPOSITORY =
  /(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/gi;

function repositoryFromText(value: string): string | undefined {
  const match = GITHUB_REPOSITORY.exec(value);
  GITHUB_REPOSITORY.lastIndex = 0;
  if (!match) return undefined;
  const owner = match[1];
  const repository = match[2].replace(/(?:\.git|[?#].*)$/i, "");
  if (!owner || !repository) return undefined;
  return `${owner}/${repository}`;
}

function storyCandidate(
  story: HackerNewsStory,
  minScore: number,
): CommunityRepositoryCandidate | undefined {
  if (
    story.type !== "story" ||
    story.dead ||
    story.deleted ||
    !Number.isInteger(story.id) ||
    !story.title ||
    (story.score ?? 0) < minScore
  )
    return undefined;
  const repository = repositoryFromText(
    `${story.url ?? ""}\n${story.text ?? ""}`,
  );
  if (!repository) return undefined;
  return {
    source: "hacker-news",
    repository,
    title: story.title,
    storyId: story.id,
    storyUrl: story.url ?? `https://news.ycombinator.com/item?id=${story.id}`,
    discussionUrl: `https://news.ycombinator.com/item?id=${story.id}`,
    score: story.score ?? 0,
    comments: story.descendants ?? 0,
    createdAt: new Date((story.time ?? 0) * 1000).toISOString(),
  };
}

/**
 * Finds public GitHub repositories mentioned by current Hacker News stories.
 * It calls only HN's documented Firebase API—no HTML scraping, authentication,
 * or background polling. Results are discovery leads, never install candidates.
 */
export async function discoverHackerNewsRepositories(
  options: HackerNewsDiscoveryOptions = {},
): Promise<HackerNewsDiscoveryResult> {
  const fetcher = options.fetcher ?? fetch;
  const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
  const minScore = Math.max(0, options.minScore ?? 20);
  const idsResponse = await fetcher(`${API_BASE}/topstories.json`);
  if (!idsResponse.ok)
    throw new Error(
      `Hacker News top stories request failed (${idsResponse.status})`,
    );
  const ids = (await idsResponse.json()) as unknown;
  if (!Array.isArray(ids))
    throw new Error("Hacker News top stories response is invalid");

  const selectedIds = ids
    .filter(
      (id): id is number => typeof id === "number" && Number.isInteger(id),
    )
    .slice(0, limit);
  const stories = await Promise.all(
    selectedIds.map(async (id) => {
      const response = await fetcher(`${API_BASE}/item/${id}.json`);
      if (!response.ok) return undefined;
      return (await response.json()) as HackerNewsStory;
    }),
  );
  const deduplicated = new Map<string, CommunityRepositoryCandidate>();
  for (const story of stories) {
    if (!story) continue;
    const candidate = storyCandidate(story, minScore);
    if (!candidate) continue;
    const current = deduplicated.get(candidate.repository.toLowerCase());
    if (!current || candidate.score > current.score) {
      deduplicated.set(candidate.repository.toLowerCase(), candidate);
    }
  }
  return {
    source: "hacker-news",
    fetchedAt: new Date().toISOString(),
    storiesScanned: selectedIds.length,
    candidates: [...deduplicated.values()].sort(
      (left, right) =>
        right.score - left.score || right.comments - left.comments,
    ),
  };
}
