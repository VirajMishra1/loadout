import { createHash } from "node:crypto";
import { cp, lstat, readFile, readdir, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type {
  AgentId,
  DetectedAgent,
  InstallMetadata,
  InstallPlan,
} from "../shared/types.js";
import { analyzeUpdateSafety, type SafetyFinding } from "./safety.js";
import {
  enrichInventoryWithProvenance,
  type CatalogSkillEvidence,
  type CatalogSkillIndex,
} from "./provenance.js";
import { scanInstalledSkills } from "./skill-inventory.js";
import { installStatePath, recordInstallBatch } from "./state.js";
import { runMutationTransaction } from "./transaction.js";
import { repositoryCachePath } from "./source.js";
import { validateSkillDirectory } from "./skills.js";

interface TreeEntry {
  path: string;
  sha256: string;
}

export type ReconcileStatus = "exact" | "outdated" | "ambiguous" | "unknown";

export interface ReconcileInstallation {
  agent: AgentId;
  path: string;
  tree: TreeEntry[];
}

export interface ReconcileItem {
  name: string;
  fingerprint: string;
  status: ReconcileStatus;
  installations: ReconcileInstallation[];
  packageId?: string;
  candidate?: CatalogSkillEvidence;
  sourcePath?: string;
  safetyFindings: SafetyFinding[];
  approvalRequired: boolean;
  reason: string;
}

export interface ReconcilePlan {
  generatedAt: string;
  items: ReconcileItem[];
  summary: {
    existing: number;
    exact: number;
    outdated: number;
    ambiguous: number;
    unknown: number;
    mirroredGroups: number;
  };
}

interface IssuedReconcilePlan {
  signature: string;
}

const issuedPlans = new WeakMap<ReconcilePlan, IssuedReconcilePlan>();
const IGNORED_TREE_NAMES = new Set([".git", ".cache", "node_modules"]);

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "skill"
  );
}

async function captureTree(root: string): Promise<TreeEntry[]> {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new Error(`Refusing unsafe reconciliation root: ${root}`);
  const entries: TreeEntry[] = [];
  async function visit(directory: string): Promise<void> {
    const children = (await readdir(directory, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name),
    );
    for (const child of children) {
      if (IGNORED_TREE_NAMES.has(child.name)) continue;
      const path = join(directory, child.name);
      if (child.isSymbolicLink())
        throw new Error(`Refusing symlink in reconciliation tree: ${path}`);
      if (child.isDirectory()) await visit(path);
      else if (child.isFile())
        entries.push({
          path: relative(root, path).split(sep).join("/"),
          sha256: createHash("sha256")
            .update(await readFile(path))
            .digest("hex"),
        });
    }
  }
  await visit(root);
  return entries;
}

function treeSignature(tree: TreeEntry[]): string {
  return JSON.stringify(tree);
}

function uniqueFindings(findings: SafetyFinding[]): SafetyFinding[] {
  return [
    ...new Map(
      findings.map((finding) => [
        `${finding.severity}:${finding.category}:${finding.message}:${finding.paths.join(",")}:${finding.names?.join(",") ?? ""}`,
        finding,
      ]),
    ).values(),
  ];
}

function planSignature(plan: ReconcilePlan): string {
  return JSON.stringify(
    plan.items.map((item) => ({
      name: item.name,
      fingerprint: item.fingerprint,
      status: item.status,
      packageId: item.packageId,
      candidate: item.candidate
        ? [
            item.candidate.packageId,
            item.candidate.commit,
            item.candidate.skillPath,
          ]
        : undefined,
      installations: item.installations.map((installation) => ({
        agent: installation.agent,
        path: installation.path,
        tree: installation.tree,
      })),
    })),
  );
}

function candidateSource(candidate: CatalogSkillEvidence): string {
  return join(
    repositoryCachePath(candidate.repository, candidate.commit),
    candidate.skillPath,
  );
}

async function itemFor(
  name: string,
  fingerprint: string,
  installations: Array<{
    agent: AgentId;
    path: string;
    repositoryOrigin?: string;
  }>,
  index: CatalogSkillIndex,
): Promise<ReconcileItem> {
  const captured = await Promise.all(
    installations.map(async (installation) => ({
      ...installation,
      tree: await captureTree(installation.path),
    })),
  );
  const namedCandidates = index.records.filter(
    (record) => record.skillName.trim().toLowerCase() === name.toLowerCase(),
  );
  const repositoryOrigins = new Set(
    installations
      .flatMap((installation) => installation.repositoryOrigin ?? [])
      .map((origin) => origin.toLowerCase()),
  );
  const hintedCandidates = namedCandidates.filter((record) =>
    repositoryOrigins.has(record.repository.toLowerCase()),
  );
  const candidates = hintedCandidates.length
    ? hintedCandidates
    : namedCandidates;
  const available = (
    await Promise.all(
      candidates.map(async (candidate) => {
        const sourcePath = candidateSource(candidate);
        try {
          const tree = await captureTree(sourcePath);
          return { candidate, sourcePath, tree };
        } catch {
          return undefined;
        }
      }),
    )
  ).filter(
    (
      item,
    ): item is {
      candidate: CatalogSkillEvidence;
      sourcePath: string;
      tree: TreeEntry[];
    } => Boolean(item),
  );
  const exact = available.filter((entry) =>
    captured.every(
      (installation) =>
        treeSignature(installation.tree) === treeSignature(entry.tree),
    ),
  );
  const selected = exact.length === 1 ? exact[0] : available[0];
  const packageId = selected
    ? `adopted-${slug(selected.candidate.packageId)}-${slug(name)}-${fingerprint.slice(0, 8)}`
    : undefined;
  if (exact.length === 1 && selected)
    return {
      name,
      fingerprint,
      status: "exact",
      installations: captured,
      packageId,
      candidate: selected.candidate,
      sourcePath: selected.sourcePath,
      safetyFindings: [],
      approvalRequired: false,
      reason:
        "Every installed file exactly matches one pinned catalog skill tree.",
    };
  if (available.length === 1 && selected) {
    const safety = uniqueFindings(
      (
        await Promise.all(
          captured.map((installation) =>
            analyzeUpdateSafety(installation.path, selected.sourcePath),
          ),
        )
      ).flatMap((analysis) => analysis.findings),
    );
    return {
      name,
      fingerprint,
      status: "outdated",
      installations: captured,
      packageId,
      candidate: selected.candidate,
      sourcePath: selected.sourcePath,
      safetyFindings: safety,
      approvalRequired: safety.some(
        (finding) => finding.severity === "blocking",
      ),
      reason:
        "One reviewed same-name upstream skill exists, but the installed tree differs.",
    };
  }
  if (available.length > 1)
    return {
      name,
      fingerprint,
      status: "ambiguous",
      installations: captured,
      safetyFindings: [],
      approvalRequired: false,
      reason: `${available.length} reviewed same-name candidates exist; Loadout will not guess which source owns these bytes.`,
    };
  return {
    name,
    fingerprint,
    status: "unknown",
    installations: captured,
    safetyFindings: [],
    approvalRequired: false,
    reason: "No reviewed same-name catalog source is available.",
  };
}

export async function buildReconcilePlan(
  agents: DetectedAgent[],
  index: CatalogSkillIndex,
): Promise<ReconcilePlan> {
  const inventory = enrichInventoryWithProvenance(
    await scanInstalledSkills(agents),
    index,
    "cache",
  );
  const groups = new Map<
    string,
    Array<{
      agent: AgentId;
      path: string;
      name: string;
      fingerprint: string;
      repositoryOrigin?: string;
    }>
  >();
  for (const skill of inventory.skills.filter((entry) => !entry.managed)) {
    const key = `${skill.name.toLowerCase()}\0${skill.fingerprint}`;
    const values = groups.get(key) ?? [];
    values.push({
      agent: skill.agent,
      path: skill.path,
      name: skill.name,
      fingerprint: skill.fingerprint,
      ...(skill.repositoryOrigin
        ? { repositoryOrigin: skill.repositoryOrigin }
        : {}),
    });
    groups.set(key, values);
  }
  const items = await Promise.all(
    [...groups.values()].map((group) =>
      itemFor(
        group[0].name,
        group[0].fingerprint,
        group.map(({ agent, path, repositoryOrigin }) => ({
          agent,
          path,
          ...(repositoryOrigin ? { repositoryOrigin } : {}),
        })),
        index,
      ),
    ),
  );
  items.sort(
    (left, right) =>
      left.status.localeCompare(right.status) ||
      left.name.localeCompare(right.name),
  );
  const count = (status: ReconcileStatus): number =>
    items.filter((item) => item.status === status).length;
  const plan: ReconcilePlan = {
    generatedAt: new Date().toISOString(),
    items,
    summary: {
      existing: items.reduce(
        (total, item) => total + item.installations.length,
        0,
      ),
      exact: count("exact"),
      outdated: count("outdated"),
      ambiguous: count("ambiguous"),
      unknown: count("unknown"),
      mirroredGroups: items.filter((item) => item.installations.length > 1)
        .length,
    },
  };
  issuedPlans.set(plan, { signature: planSignature(plan) });
  return plan;
}

function installPlanFor(item: ReconcileItem, replace: boolean): InstallPlan {
  if (!item.packageId || !item.candidate || !item.sourcePath)
    throw new Error(
      `Reconciliation item '${item.name}' has no reviewed source`,
    );
  return {
    packageId: item.packageId,
    targetAgents: [...new Set(item.installations.map((entry) => entry.agent))],
    warnings: [],
    files: item.installations.map((installation) => ({
      source: replace ? item.sourcePath! : installation.path,
      target: installation.path,
      targetAgent: installation.agent,
      componentType: "skill",
      compatibility: "native",
      skillName: item.name,
    })),
  };
}

async function assertPlanUnchanged(plan: ReconcilePlan): Promise<void> {
  const issued = issuedPlans.get(plan);
  if (!issued || issued.signature !== planSignature(plan))
    throw new Error(
      "Reconciliation plan changed after preview; preview again.",
    );
  for (const item of plan.items)
    for (const installation of item.installations)
      if (
        treeSignature(await captureTree(installation.path)) !==
        treeSignature(installation.tree)
      )
        throw new Error(
          `Existing skill changed after preview: ${installation.path}`,
        );
}

export async function applyReconcilePlan(
  plan: ReconcilePlan,
  options: { replaceOutdated?: boolean; approveRisk?: boolean } = {},
): Promise<{ snapshotId: string; adopted: number; updated: number }> {
  await assertPlanUnchanged(plan);
  const exact = plan.items.filter((item) => item.status === "exact");
  const outdated = options.replaceOutdated
    ? plan.items.filter((item) => item.status === "outdated")
    : [];
  const selected = [...exact, ...outdated];
  if (!selected.length)
    throw new Error(
      "No exact or explicitly selected outdated skills to reconcile",
    );
  const risky = outdated.filter((item) => item.approvalRequired);
  if (risky.length && !options.approveRisk)
    throw new Error(
      `Replacing ${risky.length} outdated skill group(s) requires --approve-risk after reviewing the reported findings.`,
    );
  const entries = selected.map((item) => ({
    plan: installPlanFor(item, item.status === "outdated"),
    metadata: {
      ownershipOrigin: "adopted",
      repository: item.candidate!.repository,
      resolvedCommit: item.candidate!.commit,
      reviewed: true,
    } satisfies InstallMetadata,
  }));
  const outdatedTargets = outdated.flatMap((item) =>
    item.installations.map((installation) => installation.path),
  );
  const applied = await runMutationTransaction(
    async () => {
      await assertPlanUnchanged(plan);
      return {
        targets: [...outdatedTargets, installStatePath()],
        value: entries,
      };
    },
    async (freshEntries, snapshot) => {
      for (const entry of freshEntries.filter((candidate) =>
        outdated.some((item) => item.packageId === candidate.plan.packageId),
      ))
        for (const file of entry.plan.files) {
          await rm(file.target, { recursive: true, force: true });
          await cp(file.source, file.target, {
            recursive: true,
            filter: (source) =>
              !source.split(sep).some((part) => IGNORED_TREE_NAMES.has(part)),
          });
          await validateSkillDirectory(file.target);
          if (
            treeSignature(await captureTree(file.target)) !==
            treeSignature(await captureTree(file.source))
          )
            throw new Error(
              `Exact reconciliation copy verification failed: ${file.target}`,
            );
        }
      await recordInstallBatch(freshEntries, snapshot.id);
    },
    { label: "reconcile existing skills" },
  );
  return {
    snapshotId: applied.snapshotId,
    adopted: exact.length,
    updated: outdated.length,
  };
}

export function formatReconcilePlan(plan: ReconcilePlan): string {
  const lines = [
    "Existing skill reconciliation",
    "",
    `${plan.summary.existing} installed copy/copies in ${plan.items.length} unique version group(s)`,
    `${plan.summary.exact} exact upstream match(es)`,
    `${plan.summary.outdated} reviewed update candidate(s)`,
    `${plan.summary.ambiguous} ambiguous group(s)`,
    `${plan.summary.unknown} unknown group(s)`,
    `${plan.summary.mirroredGroups} cross-agent mirror group(s)`,
  ];
  for (const item of plan.items) {
    const marker =
      item.status === "exact"
        ? "✓"
        : item.status === "outdated"
          ? "↑"
          : item.status === "ambiguous"
            ? "?"
            : "·";
    lines.push(
      "",
      `${marker} ${item.name} — ${item.status} — ${item.installations.map((entry) => entry.agent).join(", ")}`,
      `  ${item.reason}`,
    );
    if (item.candidate)
      lines.push(
        `  Source: ${item.candidate.repository}@${item.candidate.commit.slice(0, 12)} (${item.candidate.skillPath})`,
      );
    if (item.safetyFindings.length)
      lines.push(
        `  Review: ${item.safetyFindings.length} safety-sensitive update finding(s)${item.approvalRequired ? "; explicit approval required" : ""}`,
        ...item.safetyFindings.map(
          (finding) =>
            `    - ${finding.severity}/${finding.category}: ${finding.message}${finding.paths.length ? ` [${finding.paths.slice(0, 3).join(", ")}${finding.paths.length > 3 ? ", …" : ""}]` : ""}`,
        ),
      );
  }
  lines.push(
    "",
    "Default apply adopts exact matches without changing their files.",
    "Outdated replacements require --replace-outdated and remain one rollback-safe transaction.",
  );
  return lines.join("\n");
}
