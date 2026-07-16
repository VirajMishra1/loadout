import { existsSync } from "node:fs";
import { cp, lstat, rm } from "node:fs/promises";
import { basename, dirname, join, posix, win32 } from "node:path";
import type { AgentId, DetectedAgent, InstallPlan } from "../shared/types.js";
import { ensureDirectory, loadoutHome } from "./paths.js";
import { planAdapterSkillInstall } from "./adapters.js";
import { createSnapshot } from "./snapshot.js";
import {
  applySkillPlan,
  detectInstallConflicts,
  validateSkillDirectory,
} from "./skills.js";
import {
  activationLibraryPath,
  installStatePath,
  recordInstall,
  recordInstallBatch,
  recordLibraryInstallBatch,
  readInstallState,
} from "./state.js";
import {
  beginTransaction,
  completeTransaction,
  markTransactionCommitting,
  recoverPendingTransactions,
  rollbackTransaction,
} from "./transaction.js";

export function installedAgents(
  agents: DetectedAgent[],
  requested?: AgentId[],
): DetectedAgent[] {
  const available = agents.filter((agent) => agent.installed);
  if (!requested || requested.length === 0) return available;
  const selected = available.filter((agent) => requested.includes(agent.id));
  if (selected.length !== requested.length) {
    const missing = requested.filter(
      (id) => !selected.some((agent) => agent.id === id),
    );
    throw new Error(`Requested agents are not detected: ${missing.join(", ")}`);
  }
  return selected;
}

async function assertActiveTargetsUnoccupied(
  plans: InstallPlan[],
  options: { allowManagedReplacement?: boolean } = {},
): Promise<void> {
  const occupied: string[] = [];
  for (const target of [
    ...new Set(plans.flatMap((plan) => plan.files.map((file) => file.target))),
  ])
    try {
      await lstat(target);
      occupied.push(target);
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        (error as { code?: string }).code !== "ENOENT"
      )
        throw error;
    }
  if (occupied.length && options.allowManagedReplacement) {
    const state = await readInstallState();
    const allowed = new Set(
      plans.flatMap((plan) => {
        const install = state.installs.find(
          (record) => record.packageId === plan.packageId,
        );
        const packageActivations = (state.activations ?? []).filter(
          (record) => record.packageId === plan.packageId,
        );
        const active =
          packageActivations.length === 0 ||
          packageActivations.some(
            (record) =>
              record.installationState === "installed" &&
              record.activationState === "active",
          );
        if (!install || !active) return [];
        const recorded = install.files
          .filter((file) => basename(file.path) === "SKILL.md")
          .map((file) => dirname(file.path));
        const legacy = packageActivations.length
          ? []
          : plan.files
              .map((file) => file.target)
              .filter((target) => basename(target) === plan.packageId);
        return [...recorded, ...legacy];
      }),
    );
    if (occupied.every((target) => allowed.has(target))) return;
  }
  if (occupied.length)
    throw new Error(
      `Installation refuses ${occupied.length} occupied skill target(s); scan, compare, or adopt them first. First target: ${occupied[0]}`,
    );
}

export async function buildSkillPlan(
  source: string,
  packageId: string,
  agents: DetectedAgent[],
): Promise<InstallPlan> {
  if (!existsSync(source))
    throw new Error(`Package source does not exist: ${source}`);
  const sourceStat = await lstat(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error(`Package source must be a real directory: ${source}`);
  }
  // A repository may contain one skill at its root or several nested skills.
  // Validate the root when present; planSkillInstall validates every nested skill.
  if (existsSync(join(source, "SKILL.md")))
    await validateSkillDirectory(source);
  const plans = await Promise.all(
    agents.map((agent) => planAdapterSkillInstall(source, packageId, agent)),
  );
  const files = plans.flatMap((plan) => plan.files);
  const conflicts = detectInstallConflicts([
    {
      packageId,
      files,
      targetAgents: agents.map((agent) => agent.id),
      warnings: [],
    },
  ]);
  return {
    packageId,
    files,
    targetAgents: agents.map((agent) => agent.id),
    warnings: conflicts
      .filter((item) => item.severity === "warning")
      .map((item) => item.message),
    conflicts,
  };
}

export async function applySkillInstall(
  plan: InstallPlan,
  metadata?: {
    repository?: string;
    resolvedCommit?: string;
    reviewed?: boolean;
  },
  options: { allowManagedReplacement?: boolean } = {},
): Promise<string> {
  const blocking = (plan.conflicts ?? []).filter(
    (conflict) => conflict.severity === "blocking",
  );
  if (blocking.length > 0)
    throw new Error(
      `Installation blocked by conflicts: ${blocking.map((conflict) => conflict.message).join("; ")}`,
    );
  await assertActiveTargetsUnoccupied([plan], options);
  await recoverPendingTransactions();
  const targets = [
    ...plan.files.map((file) => file.target),
    installStatePath(),
  ];
  const snapshot = await createSnapshot(targets);
  const transaction = await beginTransaction(snapshot, targets);
  try {
    await markTransactionCommitting(transaction);
    await applySkillPlan(plan);
    await recordInstall(plan, snapshot.id, metadata);
    await completeTransaction(transaction);
  } catch (error) {
    await rollbackTransaction(transaction);
    throw error;
  }
  return snapshot.id;
}

export interface InstallBatchEntry {
  plan: InstallPlan;
  metadata?: {
    repository?: string;
    resolvedCommit?: string;
    reviewed?: boolean;
  };
}

/** Apply all selected packages as one filesystem transaction and one state update. */
export async function applySkillInstallBatch(
  entries: InstallBatchEntry[],
  extraSnapshotPaths: string[] = [],
): Promise<string> {
  if (!entries.length) throw new Error("Installation batch is empty");
  const conflicts = detectInstallConflicts(entries.map((entry) => entry.plan));
  const blocking = conflicts.filter(
    (conflict) => conflict.severity === "blocking",
  );
  if (blocking.length)
    throw new Error(
      `Installation blocked by conflicts: ${blocking.map((item) => item.message).join("; ")}`,
    );
  await assertActiveTargetsUnoccupied(entries.map((entry) => entry.plan));
  for (const entry of entries) {
    entry.plan.conflicts = [
      ...(entry.plan.conflicts ?? []),
      ...conflicts.filter((conflict) =>
        conflict.packageIds.includes(entry.plan.packageId),
      ),
    ];
    entry.plan.warnings = [
      ...new Set([
        ...entry.plan.warnings,
        ...conflicts
          .filter(
            (conflict) =>
              conflict.severity === "warning" &&
              conflict.packageIds.includes(entry.plan.packageId),
          )
          .map((conflict) => conflict.message),
      ]),
    ];
  }
  await recoverPendingTransactions();
  const targets = [
    ...entries.flatMap((entry) => entry.plan.files.map((file) => file.target)),
    installStatePath(),
    ...extraSnapshotPaths,
  ];
  const snapshot = await createSnapshot(targets);
  const transaction = await beginTransaction(snapshot, targets);
  try {
    await markTransactionCommitting(transaction);
    for (const entry of entries) await applySkillPlan(entry.plan);
    await recordInstallBatch(entries, snapshot.id);
    await completeTransaction(transaction);
  } catch (error) {
    await rollbackTransaction(transaction);
    throw error;
  }
  return snapshot.id;
}

/**
 * Download a batch into the reviewed library without exposing any skill to an
 * agent yet. This is the safe destination for Maximum Library.
 */
export async function applySkillLibraryBatch(
  entries: InstallBatchEntry[],
): Promise<string> {
  if (!entries.length) throw new Error("Library batch is empty");
  const conflicts = detectInstallConflicts(entries.map((entry) => entry.plan));
  const blocking = conflicts.filter(
    (conflict) => conflict.severity === "blocking",
  );
  if (blocking.length)
    throw new Error(
      `Library installation blocked by conflicts: ${blocking.map((item) => item.message).join("; ")}`,
    );
  const state = await readInstallState();
  const selected = new Set(entries.map((entry) => entry.plan.packageId));
  const active = (state.activations ?? []).filter(
    (record) =>
      selected.has(record.packageId) &&
      record.installationState === "installed" &&
      record.activationState === "active",
  );
  if (active.length)
    throw new Error(
      `Maximum Library will not relabel ${active.length} active managed skill(s) as disabled. Disable the selected packages first, then retry.`,
    );
  await recoverPendingTransactions();
  const libraryPaths = [
    ...new Set(
      entries.flatMap((entry) =>
        entry.plan.targetAgents.map((agent) =>
          activationLibraryPath(entry.plan.packageId, agent),
        ),
      ),
    ),
  ];
  const targets = [...libraryPaths, installStatePath()];
  const snapshot = await createSnapshot(targets);
  const transaction = await beginTransaction(snapshot, targets);
  try {
    await markTransactionCommitting(transaction);
    for (const path of libraryPaths)
      await rm(path, { recursive: true, force: true });
    for (const entry of entries) {
      for (const file of entry.plan.files) {
        const agent =
          file.targetAgent ??
          (entry.plan.targetAgents.length === 1
            ? entry.plan.targetAgents[0]
            : undefined);
        if (!agent)
          throw new Error(
            `Cannot place ${entry.plan.packageId} in the library: target agent is ambiguous`,
          );
        const unitId = basename(file.target);
        const unitLibraryPath = activationLibraryPath(
          entry.plan.packageId,
          agent,
          unitId,
        );
        await ensureDirectory(unitLibraryPath);
        const destination = join(unitLibraryPath, basename(file.target));
        await cp(file.source, destination, {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
      }
    }
    await recordLibraryInstallBatch(entries, snapshot.id);
    await completeTransaction(transaction);
  } catch (error) {
    await rollbackTransaction(transaction);
    throw error;
  }
  return snapshot.id;
}

export function snapshotPath(
  snapshotId: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const path = platform === "win32" ? win32 : posix;
  return path.join(
    loadoutHome(environment, platform),
    "snapshots",
    `${snapshotId}.json`,
  );
}
