import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type {
  CatalogPackage,
  ComponentType,
  OperatingSystem,
  PackageInspection,
  PackageTier,
} from "../shared/types.js";
import { writeFileAtomically } from "./atomic-file.js";
import { loadEffectiveCatalog, validateCatalog } from "./catalog.js";
import { evaluatePackage, type PackageEvaluation } from "./evaluate.js";
import { inspectPackage } from "./package.js";
import { ensureDirectory, loadoutHome } from "./paths.js";
import {
  fetchRepositorySnapshot,
  normalizeRepository,
  type RepositorySnapshot,
} from "./source.js";
import { safeTerminalText } from "./terminal.js";

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

const dossierDirectory = (): string => join(loadoutHome(), "candidates");
const sourceVerifiedDossiers = new WeakMap<CandidateDossier, string>();

function dossierIntegrity(dossier: CandidateDossier): string {
  return createHash("sha256").update(JSON.stringify(dossier)).digest("hex");
}

function bundledDiscoveryPath(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDirectory, "..", "..", "catalog", "discovered.json"),
    join(moduleDirectory, "..", "..", "..", "catalog", "discovered.json"),
    join(process.cwd(), "catalog", "discovered.json"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function isTextArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function parseDiscovery(value: unknown): DiscoveryArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Discovery artifact must be an object");
  const artifact = value as Partial<DiscoveryArtifact>;
  if (
    artifact.schemaVersion !== 1 ||
    typeof artifact.generatedAt !== "string" ||
    Number.isNaN(Date.parse(artifact.generatedAt)) ||
    !Array.isArray(artifact.repositories)
  )
    throw new Error("Discovery artifact schema is invalid");
  for (const [index, item] of artifact.repositories.entries()) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.repository !== "string" ||
      typeof item.url !== "string" ||
      typeof item.description !== "string" ||
      !finiteNonnegative(item.stars) ||
      !finiteNonnegative(item.forks) ||
      !finiteNonnegative(item.openIssues) ||
      (item.language !== null && typeof item.language !== "string") ||
      typeof item.license !== "string" ||
      !item.license.trim() ||
      !isTextArray(item.topics) ||
      typeof item.defaultBranch !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(item.defaultBranch) ||
      item.defaultBranch.includes("..") ||
      item.defaultBranch.endsWith("/") ||
      !isTextArray(item.matchedQueries) ||
      !validDate(item.createdAt) ||
      !validDate(item.pushedAt) ||
      !validDate(item.updatedAt) ||
      !validDate(item.firstSeenAt) ||
      !validDate(item.lastSeenAt) ||
      typeof item.seenInLatestRun !== "boolean" ||
      (item.starVelocityPerDay !== undefined &&
        (typeof item.starVelocityPerDay !== "number" ||
          !Number.isFinite(item.starVelocityPerDay))) ||
      (item.starVelocityWindowDays !== undefined &&
        (!finiteNonnegative(item.starVelocityWindowDays) ||
          item.starVelocityWindowDays < 1)) ||
      (item.starVelocityPerDay !== undefined) !==
        (item.starVelocityWindowDays !== undefined) ||
      (item.starsPerDaySinceCreation !== undefined &&
        !finiteNonnegative(item.starsPerDaySinceCreation)) ||
      (item.catalogStatus !== "candidate" && item.catalogStatus !== "reviewed")
    )
      throw new Error(`Discovery repository ${index + 1} is invalid`);
    normalizeRepository(item.repository);
    if (item.url !== `https://github.com/${item.repository}`)
      throw new Error(`Discovery repository ${index + 1} has a mismatched URL`);
  }
  return artifact as DiscoveryArtifact;
}

export async function readDiscoveryArtifact(
  path = bundledDiscoveryPath(),
): Promise<DiscoveryArtifact> {
  const target = resolve(path);
  const info = await stat(target);
  if (!info.isFile() || info.size > 10 * 1024 * 1024)
    throw new Error("Discovery artifact exceeds the 10 MiB limit");
  return parseDiscovery(JSON.parse(await readFile(target, "utf8")));
}

function summarize(item: DiscoveryRepository): CandidateSummary {
  const measured = item.starVelocityPerDay !== undefined;
  const starsPerDay = measured
    ? item.starVelocityPerDay!
    : (item.starsPerDaySinceCreation ?? 0);
  const queryPoints = Math.min(30, item.matchedQueries.length * 6);
  const growthPoints = Math.min(
    35,
    Math.log10(Math.max(0, starsPerDay) + 1) * 14,
  );
  const adoptionPoints = Math.min(25, Math.log10(item.stars + 1) * 5);
  const freshnessPoints = item.seenInLatestRun ? 10 : 0;
  const triagePriority =
    Math.round(
      (queryPoints + growthPoints + adoptionPoints + freshnessPoints) * 10,
    ) / 10;
  return {
    repository: item.repository,
    url: item.url,
    description: item.description,
    stars: item.stars,
    license: item.license,
    matchedQueries: item.matchedQueries,
    seenInLatestRun: item.seenInLatestRun,
    catalogStatus: item.catalogStatus,
    growth: {
      kind: measured ? "observed-star-velocity" : "lifetime-star-average",
      starsPerDay,
      ...(measured && item.starVelocityWindowDays !== undefined
        ? { windowDays: item.starVelocityWindowDays }
        : {}),
    },
    triagePriority,
    triageEvidence: [
      `${item.matchedQueries.length} bounded discovery query match(es)`,
      measured
        ? `${starsPerDay.toFixed(2)} observed stars/day over ${item.starVelocityWindowDays?.toFixed(1) ?? "unknown"} day(s)`
        : `${starsPerDay.toFixed(2)} stars/day lifetime average; not observed velocity`,
      `${item.stars.toLocaleString("en-US")} stars are adoption evidence, not quality or safety evidence`,
      item.seenInLatestRun
        ? "seen in the latest discovery run"
        : "retained from an earlier discovery run",
    ],
  };
}

export async function listDiscoveryCandidates(
  options: {
    path?: string;
    query?: string;
    limit?: number;
    includeReviewed?: boolean;
  } = {},
): Promise<CandidateSummary[]> {
  const artifact = await readDiscoveryArtifact(options.path);
  const words = (options.query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return artifact.repositories
    .filter(
      (item) => options.includeReviewed || item.catalogStatus === "candidate",
    )
    .filter((item) => {
      const haystack = [
        item.repository,
        item.description,
        item.language ?? "",
        ...item.topics,
        ...item.matchedQueries,
      ]
        .join(" ")
        .toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .map(summarize)
    .sort(
      (left, right) =>
        right.triagePriority - left.triagePriority ||
        left.repository.localeCompare(right.repository),
    )
    .slice(0, options.limit ?? 20);
}

function componentsFor(inspection: PackageInspection): ComponentType[] {
  const result: ComponentType[] = [];
  if (inspection.counts.skills) result.push("skill");
  if (inspection.counts.rules) result.push("rule");
  if (inspection.counts.commands) result.push("command");
  if (inspection.counts.agents) result.push("agent");
  if (
    inspection.plugins.some(
      (plugin) =>
        !plugin.warnings.some((warning) =>
          warning.startsWith("invalid plugin manifest"),
        ),
    )
  )
    result.push("plugin");
  if (inspection.mcpServers.length) result.push("mcp");
  return result;
}

function evidencePathsFor(inspection: PackageInspection): string[] {
  return [
    ...inspection.skills.map((item) => join(item.path, "SKILL.md")),
    ...inspection.resources.map((item) => item.path),
    ...inspection.plugins
      .filter(
        (item) =>
          !item.warnings.some((warning) =>
            warning.startsWith("invalid plugin manifest"),
          ),
      )
      .map((item) => item.path),
    ...inspection.mcpServers.map((item) => item.path),
  ]
    .map((path) => path.split(/[\\/]/).join("/"))
    .filter((path) => path !== "." && !path.startsWith("../"))
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .sort();
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "your",
  "into",
  "agent",
  "agents",
  "skill",
  "skills",
  "mcp",
  "server",
  "servers",
  "workflow",
  "workflows",
  "code",
  "coding",
  "developer",
  "development",
  "platform",
  "context",
  "open",
  "source",
  "using",
  "across",
  "tool",
  "tools",
  "github",
]);

function tokens(...values: Array<string | undefined>): Set<string> {
  return new Set(
    values
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
  );
}

function overlapFor(
  discovery: DiscoveryRepository,
  inspection: PackageInspection,
  catalog: CatalogPackage[],
): CandidateDossier["overlap"] {
  const candidateTokens = tokens(
    discovery.repository,
    discovery.description,
    discovery.topics.join(" "),
    ...inspection.skills.flatMap((item) => [item.name, item.description]),
    ...inspection.resources.map((item) => item.name),
    ...inspection.plugins.flatMap((item) => [item.name, item.description]),
    ...inspection.mcpServers.map((item) => item.name),
  );
  const candidateComponents = new Set(componentsFor(inspection));
  return catalog
    .map((pkg) => {
      const packageTokens = tokens(
        pkg.id,
        pkg.displayName,
        pkg.description,
        pkg.category,
        pkg.topics?.join(" "),
      );
      const common = [...candidateTokens]
        .filter((word) => packageTokens.has(word))
        .sort();
      // Containment is more useful than union similarity here: a large skill
      // collection can overlap a focused package even when most collection
      // tokens describe unrelated capabilities.
      const smallerVocabulary = Math.min(
        candidateTokens.size,
        packageTokens.size,
      );
      const score = smallerVocabulary ? common.length / smallerVocabulary : 0;
      const componentMatch =
        pkg.components?.some((component) =>
          candidateComponents.has(component),
        ) ?? false;
      return {
        packageId: pkg.id,
        repository: pkg.repository,
        score: Math.round(score * 1000) / 1000,
        relationship:
          componentMatch && common.length >= 2 && score >= 0.2
            ? ("possible-overlap" as const)
            : ("same-tooling-area" as const),
        evidence: common.slice(0, 8).map((word) => `shared term: ${word}`),
      };
    })
    .filter((item) => item.evidence.length >= 1 && item.score >= 0.1)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.packageId.localeCompare(right.packageId),
    )
    .slice(0, 5);
}

export async function buildCandidateDossier(
  repository: string,
  options: {
    discoveryPath?: string;
    catalog?: CatalogPackage[];
    now?: Date;
    fetchSnapshot?: (
      repository: string,
      defaultBranch: string,
    ) => Promise<RepositorySnapshot>;
  } = {},
): Promise<CandidateDossier> {
  const normalized = normalizeRepository(repository);
  const artifact = await readDiscoveryArtifact(options.discoveryPath);
  const discovery = artifact.repositories.find(
    (item) => item.repository.toLowerCase() === normalized.toLowerCase(),
  );
  if (!discovery)
    throw new Error(
      `${normalized} is not present in the discovery evidence feed; run daily discovery or inspect it separately first`,
    );
  if (discovery.catalogStatus === "reviewed")
    throw new Error(
      `${discovery.repository} is already in the reviewed catalog`,
    );
  const catalog = options.catalog ?? (await loadEffectiveCatalog());
  if (
    catalog.some(
      (item) =>
        item.repository.toLowerCase() === discovery.repository.toLowerCase(),
    )
  )
    throw new Error(
      `${discovery.repository} is already in the effective reviewed catalog; the discovery feed is stale`,
    );
  const snapshot = options.fetchSnapshot
    ? await options.fetchSnapshot(discovery.repository, discovery.defaultBranch)
    : await fetchRepositorySnapshot(discovery.repository, {
        ref: discovery.defaultBranch,
        timeoutMs: 120_000,
        maxBytes: 100 * 1024 * 1024,
        maxFiles: 20_000,
      });
  if (
    normalizeRepository(snapshot.repository).toLowerCase() !==
      discovery.repository.toLowerCase() ||
    !/^[a-f0-9]{40}$/i.test(snapshot.commit)
  )
    throw new Error(
      "Repository snapshot returned mismatched or non-immutable evidence",
    );
  const [inspection, evaluation] = await Promise.all([
    inspectPackage(snapshot.path),
    evaluatePackage(snapshot.path),
  ]);
  const components = componentsFor(inspection);
  const evidencePaths = evidencePathsFor(inspection);
  const summary = summarize(discovery);
  const blockedCategories = evaluation.categories.filter(
    (item) => item.status === "blocked",
  );
  const reviewFindings = evaluation.categories.flatMap((item) =>
    item.status === "needs-review"
      ? item.findings.map((finding) => `${item.category}: ${finding}`)
      : [],
  );
  const reasons = [
    ...(!components.length
      ? [
          "No supported skill, rule, command, agent, plugin, or MCP evidence was found",
        ]
      : []),
    ...(!evidencePaths.length
      ? ["No immutable component evidence paths were found"]
      : []),
    ...blockedCategories.map(
      (item) => `${item.category} static evaluation is blocked`,
    ),
    ...reviewFindings,
    ...(discovery.license === "NOASSERTION"
      ? ["GitHub reports NOASSERTION; a human license decision is required"]
      : []),
    "A human must review usefulness, overlap, license, platform claims, and runtime behavior",
  ];
  const dossier: CandidateDossier = {
    schemaVersion: 1,
    dossierVersion: 1,
    createdAt: (options.now ?? new Date()).toISOString(),
    discoveryGeneratedAt: artifact.generatedAt,
    repository: discovery.repository,
    url: discovery.url,
    commit: snapshot.commit,
    defaultBranch: discovery.defaultBranch,
    description: discovery.description,
    license: discovery.license,
    stars: discovery.stars,
    matchedQueries: discovery.matchedQueries,
    growth: summary.growth,
    triagePriority: summary.triagePriority,
    triageEvidence: summary.triageEvidence,
    inspection: {
      skills: inspection.skills,
      resources: inspection.resources,
      plugins: inspection.plugins,
      mcpServers: inspection.mcpServers,
      counts: inspection.counts,
      warnings: inspection.warnings,
    },
    evaluation: {
      evaluatorVersion: evaluation.evaluatorVersion,
      categories: evaluation.categories,
      uncertainty: evaluation.uncertainty,
    },
    components,
    evidencePaths,
    overlap: overlapFor(discovery, inspection, catalog),
    review: {
      status:
        !components.length || !evidencePaths.length || blockedCategories.length
          ? "blocked"
          : "needs-human-review",
      reasons,
    },
    safetyBoundary:
      "Static inspection only: Loadout cloned source without running repository scripts, hooks, MCP servers, lifecycle commands, or models.",
  };
  sourceVerifiedDossiers.set(dossier, dossierIntegrity(dossier));
  return dossier;
}

export async function writeCandidateDossier(
  dossier: CandidateDossier,
  output?: string,
): Promise<string> {
  const target = resolve(
    output ??
      join(dossierDirectory(), `${dossier.repository.replace("/", "__")}.json`),
  );
  await ensureDirectory(dirname(target));
  await writeFileAtomically(target, `${JSON.stringify(dossier, null, 2)}\n`);
  return target;
}

function validPersistedEvaluation(
  value: unknown,
): value is Omit<PackageEvaluation, "root"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const evaluation = value as Omit<PackageEvaluation, "root">;
  const categories = evaluation.categories;
  return (
    evaluation.evaluatorVersion === 1 &&
    typeof evaluation.uncertainty === "string" &&
    Array.isArray(categories) &&
    categories.length === 2 &&
    new Set(categories.map((item) => item.category)).size === 2 &&
    categories.every(
      (item) =>
        (item.category === "skills" || item.category === "mcp") &&
        ["ready", "needs-review", "blocked", "not-applicable"].includes(
          item.status,
        ) &&
        isTextArray(item.findings),
    )
  );
}

function safeEvidencePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Boolean(value) &&
    !value.startsWith("/") &&
    !value.split(/[\\/]/).includes("..")
  );
}

function validPersistedInspection(
  value: unknown,
): value is Omit<PackageInspection, "root"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const inspection = value as Omit<PackageInspection, "root">;
  const validCount = (count: unknown): count is number =>
    typeof count === "number" && Number.isSafeInteger(count) && count >= 0;
  const validNamedPath = (item: unknown, type: string): boolean =>
    Boolean(
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      (item as { type?: unknown }).type === type &&
      typeof (item as { name?: unknown }).name === "string" &&
      safeEvidencePath((item as { path?: unknown }).path),
    );
  if (
    !Array.isArray(inspection.skills) ||
    !inspection.skills.every(
      (item) =>
        validNamedPath(item, "skill") &&
        (item.description === undefined ||
          typeof item.description === "string"),
    ) ||
    !Array.isArray(inspection.resources) ||
    !inspection.resources.every(
      (item) =>
        ["rule", "command", "agent"].includes(item.type) &&
        validNamedPath(item, item.type),
    ) ||
    !Array.isArray(inspection.plugins) ||
    !inspection.plugins.every(
      (item) =>
        validNamedPath(item, "plugin") &&
        (item.description === undefined ||
          typeof item.description === "string") &&
        (item.version === undefined || typeof item.version === "string") &&
        (item.author === undefined || typeof item.author === "string") &&
        Array.isArray(item.components) &&
        item.components.every((component) =>
          [
            "skill",
            "rule",
            "command",
            "agent",
            "mcp",
            "plugin",
            "root",
          ].includes(component),
        ) &&
        isTextArray(item.hookEvents) &&
        isTextArray(item.mcpServers) &&
        isTextArray(item.warnings),
    ) ||
    !Array.isArray(inspection.mcpServers) ||
    !inspection.mcpServers.every(
      (item) =>
        validNamedPath(item, "mcp") &&
        ["command", "url", "unknown"].includes(item.transport) &&
        (item.command === undefined || typeof item.command === "string") &&
        (item.url === undefined || typeof item.url === "string") &&
        validCount(item.argumentCount) &&
        validCount(item.environmentVariableCount) &&
        isTextArray(item.warnings),
    ) ||
    !inspection.counts ||
    !validCount(inspection.counts.skills) ||
    !validCount(inspection.counts.rules) ||
    !validCount(inspection.counts.commands) ||
    !validCount(inspection.counts.agents) ||
    !validCount(inspection.counts.plugins) ||
    !validCount(inspection.counts.mcpServers) ||
    !validCount(inspection.counts.manifests) ||
    !isTextArray(inspection.warnings)
  )
    return false;
  return (
    inspection.counts.skills === inspection.skills.length &&
    inspection.counts.rules ===
      inspection.resources.filter((item) => item.type === "rule").length &&
    inspection.counts.commands ===
      inspection.resources.filter((item) => item.type === "command").length &&
    inspection.counts.agents ===
      inspection.resources.filter((item) => item.type === "agent").length &&
    inspection.counts.plugins === inspection.plugins.length &&
    inspection.counts.mcpServers === inspection.mcpServers.length
  );
}

function assertDossierEvidence(dossier: CandidateDossier): void {
  if (!validPersistedInspection(dossier.inspection))
    throw new Error("Candidate dossier inspection evidence is invalid");
  const inspection: PackageInspection = { root: ".", ...dossier.inspection };
  const components = componentsFor(inspection);
  const evidencePaths = evidencePathsFor(inspection);
  if (JSON.stringify(dossier.components) !== JSON.stringify(components))
    throw new Error(
      "Candidate dossier components do not match inspection evidence",
    );
  if (JSON.stringify(dossier.evidencePaths) !== JSON.stringify(evidencePaths))
    throw new Error(
      "Candidate dossier evidencePaths do not match inspection evidence",
    );
}

export async function readCandidateDossier(
  path: string,
): Promise<CandidateDossier> {
  const target = resolve(path);
  const info = await stat(target);
  if (!info.isFile() || info.size > 20 * 1024 * 1024)
    throw new Error("Candidate dossier exceeds the 20 MiB limit");
  const value: unknown = JSON.parse(await readFile(target, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Candidate dossier must be an object");
  const dossier = value as Partial<CandidateDossier>;
  const componentKinds = new Set<ComponentType>([
    "skill",
    "rule",
    "command",
    "agent",
    "mcp",
    "plugin",
    "root",
  ]);
  if (
    dossier.schemaVersion !== 1 ||
    dossier.dossierVersion !== 1 ||
    typeof dossier.repository !== "string" ||
    typeof dossier.url !== "string" ||
    dossier.url !== `https://github.com/${dossier.repository}` ||
    typeof dossier.commit !== "string" ||
    !/^[a-f0-9]{40}$/i.test(dossier.commit) ||
    typeof dossier.defaultBranch !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(dossier.defaultBranch) ||
    dossier.defaultBranch.includes("..") ||
    typeof dossier.description !== "string" ||
    typeof dossier.license !== "string" ||
    !finiteNonnegative(dossier.stars) ||
    !validDate(dossier.createdAt) ||
    !validDate(dossier.discoveryGeneratedAt) ||
    !isTextArray(dossier.matchedQueries) ||
    !Array.isArray(dossier.components) ||
    dossier.components.some((component) => !componentKinds.has(component)) ||
    new Set(dossier.components).size !== dossier.components.length ||
    !Array.isArray(dossier.evidencePaths) ||
    dossier.evidencePaths.some(
      (item) =>
        typeof item !== "string" ||
        !item ||
        item.startsWith("/") ||
        item.split("/").includes(".."),
    ) ||
    !dossier.growth ||
    (dossier.growth.kind !== "observed-star-velocity" &&
      dossier.growth.kind !== "lifetime-star-average") ||
    typeof dossier.growth.starsPerDay !== "number" ||
    !Number.isFinite(dossier.growth.starsPerDay) ||
    !finiteNonnegative(dossier.triagePriority) ||
    !isTextArray(dossier.triageEvidence) ||
    !validPersistedInspection(dossier.inspection) ||
    !validPersistedEvaluation(dossier.evaluation) ||
    !Array.isArray(dossier.overlap) ||
    !dossier.review ||
    (dossier.review.status !== "blocked" &&
      dossier.review.status !== "needs-human-review") ||
    !isTextArray(dossier.review.reasons) ||
    typeof dossier.safetyBoundary !== "string"
  )
    throw new Error("Candidate dossier schema is invalid");
  normalizeRepository(dossier.repository);
  if (
    dossier.overlap.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        typeof item.packageId !== "string" ||
        typeof item.repository !== "string" ||
        typeof item.score !== "number" ||
        !Number.isFinite(item.score) ||
        item.score < 0 ||
        item.score > 1 ||
        (item.relationship !== "possible-overlap" &&
          item.relationship !== "same-tooling-area") ||
        !isTextArray(item.evidence),
    )
  )
    throw new Error("Candidate dossier overlap evidence is invalid");
  for (const item of dossier.overlap) normalizeRepository(item.repository);
  assertDossierEvidence(dossier as CandidateDossier);
  const derivedStatus =
    dossier.components.length === 0 ||
    dossier.evidencePaths.length === 0 ||
    dossier.evaluation.categories.some((item) => item.status === "blocked")
      ? "blocked"
      : "needs-human-review";
  if (dossier.review.status !== derivedStatus)
    throw new Error(
      `Candidate dossier review status is inconsistent; expected ${derivedStatus}`,
    );
  return dossier as CandidateDossier;
}

/** Recompute static evidence from the exact pinned commit before admission. */
export async function verifyCandidateDossierSource(
  dossier: CandidateDossier,
  options: {
    fetchSnapshot?: (
      repository: string,
      commit: string,
    ) => Promise<RepositorySnapshot>;
  } = {},
): Promise<CandidateDossier> {
  const snapshot = options.fetchSnapshot
    ? await options.fetchSnapshot(dossier.repository, dossier.commit)
    : await fetchRepositorySnapshot(dossier.repository, {
        ref: dossier.commit,
        timeoutMs: 120_000,
        maxBytes: 100 * 1024 * 1024,
        maxFiles: 20_000,
      });
  if (
    normalizeRepository(snapshot.repository).toLowerCase() !==
      dossier.repository.toLowerCase() ||
    snapshot.commit.toLowerCase() !== dossier.commit.toLowerCase()
  )
    throw new Error(
      "Candidate dossier source verification returned a mismatch",
    );
  const [inspection, evaluation] = await Promise.all([
    inspectPackage(snapshot.path),
    evaluatePackage(snapshot.path),
  ]);
  const persistedInspection: CandidateDossier["inspection"] = {
    skills: inspection.skills,
    resources: inspection.resources,
    plugins: inspection.plugins,
    mcpServers: inspection.mcpServers,
    counts: inspection.counts,
    warnings: inspection.warnings,
  };
  const persistedEvaluation: CandidateDossier["evaluation"] = {
    evaluatorVersion: evaluation.evaluatorVersion,
    categories: evaluation.categories,
    uncertainty: evaluation.uncertainty,
  };
  if (
    !isDeepStrictEqual(dossier.inspection, persistedInspection) ||
    !isDeepStrictEqual(dossier.evaluation, persistedEvaluation)
  )
    throw new Error(
      "Candidate dossier static evidence differs from its pinned source; inspect it again",
    );
  sourceVerifiedDossiers.set(dossier, dossierIntegrity(dossier));
  return dossier;
}

export function buildCatalogProposal(
  dossier: CandidateDossier,
  options: CandidateProposalOptions,
  existingCatalog: CatalogPackage[] = [],
): CatalogPackage {
  assertDossierEvidence(dossier);
  if (
    !dossier.components.length ||
    !dossier.evidencePaths.length ||
    dossier.evaluation.categories.some((item) => item.status === "blocked")
  )
    throw new Error(
      "Blocked dossier evidence cannot become a catalog proposal",
    );
  if (dossier.review.status === "blocked")
    throw new Error("Blocked dossiers cannot become catalog proposals");
  if (dossier.review.status !== "needs-human-review")
    throw new Error(
      "Only human-review-ready dossiers can become catalog proposals",
    );
  if (sourceVerifiedDossiers.get(dossier) !== dossierIntegrity(dossier))
    throw new Error(
      "Candidate dossier must be re-verified against its pinned source before proposal",
    );
  if (!/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(options.id))
    throw new Error("Proposal id must be lowercase kebab-case");
  if (!options.category.trim())
    throw new Error("Proposal category is required");
  if (!options.operatingSystems.length)
    throw new Error("At least one explicitly reviewed platform is required");
  if (existingCatalog.some((item) => item.id === options.id))
    throw new Error(`Catalog id '${options.id}' is already reviewed`);
  if (
    existingCatalog.some(
      (item) =>
        item.repository.toLowerCase() === dossier.repository.toLowerCase(),
    )
  )
    throw new Error(`${dossier.repository} is already in the reviewed catalog`);
  const proposal: CatalogPackage = {
    id: options.id,
    displayName:
      options.displayName?.trim() || dossier.repository.split("/")[1],
    repository: dossier.repository,
    description: options.description?.trim() || dossier.description,
    category: options.category.trim(),
    tier: options.tier ?? "community",
    license: options.license?.trim() || dossier.license,
    components: dossier.components,
    operatingSystems: [...new Set(options.operatingSystems)],
    source: {
      type: "github",
      url: dossier.url,
      defaultBranch: dossier.defaultBranch,
      commit: dossier.commit,
      evidencePaths: dossier.evidencePaths,
      verifiedAt: dossier.createdAt,
    },
    stars: dossier.stars,
  };
  validateCatalog([proposal], { requireEvidence: true });
  return proposal;
}

export function formatCandidateSummaries(
  candidates: CandidateSummary[],
): string {
  if (!candidates.length) return "No matching discovery candidates.";
  return candidates
    .map(
      (item) =>
        `${safeTerminalText(item.repository)} — priority ${item.triagePriority.toFixed(1)} — ★${item.stars.toLocaleString("en-US")} — ${item.growth.starsPerDay.toFixed(2)} stars/day (${item.growth.kind}) — ${safeTerminalText(item.license)}`,
    )
    .join("\n");
}

export function formatCandidateDossier(dossier: CandidateDossier): string {
  const counts = dossier.inspection.counts;
  return [
    `${safeTerminalText(dossier.repository)} @ ${dossier.commit}`,
    `Review: ${dossier.review.status}`,
    `Evidence: ${dossier.components.join(", ") || "none"}; ${dossier.evidencePaths.length} path(s)`,
    `Contents: ${counts.skills} skills, ${counts.rules} rules, ${counts.commands} commands, ${counts.agents} agents, ${counts.plugins} plugins, ${counts.mcpServers} MCP servers`,
    `Triage priority: ${dossier.triagePriority.toFixed(1)} (discovery ordering, not a quality score)`,
    `Possible overlaps: ${dossier.overlap.map((item) => `${item.packageId} ${item.score.toFixed(3)}`).join(", ") || "none detected"}`,
    ...dossier.review.reasons.map(
      (reason) => `  - ${safeTerminalText(reason)}`,
    ),
    safeTerminalText(dossier.safetyBoundary),
  ].join("\n");
}
