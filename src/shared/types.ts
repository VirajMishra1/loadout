export type AgentId = "claude-code" | "codex" | "cursor" | "gemini-cli" | "opencode" | "hermes";

export type PackageTier = "official" | "stable" | "trending" | "community";

export interface CatalogPackage {
  id: string;
  displayName: string;
  repository: string;
  description: string;
  category: string;
  tier: PackageTier;
  stars?: number;
}

export interface DetectedAgent {
  id: AgentId;
  displayName: string;
  binary?: string;
  installed: boolean;
  skillsDirectory: string;
}

export interface PlannedFile {
  source: string;
  target: string;
}

export interface InstallPlan {
  packageId: string;
  files: PlannedFile[];
  targetAgents: AgentId[];
  warnings: string[];
}

export interface Snapshot {
  id: string;
  createdAt: string;
  roots: string[];
  files: Array<{ path: string; existed: boolean; content?: string }>;
}
