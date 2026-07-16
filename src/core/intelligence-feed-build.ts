import {
  intelligenceFeedPayloadSchema,
  type IntelligenceFeedPayload,
} from "./intelligence-feed.js";

interface DiscoveryRepository {
  repository: string;
  url: string;
  catalogStatus: "candidate" | "reviewed";
  firstObservedAt?: string;
  lastObservedAt?: string;
}

interface DiscoveryArtifact {
  schemaVersion: 1;
  generatedAt: string;
  repositories: DiscoveryRepository[];
}

function publicDiscoveryArtifact(value: unknown): DiscoveryArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Discovery artifact must be an object");
  const artifact = value as Partial<DiscoveryArtifact>;
  if (
    artifact.schemaVersion !== 1 ||
    typeof artifact.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(artifact.generatedAt)) ||
    !Array.isArray(artifact.repositories) ||
    artifact.repositories.length > 5_000
  )
    throw new Error("Discovery artifact schema is invalid");
  const seen = new Set<string>();
  for (const repository of artifact.repositories) {
    if (
      !repository ||
      typeof repository.repository !== "string" ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository.repository) ||
      repository.url !== `https://github.com/${repository.repository}` ||
      !["candidate", "reviewed"].includes(repository.catalogStatus)
    )
      throw new Error(
        "Discovery repository contains a non-public or invalid identity",
      );
    const key = repository.repository.toLowerCase();
    if (seen.has(key))
      throw new Error(`Duplicate discovery repository: ${key}`);
    seen.add(key);
  }
  return artifact as DiscoveryArtifact;
}

/**
 * Convert central public discovery metadata into the signed feed's strict public
 * subset. Descriptions, code, prompts, project data, and private identities are
 * deliberately not accepted by this API.
 */
export function buildIntelligenceFeedPayload(options: {
  discovery: unknown;
  sequence: number;
  expiresAt: string;
  compatibilityNotices?: IntelligenceFeedPayload["compatibilityNotices"];
  candidateSummaries?: IntelligenceFeedPayload["candidateSummaries"];
  benchmarkChanges?: IntelligenceFeedPayload["benchmarkChanges"];
  catalogRelease?: IntelligenceFeedPayload["catalogRelease"];
}): IntelligenceFeedPayload {
  const discovery = publicDiscoveryArtifact(options.discovery);
  return intelligenceFeedPayloadSchema.parse({
    schemaVersion: 1,
    sequence: options.sequence,
    createdAt: discovery.generatedAt,
    expiresAt: options.expiresAt,
    publicDataOnly: true,
    discoveryObservations: discovery.repositories.map((repository) => ({
      id: `github:${repository.repository.toLowerCase()}`,
      source: "github" as const,
      observedAt:
        repository.lastObservedAt ??
        repository.firstObservedAt ??
        discovery.generatedAt,
      sourceUrl: repository.url,
      identityKey: `github:${repository.repository.toLowerCase()}`,
      signal:
        repository.catalogStatus === "reviewed"
          ? "public repository observed; separately present in the reviewed catalog"
          : "public repository observed; candidate only, not trusted or recommended",
    })),
    compatibilityNotices: options.compatibilityNotices ?? [],
    candidateSummaries: options.candidateSummaries ?? [],
    benchmarkChanges: options.benchmarkChanges ?? [],
    ...(options.catalogRelease
      ? { catalogRelease: options.catalogRelease }
      : {}),
  });
}
