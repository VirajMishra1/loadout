import type {
  ComponentType,
  OperatingSystem,
  PackageInspection,
  PackageTier,
} from "../../shared/types.js";
import type { PackageEvaluation } from "./evaluate.js";

export interface DiscoveryRepository {
  repository: string;
  url: string;
  description: string;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  license: string;
  topics: string[];
  createdAt: string;
  pushedAt: string;
  updatedAt: string;
  defaultBranch: string;
  matchedQueries: string[];
  catalogStatus: "candidate" | "reviewed";
  firstSeenAt: string;
  lastSeenAt: string;
  seenInLatestRun: boolean;
  starVelocityPerDay?: number;
  starVelocityWindowDays?: number;
  starsPerDaySinceCreation?: number;
}

export interface DiscoveryArtifact {
  schemaVersion: 1;
  generatedAt: string;
  repositories: DiscoveryRepository[];
}

export interface CandidateSummary {
  repository: string;
  url: string;
  description: string;
  stars: number;
  license: string;
  matchedQueries: string[];
  seenInLatestRun: boolean;
  catalogStatus: "candidate" | "reviewed";
  growth: {
    kind: "observed-star-velocity" | "lifetime-star-average";
    starsPerDay: number;
    windowDays?: number;
  };
  triagePriority: number;
  triageEvidence: string[];
}

export interface CandidateDossier {
  schemaVersion: 1;
  dossierVersion: 1;
  createdAt: string;
  discoveryGeneratedAt: string;
  repository: string;
  url: string;
  commit: string;
  defaultBranch: string;
  description: string;
  license: string;
  stars: number;
  matchedQueries: string[];
  growth: CandidateSummary["growth"];
  triagePriority: number;
  triageEvidence: string[];
  inspection: Omit<PackageInspection, "root">;
  evaluation: Omit<PackageEvaluation, "root">;
  components: ComponentType[];
  installability:
    | "portable-components"
    | "explicit-runtime-setup"
    | "unsupported-source-shape";
  evidencePaths: string[];
  overlap: Array<{
    packageId: string;
    repository: string;
    score: number;
    relationship: "possible-overlap" | "same-tooling-area";
    evidence: string[];
  }>;
  review: {
    status: "blocked" | "needs-human-review";
    reasons: string[];
  };
  safetyBoundary: string;
}

export interface CandidateProposalOptions {
  id: string;
  displayName?: string;
  description?: string;
  category: string;
  tier?: PackageTier;
  license?: string;
  operatingSystems: OperatingSystem[];
}
