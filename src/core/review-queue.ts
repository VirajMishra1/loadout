import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CatalogPackage } from "../shared/types.js";
import { writeFileAtomically } from "./atomic-file.js";
import type { CommunityRepositoryCandidate } from "./community.js";
import type { GitHubRepositoryLead } from "./github-discovery.js";
import { ensureDirectory, loadoutHome } from "./paths.js";

export type ReviewDecision = "pending" | "shortlisted" | "ignored";

export interface ReviewQueueItem {
  repository: string;
  url: string;
  title: string;
  description: string;
  sources: Array<"github-search" | "hacker-news">;
  firstSeenAt: string;
  lastSeenAt: string;
  decision: ReviewDecision;
  alreadyCataloged: boolean;
  stars?: number;
  /** Observed star change per day; absent until two GitHub observations exist. */
  starVelocity?: number;
  forks?: number;
  repositoryCreatedAt?: string;
  repositoryUpdatedAt?: string;
  communityScore?: number;
  discussionUrl?: string;
}

export interface ReviewQueue {
  schemaVersion: 1;
  updatedAt: string;
  items: ReviewQueueItem[];
}

const queuePath = (): string => join(loadoutHome(), "review-queue.json");

function isQueue(value: unknown): value is ReviewQueue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === 1 &&
    typeof record.updatedAt === "string" &&
    Array.isArray(record.items) &&
    record.items.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof (item as ReviewQueueItem).repository === "string" &&
        ["pending", "shortlisted", "ignored"].includes(
          (item as ReviewQueueItem).decision,
        ),
    )
  );
}

export async function readReviewQueue(): Promise<ReviewQueue> {
  try {
    const value: unknown = JSON.parse(await readFile(queuePath(), "utf8"));
    if (!isQueue(value)) throw new Error("review queue schema is invalid");
    return value;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    )
      return {
        schemaVersion: 1,
        updatedAt: new Date(0).toISOString(),
        items: [],
      };
    throw new Error(
      `Loadout review queue is invalid at ${queuePath()}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function fromLead(
  lead: GitHubRepositoryLead | CommunityRepositoryCandidate,
  now: string,
  cataloged: Set<string>,
): ReviewQueueItem {
  if (lead.source === "github-search")
    return {
      repository: lead.repository,
      url: lead.url,
      title: lead.title,
      description: lead.description,
      sources: [lead.source],
      firstSeenAt: now,
      lastSeenAt: now,
      decision: "pending",
      alreadyCataloged: cataloged.has(lead.repository.toLowerCase()),
      stars: lead.stars,
      forks: lead.forks,
      repositoryCreatedAt: lead.createdAt,
      repositoryUpdatedAt: lead.updatedAt,
    };
  return {
    repository: lead.repository,
    url: lead.storyUrl,
    title: lead.title,
    description: "",
    sources: [lead.source],
    firstSeenAt: now,
    lastSeenAt: now,
    decision: "pending",
    alreadyCataloged: cataloged.has(lead.repository.toLowerCase()),
    communityScore: lead.score,
    discussionUrl: lead.discussionUrl,
  };
}

/** Merge read-only discovery leads; this never promotes or installs a candidate. */
export async function mergeReviewQueue(
  leads: Array<GitHubRepositoryLead | CommunityRepositoryCandidate>,
  catalog: CatalogPackage[],
  now = new Date(),
): Promise<ReviewQueue> {
  const current = await readReviewQueue();
  const timestamp = now.toISOString();
  const cataloged = new Set(
    catalog.map((item) => item.repository.toLowerCase()),
  );
  const items = new Map(
    current.items.map((item) => [item.repository.toLowerCase(), item]),
  );
  for (const lead of leads) {
    const incoming = fromLead(lead, timestamp, cataloged);
    const key = incoming.repository.toLowerCase();
    const existing = items.get(key);
    items.set(
      key,
      existing
        ? {
            ...existing,
            ...incoming,
            sources: [...new Set([...existing.sources, ...incoming.sources])],
            firstSeenAt: existing.firstSeenAt,
            decision: existing.decision,
            ...(incoming.stars !== undefined && existing.stars !== undefined
              ? {
                  starVelocity:
                    (incoming.stars - existing.stars) /
                    Math.max(
                      1,
                      (now.getTime() - Date.parse(existing.lastSeenAt)) /
                        86_400_000,
                    ),
                }
              : {}),
          }
        : incoming,
    );
  }
  const queue: ReviewQueue = {
    schemaVersion: 1,
    updatedAt: timestamp,
    items: [...items.values()].sort(
      (left, right) =>
        Number(left.alreadyCataloged) - Number(right.alreadyCataloged) ||
        Number(right.decision === "shortlisted") -
          Number(left.decision === "shortlisted") ||
        (right.starVelocity ?? Number.NEGATIVE_INFINITY) -
          (left.starVelocity ?? Number.NEGATIVE_INFINITY) ||
        (right.stars ?? right.communityScore ?? 0) -
          (left.stars ?? left.communityScore ?? 0) ||
        left.repository.localeCompare(right.repository),
    ),
  };
  await ensureDirectory(dirname(queuePath()));
  await writeFileAtomically(queuePath(), `${JSON.stringify(queue, null, 2)}\n`);
  return queue;
}

export async function setReviewDecision(
  repository: string,
  decision: ReviewDecision,
): Promise<ReviewQueueItem> {
  const queue = await readReviewQueue();
  const item = queue.items.find(
    (candidate) =>
      candidate.repository.toLowerCase() === repository.toLowerCase(),
  );
  if (!item)
    throw new Error(
      `Repository is not in the review queue: ${repository}. Run loadout discover --queue first.`,
    );
  item.decision = decision;
  queue.updatedAt = new Date().toISOString();
  await writeFileAtomically(queuePath(), `${JSON.stringify(queue, null, 2)}\n`);
  return item;
}

export function formatReviewQueue(queue: ReviewQueue): string {
  const visible = queue.items.filter((item) => !item.alreadyCataloged);
  return [
    `Review queue: ${visible.length} uncataloged candidate(s), ${queue.items.length - visible.length} already cataloged`,
    ...visible.map(
      (item) =>
        `${item.decision === "shortlisted" ? "★" : item.decision === "ignored" ? "×" : "○"} ${item.repository} — ${item.stars !== undefined ? `${item.stars} stars${item.starVelocity !== undefined ? ` (${item.starVelocity >= 0 ? "+" : ""}${item.starVelocity.toFixed(1)}/day)` : ""}` : `community score ${item.communityScore ?? 0}`} — ${item.sources.join("+")}`,
    ),
  ].join("\n");
}
