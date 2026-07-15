import { z } from "zod";

/**
 * Runtime schemas for data that crosses a trust boundary: catalog JSON,
 * manifests and lockfiles shared between machines, persisted install state,
 * and install plans passed between Loadout modules.  These schemas deliberately
 * do not model secrets; MCP environment values are never persisted here.
 */
export const agentIdSchema = z.enum([
  "claude-code",
  "codex",
  "cursor",
  "gemini-cli",
  "opencode",
  "hermes",
]);

export const packageTierSchema = z.enum([
  "official",
  "stable",
  "trending",
  "community",
]);

export const operatingSystemSchema = z.enum(["windows", "macos", "linux"]);
export const componentTypeSchema = z.enum([
  "skill",
  "rule",
  "command",
  "agent",
  "mcp",
  "plugin",
  "root",
]);
export const componentCompatibilitySchema = z.enum([
  "native",
  "adapted",
  "unsupported",
]);
export const safetyRiskLevelSchema = z.enum(["safe", "review", "blocked"]);

const text = z.string().trim().min(1, "must not be empty");
const optionalText = text.optional();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "must be a SHA-256 hash");
const gitSha = z.string().regex(/^[a-f0-9]{40}$/i, "must be a full Git SHA");
const repository = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "must be owner/repository");
const safeRepositoryPath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !value.split(/[\\/]/).includes(".."),
    "must be a safe repository-relative path",
  );

export const catalogSourceEvidenceSchema = z
  .object({
    type: z.literal("github"),
    url: z.url("must be a URL"),
    defaultBranch: z
      .string()
      .regex(/^[A-Za-z0-9._/-]+$/, "contains unsupported characters"),
    commit: gitSha,
    evidencePaths: z.array(safeRepositoryPath).min(1),
    verifiedAt: z.iso.datetime("must be an ISO timestamp"),
  })
  .passthrough();

export const catalogPackageSchema = z
  .object({
    id: z
      .string()
      .regex(
        /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/,
        "must be lowercase kebab-case",
      ),
    displayName: text,
    repository,
    description: text,
    category: text,
    tier: packageTierSchema,
    license: optionalText,
    components: z.array(componentTypeSchema).min(1).optional(),
    operatingSystems: z.array(operatingSystemSchema).min(1).optional(),
    source: catalogSourceEvidenceSchema.optional(),
    stars: z.number().finite().nonnegative().optional(),
    lastUpdatedAt: z.iso.datetime("must be an ISO timestamp").optional(),
    pushedAt: z.iso.datetime("must be an ISO timestamp").optional(),
    topics: z.array(text).optional(),
    openIssues: z.number().int().nonnegative().optional(),
    archived: z.boolean().optional(),
  })
  .passthrough();

export const catalogSchema = z.array(catalogPackageSchema);

export const plannedFileSchema = z
  .object({
    source: text,
    target: text,
    componentType: componentTypeSchema.optional(),
    compatibility: componentCompatibilitySchema.optional(),
    skillName: optionalText,
  })
  .passthrough();

export const conflictDiagnosticSchema = z
  .object({
    severity: z.enum(["blocking", "warning"]),
    code: z.enum(["target-collision", "duplicate-skill-name"]),
    message: text,
    packageIds: z.array(text).min(1),
    targets: z.array(text).min(1),
  })
  .passthrough();

export const installPlanSchema = z
  .object({
    packageId: text,
    files: z.array(plannedFileSchema),
    targetAgents: z.array(agentIdSchema),
    warnings: z.array(z.string()),
    conflicts: z.array(conflictDiagnosticSchema).optional(),
  })
  .passthrough();

export const packageSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("catalog"), id: text }),
  z.object({
    type: z.literal("github"),
    repository,
    ref: optionalText,
    path: optionalText,
  }),
  z.object({
    type: z.literal("git"),
    url: text,
    ref: optionalText,
    path: optionalText,
  }),
  z.object({ type: z.literal("registry"), name: text, version: text }),
  z.object({
    type: z.literal("remote-registry"),
    registry: text,
    name: text,
    version: text,
  }),
  z.object({ type: z.literal("local"), path: text }),
]);

const manifestPackageSchema = z
  .object({
    id: text,
    source: packageSourceSchema,
    agents: z.array(agentIdSchema).optional(),
    dependsOn: z.array(text).optional(),
    includeDevDependencies: z.boolean().optional(),
    mcp: z
      .object({ config: text, servers: z.array(text).optional() })
      .optional(),
    rootFiles: z.array(z.object({ source: text, target: text })).optional(),
    enabled: z.boolean().optional(),
  })
  .passthrough();

export const loadoutManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: text,
    scope: z.enum(["project", "global"]),
    agents: z.array(agentIdSchema),
    profile: optionalText,
    packages: z.array(manifestPackageSchema),
    policy: z
      .object({
        allowRisk: z.array(safetyRiskLevelSchema).optional(),
        blockedDomains: z.array(text).optional(),
        blockedCommands: z.array(text).optional(),
      })
      // Preserve unknown policy keys so portable-export secret scanning can
      // reject them rather than silently dropping them during validation.
      .passthrough()
      .optional(),
  })
  .passthrough();

const fileHashSchema = z.object({ path: text, sha256 });
export const installRecordSchema = z
  .object({
    packageId: text,
    repository: optionalText,
    resolvedCommit: optionalText,
    targetAgents: z.array(agentIdSchema),
    files: z.array(fileHashSchema),
    snapshotId: text,
    installedAt: text,
  })
  .passthrough();

export const mcpInstallRecordSchema = z
  .object({
    packageId: text,
    configPath: text,
    serverName: text,
    fingerprint: sha256,
    snapshotId: text,
    installedAt: text,
  })
  .passthrough();

export const installStateSchema = z
  .object({
    version: z.literal(1),
    installs: z.array(installRecordSchema),
    mcpInstalls: z.array(mcpInstallRecordSchema).default([]),
  })
  .passthrough();

const lockedPackageSchema = z
  .object({
    id: text,
    source: packageSourceSchema,
    repository: optionalText,
    resolvedCommit: optionalText,
    targetAgents: z.array(agentIdSchema),
    files: z.array(fileHashSchema),
    installedAt: text,
    dependencies: z.array(text).optional(),
  })
  .passthrough();

export const loadoutLockfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    manifestName: text,
    // Older lockfiles predate this field.  Read them safely as an explicit
    // legacy value; every new lockfile writer still emits an ISO timestamp.
    generatedAt: text.optional().default("unknown"),
    packages: z.array(lockedPackageSchema),
    mcpServers: z
      .array(
        z.object({
          packageId: text,
          configPath: text,
          serverName: text,
          fingerprint: sha256,
        }),
      )
      .optional(),
  })
  .passthrough();

/** Compact, path-aware errors suitable for CLI and persisted-data diagnostics. */
export function formatSchemaError(error: z.ZodError): string {
  return error.issues
    .map(
      (issue) =>
        `${issue.path.length ? issue.path.join(".") : "value"}: ${issue.message}`,
    )
    .join("; ");
}

export type RuntimeCatalogPackage = z.infer<typeof catalogPackageSchema>;
export type RuntimeInstallPlan = z.infer<typeof installPlanSchema>;
export type RuntimeLoadoutManifest = z.infer<typeof loadoutManifestSchema>;
export type RuntimeInstallState = z.infer<typeof installStateSchema>;
export type RuntimeLoadoutLockfile = z.infer<typeof loadoutLockfileSchema>;
