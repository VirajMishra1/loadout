import { z } from "zod";
import type {
  AgentId,
  ComponentType,
  InstallState,
  OperatingSystem,
} from "../shared/types.js";
import { agentIdSchema, componentTypeSchema } from "../shared/schemas.js";
import type { AgentVersionEvidence } from "./agent-versions.js";
import { signPayload, verifyEnvelope, type SignedEnvelope } from "./signing.js";

const MAX_COMPATIBILITY_BYTES = 1024 * 1024;
const identifier = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._/-]*$/i, "must be a bounded identifier");
const safeRelativePath = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[A-Za-z]:[\\/]/.test(value) &&
      !value.split(/[\\/]/).includes("..") &&
      !Array.from(value).some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      }),
    "must be a safe agent-relative path",
  );
const semanticVersion = z
  .string()
  .regex(
    /^\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/,
    "must be a bounded semantic version",
  );
const boundedText = z.string().trim().min(1).max(500);

const versionRangeSchema = z
  .strictObject({
    minInclusive: semanticVersion.optional(),
    maxExclusive: semanticVersion.optional(),
    includePrerelease: z.boolean().default(false),
  })
  .refine(
    (range) =>
      range.minInclusive !== undefined || range.maxExclusive !== undefined,
    "version range must declare at least one boundary",
  );

const affectedSelectorSchema = z.strictObject({
  packageIds: z.array(identifier).max(100).default([]),
  componentTypes: z.array(componentTypeSchema).max(7).default([]),
  pathPrefixes: z.array(safeRelativePath).max(50).default([]),
  recipeIds: z.array(identifier).max(100).default([]),
  providerIds: z.array(identifier).max(50).default([]),
  modelIds: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
});

const migrationSchema = z
  .strictObject({
    kind: z.enum(["move", "copy", "rewrite-config", "manual"]),
    fromPath: safeRelativePath.optional(),
    toPath: safeRelativePath.optional(),
    instructions: z.array(boundedText).min(1).max(20),
    automaticEligible: z.boolean().default(false),
  })
  .superRefine((migration, context) => {
    if (
      migration.kind !== "manual" &&
      (!migration.fromPath || !migration.toPath)
    )
      context.addIssue({
        code: "custom",
        message: "non-manual migrations require fromPath and toPath",
      });
    if (migration.fromPath && migration.fromPath === migration.toPath)
      context.addIssue({
        code: "custom",
        message: "migration source and destination must differ",
      });
  });

export const compatibilityNoticeSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: identifier,
    agent: agentIdSchema,
    kind: z.enum([
      "path-change",
      "config-format",
      "deprecation",
      "model-provider",
      "recipe-breakage",
    ]),
    severity: z.enum(["information", "warning", "breaking"]),
    summary: boundedText,
    issuedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    versionRange: versionRangeSchema,
    platforms: z
      .array(z.enum(["windows", "macos", "linux"]))
      .min(1)
      .max(3),
    affected: affectedSelectorSchema,
    evidence: z.strictObject({
      sourceUrl: z
        .url()
        .refine(
          (value) => new URL(value).protocol === "https:",
          "must use HTTPS",
        ),
      observedAt: z.iso.datetime({ offset: true }),
      confidence: z.enum(["verified", "likely", "uncertain"]),
    }),
    migration: migrationSchema.optional(),
    uncertainty: boundedText,
  })
  .superRefine((notice, context) => {
    if (Date.parse(notice.expiresAt) <= Date.parse(notice.issuedAt))
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "must be later than issuedAt",
      });
    if (notice.kind === "path-change" && !notice.migration)
      context.addIssue({
        code: "custom",
        path: ["migration"],
        message: "path changes require a migration preview definition",
      });
  });

export const compatibilityNoticeSetSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    generatedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    notices: z.array(compatibilityNoticeSchema).max(500),
  })
  .superRefine((feed, context) => {
    if (Date.parse(feed.expiresAt) <= Date.parse(feed.generatedAt))
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "must be later than generatedAt",
      });
    const seen = new Set<string>();
    feed.notices.forEach((notice, index) => {
      if (seen.has(notice.id))
        context.addIssue({
          code: "custom",
          path: ["notices", index, "id"],
          message: "notice ids must be unique",
        });
      seen.add(notice.id);
      if (Date.parse(notice.issuedAt) > Date.parse(feed.generatedAt))
        context.addIssue({
          code: "custom",
          path: ["notices", index, "issuedAt"],
          message: "notice cannot be issued after feed generation",
        });
    });
  });

export type CompatibilityNotice = z.infer<typeof compatibilityNoticeSchema>;
export type CompatibilityNoticeSet = z.infer<
  typeof compatibilityNoticeSetSchema
>;
export type CompatibilitySourceStatus =
  "verified" | "offline-cache" | "missing" | "invalid";

export interface CompatibilityFreshness {
  status: "fresh" | "stale" | "unavailable" | "invalid";
  sourceStatus: CompatibilitySourceStatus;
  generatedAt?: string;
  expiresAt?: string;
  ageHours?: number;
  message: string;
}

export interface AffectedManagedContent {
  noticeId: string;
  packageId: string;
  agent: AgentId;
  source: "install" | "activation" | "mcp";
  componentType: ComponentType;
  paths: string[];
}

export interface CompatibilityMigrationStep {
  noticeId: string;
  packageId: string;
  agent: AgentId;
  kind: "move" | "copy" | "rewrite-config" | "manual";
  sourcePath?: string;
  targetPath?: string;
  instructions: string[];
  automaticEligible: boolean;
  requiresApproval: true;
}

export interface CompatibilityNoticeAssessment {
  notice: CompatibilityNotice;
  applicability: "applies" | "potential" | "not-applicable";
  reason: string;
  affectedManagedContent: AffectedManagedContent[];
  migrationPreview: CompatibilityMigrationStep[];
}

export interface CompatibilityIntelligenceReport {
  schemaVersion: 1;
  generatedAt: string;
  versions: AgentVersionEvidence[];
  freshness: CompatibilityFreshness;
  assessments: CompatibilityNoticeAssessment[];
  affectedManagedContent: AffectedManagedContent[];
  migrationPreview: CompatibilityMigrationStep[];
  uncertainty: string[];
  mutationPerformed: false;
}

export function parseCompatibilityNoticeSet(
  value: unknown,
): CompatibilityNoticeSet {
  const bytes = Buffer.byteLength(JSON.stringify(value));
  if (bytes > MAX_COMPATIBILITY_BYTES)
    throw new Error("Compatibility notice set exceeds the 1 MiB limit");
  return compatibilityNoticeSetSchema.parse(value);
}

const signedEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  algorithm: z.literal("Ed25519"),
  createdAt: z.iso.datetime({ offset: true }),
  publicKeyFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  payload: z.unknown(),
  signature: z.string().min(1).max(1024),
});

export function signCompatibilityNoticeSet(
  value: unknown,
  privateKeyPem: string,
  createdAt?: string,
): SignedEnvelope<CompatibilityNoticeSet> {
  const payload = parseCompatibilityNoticeSet(value);
  return signPayload(payload, privateKeyPem, createdAt);
}

export function verifySignedCompatibilityNoticeSet(
  value: unknown,
  publicKeyPem: string,
): {
  feed: CompatibilityNoticeSet;
  fingerprint: string;
  signedAt: string;
} {
  const bounded = Buffer.byteLength(JSON.stringify(value));
  if (bounded > MAX_COMPATIBILITY_BYTES)
    throw new Error("Signed compatibility notice set exceeds the 1 MiB limit");
  const raw = signedEnvelopeSchema.parse(value);
  const envelope: SignedEnvelope<unknown> = raw;
  const verification = verifyEnvelope(envelope, publicKeyPem);
  if (!verification.valid)
    throw new Error("Compatibility notice signature is invalid");
  return {
    feed: parseCompatibilityNoticeSet(envelope.payload),
    fingerprint: verification.fingerprint,
    signedAt: envelope.createdAt,
  };
}

function parsedVersion(value: string):
  | {
      numeric: [number, number, number];
      prerelease?: string;
    }
  | undefined {
  const matched = value.match(
    /^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/,
  );
  if (!matched) return undefined;
  return {
    numeric: [Number(matched[1]), Number(matched[2]), Number(matched[3] ?? 0)],
    ...(matched[4] ? { prerelease: matched[4] } : {}),
  };
}

function compareVersions(left: string, right: string): number | undefined {
  const a = parsedVersion(left);
  const b = parsedVersion(right);
  if (!a || !b) return undefined;
  for (let index = 0; index < 3; index++) {
    if (a.numeric[index] !== b.numeric[index])
      return a.numeric[index] < b.numeric[index] ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

function versionApplicability(
  evidence: AgentVersionEvidence | undefined,
  notice: CompatibilityNotice,
): {
  applicability: "applies" | "potential" | "not-applicable";
  reason: string;
} {
  if (!evidence || evidence.status !== "detected" || !evidence.version)
    return {
      applicability: "potential",
      reason:
        "The installed version is unavailable, so this notice cannot be excluded safely.",
    };
  const current = evidence.version;
  const range = notice.versionRange;
  const belowMinimum = range.minInclusive
    ? compareVersions(current, range.minInclusive)
    : 0;
  const atOrAboveMaximum = range.maxExclusive
    ? compareVersions(current, range.maxExclusive)
    : -1;
  if (belowMinimum === undefined || atOrAboveMaximum === undefined)
    return {
      applicability: "potential",
      reason:
        "The detected version could not be compared to every signed range boundary.",
    };
  if (belowMinimum < 0 || atOrAboveMaximum >= 0)
    return {
      applicability: "not-applicable",
      reason: `Detected version ${current} is outside the signed notice range.`,
    };
  if (evidence.releaseChannel === "prerelease" && !range.includePrerelease)
    return {
      applicability: "potential",
      reason: `Detected version ${current} is a prerelease not explicitly covered by this notice.`,
    };
  return {
    applicability: "applies",
    reason: `Detected version ${current} is inside the signed notice range.`,
  };
}

function platformName(platform: NodeJS.Platform): OperatingSystem | undefined {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  if (platform === "linux") return "linux";
  return undefined;
}

function normalizedPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function pathMatches(path: string, relativePrefix: string): boolean {
  const normalized = normalizedPath(path).toLowerCase();
  const prefix = normalizedPath(relativePrefix)
    .replace(/^\.\//, "")
    .toLowerCase();
  return (
    normalized === prefix ||
    normalized.endsWith(`/${prefix}`) ||
    normalized.includes(`/${prefix}/`)
  );
}

function selectedPaths(paths: string[], notice: CompatibilityNotice): string[] {
  if (notice.affected.pathPrefixes.length === 0)
    return [...new Set(paths)].sort();
  return [
    ...new Set(
      paths.filter((path) =>
        notice.affected.pathPrefixes.some((prefix) =>
          pathMatches(path, prefix),
        ),
      ),
    ),
  ].sort();
}

function packageSelected(
  packageId: string,
  notice: CompatibilityNotice,
): boolean {
  const ids = new Set([
    ...notice.affected.packageIds,
    ...notice.affected.recipeIds,
  ]);
  return ids.size === 0 || ids.has(packageId);
}

export function affectedManagedContent(
  notice: CompatibilityNotice,
  state: InstallState,
): AffectedManagedContent[] {
  const results: AffectedManagedContent[] = [];
  const componentTypes = new Set(notice.affected.componentTypes);
  for (const install of state.installs) {
    if (
      !install.targetAgents.includes(notice.agent) ||
      !packageSelected(install.packageId, notice) ||
      (componentTypes.size > 0 && !componentTypes.has("skill"))
    )
      continue;
    const paths = selectedPaths(
      install.files.map((file) => file.path),
      notice,
    );
    if (paths.length || notice.affected.pathPrefixes.length === 0)
      results.push({
        noticeId: notice.id,
        packageId: install.packageId,
        agent: notice.agent,
        source: "install",
        componentType: "skill",
        paths,
      });
  }
  for (const activation of state.activations ?? []) {
    if (
      activation.agent !== notice.agent ||
      !packageSelected(activation.packageId, notice) ||
      (componentTypes.size > 0 && !componentTypes.has("skill"))
    )
      continue;
    const paths = selectedPaths(
      activation.targets.map((target) => target.activePath),
      notice,
    );
    if (paths.length || notice.affected.pathPrefixes.length === 0)
      results.push({
        noticeId: notice.id,
        packageId: activation.packageId,
        agent: notice.agent,
        source: "activation",
        componentType: "skill",
        paths,
      });
  }
  for (const mcp of state.mcpInstalls ?? []) {
    if (
      !packageSelected(mcp.packageId, notice) ||
      (componentTypes.size > 0 && !componentTypes.has("mcp"))
    )
      continue;
    const paths = selectedPaths([mcp.configPath], notice);
    if (paths.length || notice.affected.pathPrefixes.length === 0)
      results.push({
        noticeId: notice.id,
        packageId: mcp.packageId,
        agent: notice.agent,
        source: "mcp",
        componentType: "mcp",
        paths,
      });
  }
  return results.sort(
    (left, right) =>
      left.packageId.localeCompare(right.packageId) ||
      left.source.localeCompare(right.source),
  );
}

function migratedPath(
  path: string,
  fromPath: string,
  toPath: string,
): string | undefined {
  const normalized = normalizedPath(path);
  const from = normalizedPath(fromPath).replace(/^\.\//, "");
  const lower = normalized.toLowerCase();
  const target = from.toLowerCase();
  const marker = `/${target}`;
  const index = lower.lastIndexOf(marker);
  if (index < 0 && lower !== target) return undefined;
  const start = index < 0 ? 0 : index + 1;
  return `${normalized.slice(0, start)}${toPath}${normalized.slice(start + from.length)}`;
}

export function previewCompatibilityMigration(
  notice: CompatibilityNotice,
  affected: AffectedManagedContent[],
): CompatibilityMigrationStep[] {
  const migration = notice.migration;
  if (!migration) return [];
  const steps: CompatibilityMigrationStep[] = [];
  for (const content of affected) {
    if (migration.kind === "manual") {
      steps.push({
        noticeId: notice.id,
        packageId: content.packageId,
        agent: content.agent,
        kind: migration.kind,
        instructions: migration.instructions,
        automaticEligible: false,
        requiresApproval: true,
      });
      continue;
    }
    for (const sourcePath of content.paths) {
      const targetPath = migratedPath(
        sourcePath,
        migration.fromPath!,
        migration.toPath!,
      );
      if (!targetPath) continue;
      steps.push({
        noticeId: notice.id,
        packageId: content.packageId,
        agent: content.agent,
        kind: migration.kind,
        sourcePath,
        targetPath,
        instructions: migration.instructions,
        automaticEligible: migration.automaticEligible,
        requiresApproval: true,
      });
    }
  }
  return steps;
}

export function compatibilityFreshness(
  feed: CompatibilityNoticeSet | undefined,
  sourceStatus: CompatibilitySourceStatus,
  now = new Date(),
): CompatibilityFreshness {
  if (sourceStatus === "invalid")
    return {
      status: "invalid",
      sourceStatus,
      message:
        "Compatibility input failed signature or schema verification; no notice is trusted.",
    };
  if (!feed || sourceStatus === "missing")
    return {
      status: "unavailable",
      sourceStatus: "missing",
      message:
        "No verified compatibility notice set is available; compatibility is unknown.",
    };
  const ageHours = Math.max(
    0,
    (now.getTime() - Date.parse(feed.generatedAt)) / (60 * 60 * 1000),
  );
  if (Date.parse(feed.generatedAt) > now.getTime() + 5 * 60 * 1000)
    return {
      status: "invalid",
      sourceStatus,
      generatedAt: feed.generatedAt,
      expiresAt: feed.expiresAt,
      message:
        "Compatibility notice generation time is too far in the future for the local clock.",
    };
  const stale = now.getTime() > Date.parse(feed.expiresAt);
  return {
    status: stale ? "stale" : "fresh",
    sourceStatus,
    generatedAt: feed.generatedAt,
    expiresAt: feed.expiresAt,
    ageHours: Number(ageHours.toFixed(2)),
    message: stale
      ? "The last verified compatibility notice set is expired; findings are historical and treated as uncertain."
      : sourceStatus === "offline-cache"
        ? "A fresh previously verified notice set is available offline; events after its generation time may be missing."
        : "Compatibility notices are verified and within their declared freshness window.",
  };
}

export function buildCompatibilityIntelligence(options: {
  versions: AgentVersionEvidence[];
  state: InstallState;
  feed?: CompatibilityNoticeSet;
  sourceStatus: CompatibilitySourceStatus;
  now?: Date;
  platform?: NodeJS.Platform;
}): CompatibilityIntelligenceReport {
  const now = options.now ?? new Date();
  const freshness = compatibilityFreshness(
    options.feed,
    options.sourceStatus,
    now,
  );
  const platform = platformName(options.platform ?? process.platform);
  const versionByAgent = new Map(
    options.versions.map((evidence) => [evidence.agent, evidence]),
  );
  const assessments = (options.feed?.notices ?? []).map(
    (notice): CompatibilityNoticeAssessment => {
      let result = versionApplicability(
        versionByAgent.get(notice.agent),
        notice,
      );
      if (!platform || !notice.platforms.includes(platform))
        result = {
          applicability: "not-applicable",
          reason: platform
            ? `Notice does not target ${platform}.`
            : "This operating system has no declared compatibility mapping.",
        };
      if (
        result.applicability === "applies" &&
        (freshness.status !== "fresh" ||
          now.getTime() > Date.parse(notice.expiresAt))
      )
        result = {
          applicability: "potential",
          reason: `${result.reason} ${
            now.getTime() > Date.parse(notice.expiresAt)
              ? "The individual notice has expired"
              : `The verified notice set is ${freshness.status}`
          }, so current applicability is uncertain.`,
        };
      const affected =
        result.applicability === "not-applicable"
          ? []
          : affectedManagedContent(notice, options.state);
      return {
        notice,
        ...result,
        affectedManagedContent: affected,
        migrationPreview: previewCompatibilityMigration(notice, affected),
      };
    },
  );
  const affected = assessments.flatMap(
    (assessment) => assessment.affectedManagedContent,
  );
  const migrationPreview = assessments.flatMap(
    (assessment) => assessment.migrationPreview,
  );
  const uncertainty = [
    freshness.message,
    ...assessments
      .filter((assessment) => assessment.applicability === "potential")
      .map((assessment) => `${assessment.notice.id}: ${assessment.reason}`),
    ...assessments.map(
      (assessment) =>
        `${assessment.notice.id}: ${assessment.notice.uncertainty}`,
    ),
    ...(options.versions.some(
      (version) => version.releaseChannel === "prerelease",
    )
      ? [
          "At least one detected agent is a prerelease; absence of a notice is not compatibility evidence.",
        ]
      : []),
  ];
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    versions: options.versions,
    freshness,
    assessments,
    affectedManagedContent: affected,
    migrationPreview,
    uncertainty: [...new Set(uncertainty)],
    mutationPerformed: false,
  };
}
