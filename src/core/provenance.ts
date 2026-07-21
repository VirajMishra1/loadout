import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { CatalogPackage } from "../shared/types.js";
import { loadEffectiveCatalog } from "./catalog.js";
import { ensureDirectory, loadoutHome } from "./paths.js";
import type {
  InstalledSkillInventoryEntry,
  InstalledSkillInventoryReport,
} from "./skill-inventory.js";
import { discoverSkillDirectories } from "./skills.js";
import {
  fetchRepositorySnapshot,
  type RepositoryFetchOptions,
  type RepositorySnapshot,
} from "./source.js";
import { writeFileAtomically } from "./atomic-file.js";

export type ProvenanceConfidence =
  "exact" | "high" | "medium" | "low" | "unknown";

export type ProvenanceKind =
  | "loadout-managed"
  | "catalog-exact"
  | "embedded-source"
  | "catalog-name-candidate"
  | "unknown";

export interface CatalogSkillEvidence {
  packageId: string;
  packageDisplayName: string;
  repository: string;
  commit: string;
  tier: CatalogPackage["tier"];
  category: string;
  license?: string;
  skillName: string;
  description?: string;
  skillPath: string;
  fingerprint: string;
}

export interface CatalogSkillIndex {
  schemaVersion: 1;
  catalogDigest: string;
  generatedAt: string;
  records: CatalogSkillEvidence[];
  failures: Array<{ packageId: string; repository: string; error: string }>;
}

export interface SkillProvenance {
  kind: ProvenanceKind;
  confidence: ProvenanceConfidence;
  evidence: string[];
  candidates: CatalogSkillEvidence[];
}

export interface ProvenanceInventoryEntry extends InstalledSkillInventoryEntry {
  provenance: SkillProvenance;
}

export interface ProvenanceInventoryReport extends Omit<
  InstalledSkillInventoryReport,
  "skills"
> {
  skills: ProvenanceInventoryEntry[];
  provenance: {
    indexSource: "refreshed" | "cache" | "stale-cache" | "none";
    catalogDigest?: string;
    indexGeneratedAt?: string;
    indexedSkills: number;
    exact: number;
    managed: number;
    embedded: number;
    nameCandidates: number;
    unknown: number;
    failures: CatalogSkillIndex["failures"];
  };
}

export interface CatalogSkillIndexProgress {
  packageId: string;
  completed: number;
  total: number;
  status: "fetching" | "ready" | "failed";
  message: string;
}

export interface CatalogSkillIndexOptions {
  catalog?: CatalogPackage[];
  concurrency?: number;
  fetchSnapshot?: (
    repository: string,
    options?: RepositoryFetchOptions,
  ) => Promise<RepositorySnapshot>;
  onProgress?: (progress: CatalogSkillIndexProgress) => void;
  now?: Date;
}

const catalogSkillIndexPath = (): string =>
  join(loadoutHome(), "provenance", "catalog-skills.json");

function immutableCatalogDigest(catalog: CatalogPackage[]): string {
  const evidence = catalog
    .filter((pkg) => pkg.source?.commit && pkg.components?.includes("skill"))
    .map((pkg) => `${pkg.id}\0${pkg.source!.commit}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(evidence).digest("hex");
}

function cleanFrontmatterValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  )
    return trimmed.slice(1, -1);
  return trimmed;
}

function portablePath(root: string, path: string): string {
  return relative(resolve(root), resolve(path)).split(sep).join("/") || ".";
}

async function parallelMap<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await worker(values[index]);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), values.length) },
      run,
    ),
  );
  return results;
}

function isCatalogSkillIndex(value: unknown): value is CatalogSkillIndex {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const recordsValid =
    Array.isArray(item.records) &&
    item.records.every((record) => {
      if (!record || typeof record !== "object" || Array.isArray(record))
        return false;
      const candidate = record as Record<string, unknown>;
      return (
        typeof candidate.packageId === "string" &&
        typeof candidate.packageDisplayName === "string" &&
        typeof candidate.repository === "string" &&
        typeof candidate.commit === "string" &&
        ["official", "stable", "trending", "community"].includes(
          String(candidate.tier),
        ) &&
        typeof candidate.category === "string" &&
        (candidate.license === undefined ||
          typeof candidate.license === "string") &&
        typeof candidate.skillName === "string" &&
        (candidate.description === undefined ||
          typeof candidate.description === "string") &&
        typeof candidate.skillPath === "string" &&
        typeof candidate.fingerprint === "string"
      );
    });
  const failuresValid =
    Array.isArray(item.failures) &&
    item.failures.every((failure) => {
      if (!failure || typeof failure !== "object" || Array.isArray(failure))
        return false;
      const candidate = failure as Record<string, unknown>;
      return (
        typeof candidate.packageId === "string" &&
        typeof candidate.repository === "string" &&
        typeof candidate.error === "string"
      );
    });
  return (
    item.schemaVersion === 1 &&
    typeof item.catalogDigest === "string" &&
    typeof item.generatedAt === "string" &&
    recordsValid &&
    failuresValid
  );
}

export async function readCatalogSkillIndex(): Promise<
  CatalogSkillIndex | undefined
> {
  try {
    const value: unknown = JSON.parse(
      await readFile(catalogSkillIndexPath(), "utf8"),
    );
    return isCatalogSkillIndex(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function buildCatalogSkillIndex(
  options: CatalogSkillIndexOptions = {},
): Promise<CatalogSkillIndex> {
  const catalog = options.catalog ?? (await loadEffectiveCatalog());
  const packages = catalog.filter(
    (pkg) => pkg.source?.commit && pkg.components?.includes("skill"),
  );
  const fetchSnapshot = options.fetchSnapshot ?? fetchRepositorySnapshot;
  let completed = 0;
  const results = await parallelMap(
    packages,
    options.concurrency ?? 4,
    async (
      pkg,
    ): Promise<{
      records: CatalogSkillEvidence[];
      failure?: CatalogSkillIndex["failures"][number];
    }> => {
      options.onProgress?.({
        packageId: pkg.id,
        completed,
        total: packages.length,
        status: "fetching",
        message: `Indexing reviewed ${pkg.displayName} skills`,
      });
      try {
        const snapshot = await fetchSnapshot(pkg.repository, {
          ref: pkg.source!.commit,
        });
        if (snapshot.commit.toLowerCase() !== pkg.source!.commit.toLowerCase())
          throw new Error(
            `resolved ${snapshot.commit}, expected ${pkg.source!.commit}`,
          );
        const rejected: Array<{ name: string; reason: string }> = [];
        const directories = await discoverSkillDirectories(snapshot.path, {
          continueOnRejected: true,
          onRejected: (skill) =>
            rejected.push({
              name: skill.name ?? skill.targetName,
              reason: skill.reason,
            }),
        });
        const records = await Promise.all(
          directories.map(async (directory): Promise<CatalogSkillEvidence> => {
            const content = await readFile(join(directory, "SKILL.md"), "utf8");
            const description = cleanFrontmatterValue(
              content.match(/^description:\s*(.+)$/m)?.[1],
            );
            return {
              packageId: pkg.id,
              packageDisplayName: pkg.displayName,
              repository: pkg.repository,
              commit: pkg.source!.commit,
              tier: pkg.tier,
              category: pkg.category,
              ...(pkg.license ? { license: pkg.license } : {}),
              skillName:
                cleanFrontmatterValue(content.match(/^name:\s*(.+)$/m)?.[1]) ??
                directory.split(sep).at(-1) ??
                "unnamed",
              ...(description ? { description } : {}),
              skillPath: portablePath(snapshot.path, directory),
              fingerprint: createHash("sha256").update(content).digest("hex"),
            };
          }),
        );
        completed += 1;
        options.onProgress?.({
          packageId: pkg.id,
          completed,
          total: packages.length,
          status: "ready",
          message: `${pkg.displayName}: ${records.length} reviewed skill(s) indexed${rejected.length ? `; ${rejected.length} quarantined` : ""}`,
        });
        return {
          records,
          ...(rejected.length
            ? {
                failure: {
                  packageId: pkg.id,
                  repository: pkg.repository,
                  error: `${rejected.length} skill unit(s) quarantined: ${rejected
                    .map((item) => item.name)
                    .sort()
                    .join(", ")}`,
                },
              }
            : {}),
        };
      } catch (error) {
        completed += 1;
        const failure = {
          packageId: pkg.id,
          repository: pkg.repository,
          error: error instanceof Error ? error.message : String(error),
        };
        options.onProgress?.({
          packageId: pkg.id,
          completed,
          total: packages.length,
          status: "failed",
          message: `${pkg.displayName}: ${failure.error}`,
        });
        return { records: [], failure };
      }
    },
  );
  const index: CatalogSkillIndex = {
    schemaVersion: 1,
    catalogDigest: immutableCatalogDigest(catalog),
    generatedAt: (options.now ?? new Date()).toISOString(),
    records: results
      .flatMap((result) => result.records)
      .sort(
        (left, right) =>
          left.packageId.localeCompare(right.packageId) ||
          left.skillPath.localeCompare(right.skillPath),
      ),
    failures: results
      .flatMap((result) => (result.failure ? [result.failure] : []))
      .sort((left, right) => left.packageId.localeCompare(right.packageId)),
  };
  await ensureDirectory(dirname(catalogSkillIndexPath()));
  await writeFileAtomically(
    catalogSkillIndexPath(),
    `${JSON.stringify(index, null, 2)}\n`,
  );
  return index;
}

export async function resolveCatalogSkillIndex(
  options: {
    refresh?: boolean;
    offline?: boolean;
    build?: CatalogSkillIndexOptions;
  } = {},
): Promise<{
  index?: CatalogSkillIndex;
  source: "refreshed" | "cache" | "stale-cache" | "none";
}> {
  const catalog = options.build?.catalog ?? (await loadEffectiveCatalog());
  const digest = immutableCatalogDigest(catalog);
  const cached = await readCatalogSkillIndex();
  const stale = Boolean(cached && cached.catalogDigest !== digest);
  if (!options.refresh && cached && !stale)
    return { index: cached, source: "cache" };
  if (options.offline)
    return cached
      ? { index: cached, source: stale ? "stale-cache" : "cache" }
      : { source: "none" };
  return {
    index: await buildCatalogSkillIndex({
      ...options.build,
      catalog,
    }),
    source: "refreshed",
  };
}

function candidatesFor(
  skill: InstalledSkillInventoryEntry,
  index: CatalogSkillIndex | undefined,
): SkillProvenance {
  const records = index?.records ?? [];
  if (skill.managed) {
    const candidates = records.filter(
      (record) => record.packageId === skill.packageId,
    );
    return {
      kind: "loadout-managed",
      confidence: "high",
      evidence: [
        `Loadout state owns this path as package '${skill.packageId}'.`,
        ...(candidates.length
          ? ["The managed package also exists in the reviewed catalog index."]
          : []),
      ],
      candidates,
    };
  }
  const exact = records.filter(
    (record) => record.fingerprint === skill.fingerprint,
  );
  if (exact.length)
    return {
      kind: "catalog-exact",
      confidence: "exact",
      evidence: [
        `SKILL.md SHA-256 exactly matches ${exact.length} reviewed catalog record(s).`,
      ],
      candidates: exact,
    };
  const hints = new Set(
    (skill.sourceHints ?? []).map((item) => item.toLowerCase()),
  );
  const embedded = records.filter((record) =>
    hints.has(record.repository.toLowerCase()),
  );
  if (embedded.length)
    return {
      kind: "embedded-source",
      confidence: "medium",
      evidence: [
        "The skill text names a reviewed repository, but its instruction fingerprint differs from the reviewed commit.",
      ],
      candidates: embedded,
    };
  const name = skill.name.trim().toLowerCase();
  const named = records.filter(
    (record) => record.skillName.trim().toLowerCase() === name,
  );
  if (named.length)
    return {
      kind: "catalog-name-candidate",
      confidence: "low",
      evidence: [
        "Only the normalized skill name matches; names alone do not establish provenance or equivalence.",
      ],
      candidates: named,
    };
  return {
    kind: "unknown",
    confidence: "unknown",
    evidence: [
      index
        ? "No managed record, exact fingerprint, embedded reviewed source, or reviewed name match was found."
        : "No catalog skill index is available; run with provenance refresh for reviewed matching.",
    ],
    candidates: [],
  };
}

export function enrichInventoryWithProvenance(
  report: InstalledSkillInventoryReport,
  index: CatalogSkillIndex | undefined,
  source: ProvenanceInventoryReport["provenance"]["indexSource"] = "none",
): ProvenanceInventoryReport {
  const skills = report.skills.map((skill) => ({
    ...skill,
    provenance: candidatesFor(skill, index),
  }));
  const count = (kind: ProvenanceKind): number =>
    skills.filter((skill) => skill.provenance.kind === kind).length;
  return {
    ...report,
    skills,
    provenance: {
      indexSource: source,
      ...(index ? { catalogDigest: index.catalogDigest } : {}),
      ...(index ? { indexGeneratedAt: index.generatedAt } : {}),
      indexedSkills: index?.records.length ?? 0,
      exact: count("catalog-exact"),
      managed: count("loadout-managed"),
      embedded: count("embedded-source"),
      nameCandidates: count("catalog-name-candidate"),
      unknown: count("unknown"),
      failures: index?.failures ?? [],
    },
  };
}

export function formatProvenanceSummary(
  report: ProvenanceInventoryReport,
): string {
  const value = report.provenance;
  return [
    `Provenance: ${value.exact} exact catalog match(es), ${value.managed} Loadout-managed, ${value.embedded} embedded-source candidate(s), ${value.nameCandidates} name-only candidate(s), ${value.unknown} unknown`,
    `Catalog skill index: ${value.indexSource}; ${value.indexedSkills} reviewed skill(s)${value.failures.length ? `; ${value.failures.length} repository failure(s)` : ""}`,
  ].join("\n");
}
