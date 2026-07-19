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
  return {
    packageId,
    agent,
    name: match.name,
    path: match.path,
    fingerprint: match.fingerprint,
    treeEvidence,
    provenance: match.provenance,
    reviewed: Boolean(exact),
    ...(exact
      ? { repository: exact.repository, resolvedCommit: exact.commit }
      : {}),
    installPlan: {
      packageId,
      targetAgents: [agent.id],
      warnings: exact
        ? []
        : [
            "The installed bytes do not exactly match the reviewed catalog; adoption records ownership but does not mark them reviewed.",
          ],
      files: [
        {
          source: match.path,
          target: match.path,
          targetAgent: agent.id,
          componentType: "skill",
          compatibility: "native",
          skillName: match.name,
        },
      ],
    },
  };
}

export async function applySkillAdoption(plan: AdoptionPlan): Promise<string> {
  const applied = await runMutationTransaction(
    async () => {
      if (!plan.treeEvidence)
        throw new Error(
          "The adoption preview lacks complete tree evidence; preview again.",
        );
      validateTreeEvidence(plan.treeEvidence);
      const current = await captureAdoptionTree(plan.path);
      if (JSON.stringify(current) !== JSON.stringify(plan.treeEvidence))
        throw new Error(
          "The skill changed after preview; scan again before adopting it.",
        );
      return { targets: [installStatePath()], value: plan };
    },
    async (freshPlan, snapshot) => {
      await recordInstall(freshPlan.installPlan, snapshot.id, {
        ...(freshPlan.repository ? { repository: freshPlan.repository } : {}),
        ...(freshPlan.resolvedCommit
          ? { resolvedCommit: freshPlan.resolvedCommit }
          : {}),
        reviewed: freshPlan.reviewed,
      });
    },
  );
  return applied.snapshotId;
}

export function formatAdoptionPlan(plan: AdoptionPlan): string {
  return [
    `Adopt: ${plan.name} for ${plan.agent.displayName}`,
    `Path: ${plan.path}`,
    `Managed id: ${plan.packageId}`,
    `Provenance: ${plan.provenance.kind} (${plan.provenance.confidence})`,
    `Review state: ${plan.reviewed ? "reviewed exact catalog match" : "unreviewed"}`,
    `Bound tree entries: ${plan.treeEvidence?.length ?? 0}`,
    ...plan.installPlan.warnings.map((warning) => `Warning: ${warning}`),
  ].join("\n");
}
