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
  componentType?: ComponentType;
  compatibility?: ComponentCompatibility;
  /** Frontmatter name when available, used for conflict diagnostics. */
  skillName?: string;
}

export type ComponentType = "skill" | "rule" | "command" | "agent" | "mcp" | "plugin" | "root";
export type ComponentCompatibility = "native" | "adapted" | "unsupported";

export interface ResourceSummary {
  type: "rule" | "command" | "agent";
  name: string;
  path: string;
}

export interface ConflictDiagnostic {
  severity: "blocking" | "warning";
  code: "target-collision" | "duplicate-skill-name";
  message: string;
  packageIds: string[];
  targets: string[];
}

export interface InstallPlan {
  packageId: string;
  files: PlannedFile[];
  targetAgents: AgentId[];
  warnings: string[];
  conflicts?: ConflictDiagnostic[];
}

export interface Snapshot {
  id: string;
  createdAt: string;
  roots: string[];
  files: Array<{ path: string; existed: boolean; directory?: boolean; content?: string; encoding?: "base64" }>;
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

export type PackageSource =
  | { type: "catalog"; id: string }
  | { type: "github"; repository: string; ref?: string; path?: string }
  | { type: "git"; url: string; ref?: string; path?: string }
  | { type: "registry"; name: string; version: string }
  | { type: "local"; path: string };

export interface PackageDescriptor {
  schemaVersion: 1;
  name: string;
  version: string;
  description: string;
  license?: string;
  dependencies?: Record<string, string>;
}

export interface PackedPackage {
  descriptor: PackageDescriptor;
  root: string;
  digest: string;
  files: Array<{ path: string; sha256: string; size: number }>;
}

export interface ManifestPackage {
  id: string;
  source: PackageSource;
  agents?: AgentId[];
  dependsOn?: string[];
  enabled?: boolean;
}

export interface LoadoutManifest {
  schemaVersion: 1;
  name: string;
  scope: "project" | "global";
  agents: AgentId[];
  profile?: string;
  packages: ManifestPackage[];
  policy?: {
    allowRisk?: SafetyRiskLevel[];
    blockedDomains?: string[];
    blockedCommands?: string[];
  };
}

export interface LockedPackage {
  id: string;
  source: PackageSource;
  repository?: string;
  resolvedCommit?: string;
  targetAgents: AgentId[];
  files: Array<{ path: string; sha256: string }>;
  installedAt: string;
}

export interface LoadoutLockfile {
  schemaVersion: 1;
  manifestName: string;
  generatedAt: string;
  packages: LockedPackage[];
}

export type SafetyRiskLevel = "safe" | "review" | "blocked";

export interface HealthFinding {
  level: "ok" | "info" | "warning" | "error";
  code: string;
  message: string;
  fix?: string;
}

export interface HealthReport {
  status: "healthy" | "attention" | "unhealthy";
  generatedAt: string;
  agents: DetectedAgent[];
  installedPackages: number;
  updatesAvailable: number;
  driftedFiles: number;
  findings: HealthFinding[];
}

export interface ProjectSignals {
  root: string;
  languages: string[];
  frameworks: string[];
  files: string[];
}

export interface PackageRecommendation {
  packageId: string;
  reason: string;
  confidence: "high" | "medium" | "low";
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

export interface SkillSummary {
  type: "skill";
  name: string;
  description?: string;
  path: string;
}

export interface McpServerSummary {
  type: "mcp";
  name: string;
  transport: "command" | "url" | "unknown";
  command?: string;
  url?: string;
  argumentCount: number;
  environmentVariableCount: number;
  path: string;
  warnings: string[];
}

export interface PackageInspection {
  root: string;
  skills: SkillSummary[];
  resources: ResourceSummary[];
  mcpServers: McpServerSummary[];
  counts: { skills: number; rules: number; commands: number; agents: number; mcpServers: number; manifests: number };
  warnings: string[];
}
