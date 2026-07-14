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
  /** Live GitHub metadata, populated by the discovery refresh command. */
  lastUpdatedAt?: string;
  pushedAt?: string;
  topics?: string[];
  openIssues?: number;
  archived?: boolean;
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

export interface InstallRecord {
  packageId: string;
  repository?: string;
  resolvedCommit?: string;
  targetAgents: AgentId[];
  files: Array<{ path: string; sha256: string }>;
  snapshotId: string;
  installedAt: string;
}

export interface InstallState {
  version: 1;
  installs: InstallRecord[];
}

/** A read-only, normalized MCP server definition. Secrets are retained only in memory. */
export interface McpServer {
  name: string;
  command?: string;
  args: string[];
  url?: string;
  env: Record<string, string>;
  sourcePath: string;
  warnings: string[];
}

export interface McpManifest {
  path: string;
  servers: McpServer[];
  warnings: string[];
}

export interface McpConfigChange {
  serverName: string;
  action: "add" | "replace";
  /** Safe human-readable description; never contains environment values. */
  summary: string;
}

export interface McpConfigPlan {
  path: string;
  serverName: string;
  changes: McpConfigChange[];
  warnings: string[];
  /** Internal proposed JSON. Do not print this directly: it may contain secrets. */
  proposed: Record<string, unknown>;
}

export interface McpConfigSnapshot {
  id: string;
  path: string;
  existed: boolean;
  content?: string;
  createdAt: string;
}
