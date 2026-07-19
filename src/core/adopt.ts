import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, isAbsolute, join, posix, relative, sep } from "node:path";
import type { DetectedAgent, InstallPlan } from "../shared/types.js";
import type { CatalogSkillIndex, SkillProvenance } from "./provenance.js";
import { enrichInventoryWithProvenance } from "./provenance.js";
import { scanInstalledSkills } from "./skill-inventory.js";
import { installStatePath, recordInstall } from "./state.js";
import { runMutationTransaction } from "./transaction.js";

export interface AdoptionPlan {
  packageId: string;
  agent: DetectedAgent;
  name: string;
  path: string;
  fingerprint: string;
  /** Complete, fail-closed filesystem evidence captured during preview. */
  treeEvidence?: AdoptionTreeEntry[];
  provenance: SkillProvenance;
  reviewed: boolean;
  repository?: string;
  resolvedCommit?: string;
  installPlan: InstallPlan;
}

export interface AdoptionTreeEntry {
  path: string;
  type: "directory" | "file";
  sha256?: string;
}

export interface AdoptionApplyOptions {
  /** Test/integration seam that runs after preflight and before final recording. */
  beforeRecord?: () => Promise<void> | void;
}

function safeRelativePath(root: string, path: string): string {
  const value = relative(root, path).split(sep).join("/");
  if (!value || isAbsolute(value) || value === ".." || value.startsWith("../"))
    throw new Error(`Unsafe path while inspecting adoption tree: ${path}`);
  return value;
}

async function captureAdoptionTree(root: string): Promise<AdoptionTreeEntry[]> {
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory())
    throw new Error(`Refusing unsafe adoption root: ${root}`);
  const entries: AdoptionTreeEntry[] = [];
  async function visit(directory: string): Promise<void> {
    const children = (await readdir(directory, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name),
    );
    for (const child of children) {
      const path = join(directory, child.name);
      const relativePath = safeRelativePath(root, path);
      const info = await lstat(path);
      if (info.isSymbolicLink())
        throw new Error(
          `Refusing symlink while inspecting adoption tree: ${path}`,
        );
      if (info.isDirectory()) {
        entries.push({ path: relativePath, type: "directory" });
        await visit(path);
      } else if (info.isFile()) {
        entries.push({
          path: relativePath,
          type: "file",
          sha256: createHash("sha256")
            .update(await readFile(path))
            .digest("hex"),
        });
      } else {
        throw new Error(
          `Refusing special file while inspecting adoption tree: ${path}`,
        );
      }
    }
  }
  await visit(root);
  return entries;
}

function validateTreeEvidence(entries: AdoptionTreeEntry[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (
      !entry.path ||
      isAbsolute(entry.path) ||
      entry.path === ".." ||
      entry.path.startsWith("../") ||
      entry.path.includes("\\") ||
      entry.path.split("/").includes("..") ||
      posix.normalize(entry.path) !== entry.path ||
      (entry.type === "file" && !/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")) ||
      (entry.type === "directory" && entry.sha256 !== undefined) ||
      (entry.type !== "file" && entry.type !== "directory") ||
      seen.has(entry.path)
    )
      throw new Error(
        "The adoption preview contains unsafe tree evidence; preview again.",
      );
    seen.add(entry.path);
  }
}

function adoptionWarnings(exact: boolean, reviewed: boolean): string[] {
  if (reviewed) return [];
  if (exact)
    return [
      "SKILL.md matches the reviewed catalog, but auxiliary local entries are not covered by catalog evidence; adoption remains unreviewed.",
    ];
  return [
    "The installed bytes do not exactly match the reviewed catalog; adoption records ownership but does not mark them reviewed.",
  ];
}

function derivedReviewState(
  plan: Pick<AdoptionPlan, "provenance" | "treeEvidence">,
): {
  exact: boolean;
  reviewed: boolean;
} {
  const exact = plan.provenance.kind === "catalog-exact";
  const tree = plan.treeEvidence ?? [];
  return {
    exact,
    reviewed:
      exact &&
      tree.length === 1 &&
      tree[0].type === "file" &&
      tree[0].path === "SKILL.md",
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>))
      deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function canonicalInstallPlan(
  packageId: string,
  agent: DetectedAgent,
  name: string,
  path: string,
  warnings: string[],
): InstallPlan {
  return {
    packageId,
    targetAgents: [agent.id],
    warnings,
    files: [
      {
        source: path,
        target: path,
        targetAgent: agent.id,
        componentType: "skill",
        compatibility: "native",
        skillName: name,
      },
    ],
  };
}

function assertInstallPlanIntegrity(plan: AdoptionPlan): void {
  const review = derivedReviewState(plan);
  const expected = canonicalInstallPlan(
    plan.packageId,
    plan.agent,
    plan.name,
    plan.path,
    adoptionWarnings(review.exact, review.reviewed),
  );
  if (JSON.stringify(plan.installPlan) !== JSON.stringify(expected))
    throw new Error(
      "The adoption install plan was tampered with; preview again.",
    );
}

function expectedRecordedFiles(plan: AdoptionPlan): Array<{
  path: string;
  sha256: string;
}> {
  return (plan.treeEvidence ?? [])
    .filter(
      (entry): entry is AdoptionTreeEntry & { sha256: string } =>
        entry.type === "file" && Boolean(entry.sha256),
    )
    .map((entry) => ({
      path: join(plan.path, entry.path),
      sha256: entry.sha256,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "skill"
  );
}

export async function planSkillAdoption(
  skill: string,
  agent: DetectedAgent,
  index?: CatalogSkillIndex,
): Promise<AdoptionPlan> {
  const inventory = enrichInventoryWithProvenance(
    await scanInstalledSkills([agent]),
    index,
    index ? "cache" : "none",
  );
  const query = skill.trim().toLowerCase();
  const matches = inventory.skills.filter(
    (entry) =>
      entry.name.toLowerCase() === query ||
      basename(entry.path).toLowerCase() === query ||
      entry.path === skill,
  );
  if (!matches.length)
    throw new Error(
      `No installed skill named '${skill}' was found for ${agent.displayName}`,
    );
  if (matches.length > 1)
    throw new Error(
      `Skill '${skill}' is ambiguous for ${agent.displayName}: ${matches.map((entry) => entry.path).join(", ")}`,
    );
  const match = matches[0];
  if (match.managed)
    throw new Error(
      `Skill '${skill}' is already managed as ${match.packageId}`,
    );
  const exact =
    match.provenance.kind === "catalog-exact"
      ? match.provenance.candidates[0]
      : undefined;
  const packageId = `adopted-${agent.id}-${slug(match.name)}`;
  const treeEvidence = await captureAdoptionTree(match.path);
  const reviewed =
    Boolean(exact) &&
    treeEvidence.length === 1 &&
    treeEvidence[0].type === "file" &&
    treeEvidence[0].path === "SKILL.md";
  const warnings = adoptionWarnings(Boolean(exact), reviewed);
  const plan: AdoptionPlan = {
    packageId,
    agent: { ...agent },
    name: match.name,
    path: match.path,
    fingerprint: match.fingerprint,
    treeEvidence,
    provenance: {
      ...match.provenance,
      evidence: [...match.provenance.evidence],
      candidates: match.provenance.candidates.map((candidate) => ({
        ...candidate,
      })),
    },
    reviewed,
    ...(exact
      ? { repository: exact.repository, resolvedCommit: exact.commit }
      : {}),
    installPlan: canonicalInstallPlan(
      packageId,
      agent,
      match.name,
      match.path,
      warnings,
    ),
  };
  return deepFreeze(plan);
}

export async function applySkillAdoption(
  plan: AdoptionPlan,
  options: AdoptionApplyOptions = {},
): Promise<string> {
  const applied = await runMutationTransaction(
    async () => {
      if (!plan.treeEvidence)
        throw new Error(
          "The adoption preview lacks complete tree evidence; preview again.",
        );
      validateTreeEvidence(plan.treeEvidence);
      assertInstallPlanIntegrity(plan);
      const current = await captureAdoptionTree(plan.path);
      if (JSON.stringify(current) !== JSON.stringify(plan.treeEvidence))
        throw new Error(
          "The skill changed after preview; scan again before adopting it.",
        );
      return { targets: [installStatePath()], value: plan };
    },
    async (freshPlan, snapshot) => {
      const review = derivedReviewState(freshPlan);
      await options.beforeRecord?.();
      await recordInstall(
        freshPlan.installPlan,
        snapshot.id,
        {
          ...(freshPlan.repository ? { repository: freshPlan.repository } : {}),
          ...(freshPlan.resolvedCommit
            ? { resolvedCommit: freshPlan.resolvedCommit }
            : {}),
          reviewed: review.reviewed,
        },
        {
          expectedFiles: expectedRecordedFiles(freshPlan),
          verifyBeforeWrite: async () => {
            const current = await captureAdoptionTree(freshPlan.path);
            if (
              JSON.stringify(current) !== JSON.stringify(freshPlan.treeEvidence)
            )
              throw new Error(
                "The skill changed after preview; scan again before adopting it.",
              );
          },
        },
      );
    },
  );
  return applied.snapshotId;
}

export function formatAdoptionPlan(plan: AdoptionPlan): string {
  const review = derivedReviewState(plan);
  return [
    `Adopt: ${plan.name} for ${plan.agent.displayName}`,
    `Path: ${plan.path}`,
    `Managed id: ${plan.packageId}`,
    `Provenance: ${plan.provenance.kind} (${plan.provenance.confidence})`,
    `Review state: ${review.reviewed ? "reviewed exact catalog match" : "unreviewed"}`,
    `Bound tree entries: ${plan.treeEvidence?.length ?? 0}`,
    ...plan.installPlan.warnings.map((warning) => `Warning: ${warning}`),
  ].join("\n");
}
