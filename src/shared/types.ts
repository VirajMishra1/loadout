export type AgentId =
  | "claude-code"
  | "codex"
  | "cursor"
  | "gemini-cli"
  | "opencode"
  | "hermes"
  | "windsurf"
  | "cline"
  | "github-copilot"
  | "roo-code"
  | "kiro-cli"
  | "junie";

/** A non-secret pointer to credentials managed outside Loadout. */
export type CredentialReference =
  | { kind: "environment"; name: string }
  | { kind: "os-keychain"; service: string; account?: string };

/**
 * A declarative model choice. Loadout can validate and share this shape, but
 * it deliberately does not resolve credentials or configure a provider here.
 */
export interface ProviderModelSelection {
  id: string;
  provider: string;
  model: string;
  endpoint: string;
  credential?: CredentialReference;
  targetAgents?: AgentId[];
}

/** Provider-neutral, secret-free model configuration for a future adapter. */
export interface ProviderModelConfiguration {
  schemaVersion: 1;
  selections: ProviderModelSelection[];
}

export type PackageTier = "official" | "stable" | "trending" | "community";

export type ReadmeClaimEvidenceClass =
  | "structural"
  | "unit-verified"
  | "integration-verified"
  | "live-verified"
  | "platform-verified"
  | "human-reviewed"
  | "benchmarked"
  | "policy-selected";

export type ReadmeClaimStatus = "proven" | "bounded" | "unfulfilled";

/** An evidence-backed or explicitly bounded material statement in the README. */
export interface ReadmeClaim {
  id: string;
  section: string;
  summary: string;
  evidenceClass: ReadmeClaimEvidenceClass;
  status: ReadmeClaimStatus;
  /** Repository paths or deterministic verification commands. */
  evidence: string[];
  /** Requirements outside the repository that limit verification scope. */
  externalPrerequisites?: string[];
}

export interface ReadmeClaimManifest {
  schemaVersion: 1;
  claims: ReadmeClaim[];
}

/** Operating systems on which Loadout can fetch and inspect a public Git source. */
export type OperatingSystem = "windows" | "macos" | "linux";

/**
 * Immutable, reviewable provenance for a catalog record. `evidencePaths` are
 * repository-relative paths observed at `commit`; they are not executable.
 */
export interface CatalogSourceEvidence {
  type: "github";
  url: string;
  defaultBranch: string;
  commit: string;
  evidencePaths: string[];
  verifiedAt: string;
}

export interface CatalogPackage {
  id: string;
  displayName: string;
  repository: string;
  description: string;
  category: string;
  tier: PackageTier;
  /** SPDX identifier returned by GitHub, or NOASSERTION when GitHub reports none. */
  license?: string;
  /** Component kinds evidenced by the pinned repository snapshot. */
  components?: ComponentType[];
  /** Platforms on which Loadout's Git source inspection is supported. */
  operatingSystems?: OperatingSystem[];
  /** Pinned GitHub source and the paths used to classify its components. */
  source?: CatalogSourceEvidence;
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
  /** Agent owning this target; required for reversible active-set changes. */
  targetAgent?: AgentId;
  componentType?: ComponentType;
  compatibility?: ComponentCompatibility;
  /** Frontmatter name when available, used for conflict diagnostics. */
  skillName?: string;
}

export type ComponentType =
  "skill" | "rule" | "command" | "agent" | "mcp" | "plugin" | "root";
export type ComponentCompatibility = "native" | "adapted" | "unsupported";

/** A non-executable entry observed below an agent-owned Loadout directory. */
export interface ManagedComponentEntry {
  /** Path relative to the inspected component directory. */
  path: string;
  kind: "file" | "directory" | "symlink";
}

/**
 * A truthful local inventory for one component type.  `scanned` is false for
 * components that do not have a safe, agent-owned filesystem location to
 * inspect; in particular it never implies that Loadout can install an
 * unsupported component.
 */
export interface AgentComponentInventory {
  type: ComponentType;
  compatibility: ComponentCompatibility;
  scanned: boolean;
  directory?: string;
  directoryExists?: boolean;
  entries: ManagedComponentEntry[];
  note?: string;
}

export interface AgentInventory {
  agent: DetectedAgent;
  components: AgentComponentInventory[];
  warnings: string[];
}

export interface ResourceSummary {
  type: "rule" | "command" | "agent";
  name: string;
  path: string;
}

export interface PluginSummary {
  type: "plugin";
  name: string;
  path: string;
  description?: string;
  version?: string;
  author?: string;
  /** Components declared by the manifest; runtime behavior is never executed. */
  components: ComponentType[];
  hookEvents: string[];
  mcpServers: string[];
  warnings: string[];
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
  files: Array<{
    path: string;
    existed: boolean;
    directory?: boolean;
    content?: string;
    encoding?: "base64";
  }>;
}

export interface InstallRecord {
  packageId: string;
  repository?: string;
  resolvedCommit?: string;
  targetAgents: AgentId[];
  files: Array<{ path: string; sha256: string }>;
  snapshotId: string;
  installedAt: string;
  staticAssessment?: StaticAssessment;
}

export interface StaticAssessment {
  status: "clear" | "warning" | "blocking";
  findingCount: number;
  assessedAt: string;
  policy: string;
}

export interface InstallMetadata {
  repository?: string;
  resolvedCommit?: string;
  reviewed?: boolean;
  staticAssessment?: StaticAssessment;
}

export interface InstallState {
  version: 1;
  installs: InstallRecord[];
  mcpInstalls?: McpInstallRecord[];
  activations?: ManagedActivationRecord[];
  profile?: InstalledLoadoutProfile;
}

export interface InstalledLoadoutProfile {
  mode: "stable" | "power" | "maximum" | "custom";
  packageIds?: string[];
  agents: AgentId[];
  catalogPackages: Array<{ packageId: string; reviewedCommit?: string }>;
  appliedAt: string;
}

export type LibraryCacheState = "missing" | "downloaded";
export type LibraryReviewState = "unreviewed" | "reviewed" | "quarantined";
export type LibraryInstallationState = "installed" | "removed";
export type LibraryActivationState = "active" | "disabled";

export interface ManagedActivationTarget {
  activePath: string;
  libraryRelativePath: string;
}

/** Per-agent state: the same reviewed package may be active in one agent only. */
export interface ManagedActivationRecord {
  packageId: string;
  /** Stable skill-level selector within a collection repository. */
  unitId?: string;
  agent: AgentId;
  cacheState: LibraryCacheState;
  reviewState: LibraryReviewState;
  installationState: LibraryInstallationState;
  activationState: LibraryActivationState;
  libraryPath: string;
  targets: ManagedActivationTarget[];
  libraryFiles: Array<{ path: string; sha256: string }>;
  updatedAt: string;
  snapshotId?: string;
}

export interface McpInstallRecord {
  packageId: string;
  configPath: string;
  serverName: string;
  fingerprint: string;
  snapshotId: string;
  installedAt: string;
}

export type PackageSource =
  | { type: "catalog"; id: string }
  | { type: "github"; repository: string; ref?: string; path?: string }
  | { type: "git"; url: string; ref?: string; path?: string }
  | { type: "registry"; name: string; version: string }
  | { type: "remote-registry"; registry: string; name: string; version: string }
  | { type: "local"; path: string };

export interface PackageDescriptor {
  schemaVersion: 1;
  name: string;
  version: string;
  description: string;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
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
  includeDevDependencies?: boolean;
  mcp?: { config: string; servers?: string[] };
  rootFiles?: Array<{ source: string; target: string }>;
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
    allowPackages?: string[];
    allowRepositories?: string[];
    deniedPackages?: string[];
    deniedRepositories?: string[];
    requiredApprovals?: number;
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
  dependencies?: string[];
}

export interface LoadoutLockfile {
  schemaVersion: 1;
  manifestName: string;
  generatedAt: string;
  packages: LockedPackage[];
  mcpServers?: Array<{
    packageId: string;
    configPath: string;
    serverName: string;
    fingerprint: string;
  }>;
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
  updatesChecked: boolean;
  updatesAvailable: number;
  driftedFiles: number;
  driftedMcpServers: number;
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
  /** Local-only evidence adjustment; never presented as universal quality. */
  localOutcomeAdjustment?: number;
  evidence?: string[];
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
  /** Hash of the exact pre-plan bytes, or the canonical missing marker. */
  baseSha256?: string;
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
  plugins: PluginSummary[];
  mcpServers: McpServerSummary[];
  counts: {
    skills: number;
    rules: number;
    commands: number;
    agents: number;
    plugins: number;
    mcpServers: number;
    manifests: number;
  };
  warnings: string[];
}
