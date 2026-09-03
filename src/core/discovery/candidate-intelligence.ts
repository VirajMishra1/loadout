import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type { CatalogPackage, ComponentType } from "../../shared/types.js";
import { writeFileAtomically } from "../install/atomic-file.js";
import { loadEffectiveCatalog, validateCatalog } from "../catalog/catalog.js";
import { evaluatePackage } from "./evaluate.js";
import { inspectPackage } from "../install/package.js";
import { ensureDirectory, loadoutHome } from "../agents/paths.js";
import {
  fetchRepositorySnapshot,
  normalizeRepository,
  type RepositorySnapshot,
} from "../install/source.js";
import { safeTerminalText } from "../reporting/terminal.js";
import {
  componentsFor,
  evidencePathsFor,
  installabilityFor,
  overlapFor,
} from "./candidate-intelligence-evidence.js";
import {
  assertDossierEvidence,
  finiteNonnegative,
  isTextArray,
  validDate,
  validPersistedEvaluation,
  validPersistedInspection,
} from "./candidate-intelligence-validation.js";
import type {
  CandidateDossier,
  CandidateProposalOptions,
  CandidateSummary,
  DiscoveryArtifact,
  DiscoveryRepository,
} from "./candidate-intelligence-types.js";

export type {
  CandidateDossier,
  CandidateProposalOptions,
  CandidateSummary,
  DiscoveryArtifact,
  DiscoveryRepository,
} from "./candidate-intelligence-types.js";

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
    join(moduleDirectory, "..", "..", "..", "..", "catalog", "discovered.json"),
    join(process.cwd(), "catalog", "discovered.json"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
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
  const installability = installabilityFor(components);
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
          "No portable skill, rule, command, agent, plugin, or MCP declaration was found; this may be a runtime tool that needs an explicit reviewed recipe",
        ]
      : []),
    ...(installability === "explicit-runtime-setup"
      ? [
          "Only plugin/MCP runtime evidence was found; Loadout will not run third-party setup automatically",
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
    installability,
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
    ![
      "portable-components",
      "explicit-runtime-setup",
      "unsupported-source-shape",
    ].includes(dossier.installability ?? "") ||
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
    `Installability: ${dossier.installability}`,
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
