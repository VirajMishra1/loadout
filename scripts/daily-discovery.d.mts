export interface DiscoveryQuery {
  id: string;
  label: string;
  query: string;
}

export interface SearchRepository {
  full_name: string;
  html_url: string;
  description?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  language?: string | null;
  license?: { spdx_id?: string } | null;
  topics?: string[];
  created_at?: string;
  pushed_at?: string;
  updated_at?: string;
  default_branch?: string;
  archived?: boolean;
  disabled?: boolean;
  fork?: boolean;
}

export interface DiscoveryRepository {
  repository: string;
  url: string;
  stars: number;
  forks: number;
  catalogStatus: "candidate" | "reviewed";
  firstSeenAt: string;
  lastSeenAt: string;
  seenInLatestRun: boolean;
  matchedQueries: string[];
  starVelocityPerDay?: number;
  starVelocityWindowDays?: number;
  starsPerDaySinceCreation?: number;
  observations: Array<{ observedAt: string; stars: number; forks: number }>;
}

export interface DiscoveryArtifact {
  schemaVersion: 1;
  generatedAt: string;
  policy: Record<string, number | boolean>;
  queries: Array<DiscoveryQuery & { resultCount: number }>;
  statistics: Record<string, number>;
  repositories: DiscoveryRepository[];
}

export function discoveryQueries(day: string): DiscoveryQuery[];
export function buildArtifact(options: {
  day: string;
  queryResults: Array<
    DiscoveryQuery & { count: number; items: SearchRepository[] }
  >;
  catalog: Array<{ repository: string }>;
  previous?: DiscoveryArtifact;
}): DiscoveryArtifact;
export function renderMarkdown(artifact: DiscoveryArtifact): string;
export function renderReadmeDiscoveryStatus(
  artifact: DiscoveryArtifact,
): string;
export function replaceReadmeDiscoveryStatus(
  readme: string,
  artifact: DiscoveryArtifact,
): string;
