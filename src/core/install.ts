import { existsSync } from "node:fs";
import { cp, lstat, rm } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  win32,
} from "node:path";
import type {
  AgentId,
  DetectedAgent,
  InstallMetadata,
  InstallPlan,
  InstallRecord,
  ManagedActivationRecord,
} from "../shared/types.js";
import { ensureDirectory, loadoutHome } from "./paths.js";
import { planAdapterSkillInstall } from "./adapters.js";
import { applySkillPlan, detectInstallConflicts } from "./skills.js";
import {
  activationLibraryPath,
  installStatePath,
  recordInstall,
  recordInstallBatch,
  recordLibraryInstallBatch,
  readInstallState,
  hashDirectory,
  writeInstallState,
} from "./state.js";
import { runMutationTransaction } from "./transaction.js";
import { inspectTargetOccupancy } from "./target-occupancy.js";

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

function relativeHashes(
  root: string,
  files: Array<{ path: string; sha256: string }>,
): Array<{ path: string; sha256: string }> {
  return files
    .filter((file) => isInside(root, file.path))
    .map((file) => ({
      path: relative(root, file.path),
      sha256: file.sha256,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function isInside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== "" && !child.startsWith("..") && !isAbsolute(child);
}

function activationKey(
  record: Pick<ManagedActivationRecord, "packageId" | "agent" | "unitId">,
): string {
  return `${record.packageId}\0${record.agent}\0${record.unitId ?? ""}`;
}

async function assertManagedTargetUnchanged(
  target: string,
  owner: InstallRecord | undefined,
): Promise<void> {
  const expected = relativeHashes(target, owner?.files ?? []);
  const actual = relativeHashes(target, await hashDirectory(target));
  if (!expected.length || JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `Installation refuses to replace drifted managed skill target: ${target}`,
    );
}

export interface ManagedProfileReconciliation {
  obsoleteActivationKeys: string[];
  obsoletePackageIds: string[];
  obsoleteTargets: string[];
  obsoleteUnits: Array<{
    packageId: string;
    agent: AgentId;
    unitId?: string;
  }>;
}

export async function planManagedProfileReconciliation(
  entries: InstallBatchEntry[],
): Promise<ManagedProfileReconciliation> {
  const state = await readInstallState();
  const requestedAgents = new Set(
    entries.flatMap((entry) => entry.plan.targetAgents),
  );
  const desiredTargets = new Set(
    entries.flatMap((entry) => entry.plan.files.map((file) => file.target)),
  );
  const obsolete: ManagedActivationRecord[] = [];
  for (const activation of state.activations ?? []) {
    if (
      !requestedAgents.has(activation.agent) ||
      activation.installationState !== "installed" ||
      activation.activationState !== "active"
    )
      continue;
    const staleTargets = activation.targets.filter(
      (target) => !desiredTargets.has(target.activePath),
    );
    if (!staleTargets.length) continue;
    if (staleTargets.length !== activation.targets.length)
      throw new Error(
        `Profile reconciliation refuses a partially selected managed unit: ${activation.packageId}/${activation.unitId ?? "skill"}`,
      );
    const owner = state.installs.find(
      (record) => record.packageId === activation.packageId,
    );
    for (const target of staleTargets)
      await assertManagedTargetUnchanged(target.activePath, owner);
    obsolete.push(activation);
  }
  return {
    obsoleteActivationKeys: obsolete.map(activationKey),
    obsoletePackageIds: [...new Set(obsolete.map((item) => item.packageId))],
    obsoleteTargets: [
      ...new Set(
        obsolete.flatMap((item) =>
          item.targets.map((target) => target.activePath),
        ),
      ),
    ],
    obsoleteUnits: obsolete.map((item) => ({
      packageId: item.packageId,
      agent: item.agent,
      ...(item.unitId ? { unitId: item.unitId } : {}),
    })),
  };
}

function reconciliationSignature(
  reconciliation: ManagedProfileReconciliation,
): string {
  return JSON.stringify({
    keys: [...reconciliation.obsoleteActivationKeys].sort(),
    targets: [...reconciliation.obsoleteTargets].sort(),
  });
}

async function recordManagedProfileReconciliation(
  reconciliation: ManagedProfileReconciliation,
): Promise<void> {
  if (!reconciliation.obsoleteActivationKeys.length) return;
  const obsoleteKeys = new Set(reconciliation.obsoleteActivationKeys);
  const affectedPackages = new Set(reconciliation.obsoletePackageIds);
  const state = await readInstallState();
  state.activations = (state.activations ?? []).filter(
    (record) => !obsoleteKeys.has(activationKey(record)),
  );
  state.installs = state.installs.flatMap((install) => {
    if (!affectedPackages.has(install.packageId)) return [install];
    const remaining = (state.activations ?? []).filter(
      (record) =>
        record.packageId === install.packageId &&
        record.installationState === "installed",
    );
    if (!remaining.length) return [];
    const roots = remaining.flatMap((record) =>
      record.targets.map((target) => target.activePath),
    );
    return [
      {
        ...install,
        targetAgents: [...new Set(remaining.map((record) => record.agent))],
        files: install.files.filter((file) =>
          roots.some((root) => isInside(root, file.path)),
        ),
      },
    ];
  });
  await writeInstallState(state);
}

async function assertExactDirectoryCopy(
  source: string,
  target: string,
  label: string,
): Promise<void> {
  const [expected, actual] = await Promise.all([
    hashDirectory(source).then((files) => relativeHashes(source, files)),
    hashDirectory(target).then((files) => relativeHashes(target, files)),
  ]);
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${label} for ${target}`);
}

async function assertActiveTargetsUnoccupied(
  plans: InstallPlan[],
  options: { allowManagedReplacement?: boolean } = {},
): Promise<void> {
  const occupied: string[] = [];
  for (const target of [
    ...new Set(plans.flatMap((plan) => plan.files.map((file) => file.target))),
  ])
    if ((await inspectTargetOccupancy(target)).occupied) occupied.push(target);
  if (occupied.length && options.allowManagedReplacement) {
    const state = await readInstallState();
    const allowed = new Map<string, (typeof state.installs)[number]>();
    for (const plan of plans) {
      const install = state.installs.find(
        (record) => record.packageId === plan.packageId,
      );
      const packageActivations = (state.activations ?? []).filter(
        (record) => record.packageId === plan.packageId,
      );
      if (!install) continue;
      const activeTargets = new Set(
        packageActivations
          .filter(
            (record) =>
              record.installationState === "installed" &&
              record.activationState === "active",
          )
          .flatMap((record) =>
            record.targets.map((target) => target.activePath),
          ),
      );
      const recorded = install.files
        .filter((file) => basename(file.path) === "SKILL.md")
        .map((file) => dirname(file.path))
        .filter(
          (target) =>
            packageActivations.length === 0 || activeTargets.has(target),
        );
      const legacy = packageActivations.length
        ? []
        : plan.files
            .map((file) => file.target)
            .filter((target) => basename(target) === plan.packageId);
      for (const target of [...recorded, ...legacy])
        if (plan.files.some((file) => file.target === target))
          allowed.set(target, install);
    }
    if (occupied.every((target) => allowed.has(target))) {
      for (const target of occupied) {
        const owner = allowed.get(target);
        await assertManagedTargetUnchanged(target, owner);
      }
      return;
    }
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
  options: Parameters<typeof planAdapterSkillInstall>[3] = {},
): Promise<InstallPlan> {
  if (!existsSync(source))
    throw new Error(`Package source does not exist: ${source}`);
  const sourceStat = await lstat(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error(`Package source must be a real directory: ${source}`);
  }
  const plans = await Promise.all(
    agents.map((agent) =>
      planAdapterSkillInstall(source, packageId, agent, options),
    ),
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
  metadata?: InstallMetadata,
  options: {
    allowManagedReplacement?: boolean;
    replaceManagedTargets?: boolean;
    validateCurrentState?: () => Promise<void>;
    verifyBeforeCommit?: (snapshotId: string) => Promise<void>;
  } = {},
): Promise<string> {
  const blocking = (plan.conflicts ?? []).filter(
    (conflict) => conflict.severity === "blocking",
  );
  if (blocking.length > 0)
    throw new Error(
      `Installation blocked by conflicts: ${blocking.map((conflict) => conflict.message).join("; ")}`,
    );
  const applied = await runMutationTransaction(
    async () => {
      await options.validateCurrentState?.();
      await assertActiveTargetsUnoccupied([plan], options);
      return {
        targets: [...plan.files.map((file) => file.target), installStatePath()],
        value: plan,
      };
    },
    async (freshPlan, snapshot) => {
      // Close the preview/apply race: an empty target may have become occupied
      // after the first check but before the transaction snapshot completed.
      await assertActiveTargetsUnoccupied([freshPlan], options);
      if (options.replaceManagedTargets)
        for (const target of [
          ...new Set(freshPlan.files.map((file) => file.target)),
        ])
          await rm(target, { recursive: true, force: true });
      await applySkillPlan(freshPlan);
      if (options.replaceManagedTargets)
        for (const file of freshPlan.files) {
          await assertExactDirectoryCopy(
            file.source,
            file.target,
            "Exact update copy verification failed",
          );
        }
      await recordInstall(freshPlan, snapshot.id, metadata);
      await options.verifyBeforeCommit?.(snapshot.id);
    },
    { label: `install ${plan.packageId}` },
  );
  return applied.snapshotId;
}

export interface InstallBatchEntry {
  plan: InstallPlan;
  metadata?: InstallMetadata;
}

/** Apply all selected packages as one filesystem transaction and one state update. */
export async function applySkillInstallBatch(
  entries: InstallBatchEntry[],
  extraSnapshotPaths: string[] = [],
  options: {
    replaceManagedTargets?: boolean;
    reconcileManagedTargets?: boolean;
    expectedReconciliation?: ManagedProfileReconciliation;
    afterRecord?: () => Promise<void>;
  } = {},
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
  const applied = await runMutationTransaction(
    async () => {
      const reconciliation = options.reconcileManagedTargets
        ? await planManagedProfileReconciliation(entries)
        : {
            obsoleteActivationKeys: [],
            obsoletePackageIds: [],
            obsoleteTargets: [],
            obsoleteUnits: [],
          };
      if (
        options.expectedReconciliation &&
        reconciliationSignature(reconciliation) !==
          reconciliationSignature(options.expectedReconciliation)
      )
        throw new Error(
          "Profile reconciliation refused because managed state changed after preview; prepare the plan again.",
        );
      await assertActiveTargetsUnoccupied(
        entries.map((entry) => entry.plan),
        { allowManagedReplacement: options.replaceManagedTargets },
      );
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
      return {
        targets: [
          ...entries.flatMap((entry) =>
            entry.plan.files.map((file) => file.target),
          ),
          installStatePath(),
          ...extraSnapshotPaths,
          ...reconciliation.obsoleteTargets,
        ],
        value: { entries, reconciliation },
      };
    },
    async ({ entries: freshEntries, reconciliation }, snapshot) => {
      // Re-check immediately before any removal or copy for the same reason as
      // the single-package path above.
      await assertActiveTargetsUnoccupied(
        freshEntries.map((entry) => entry.plan),
        { allowManagedReplacement: options.replaceManagedTargets },
      );
      for (const target of reconciliation.obsoleteTargets)
        await rm(target, { recursive: true, force: true });
      if (options.replaceManagedTargets)
        for (const target of [
          ...new Set(
            freshEntries.flatMap((entry) =>
              entry.plan.files.map((file) => file.target),
            ),
          ),
        ])
          await rm(target, { recursive: true, force: true });
      for (const entry of freshEntries) await applySkillPlan(entry.plan);
      if (options.replaceManagedTargets)
        for (const entry of freshEntries)
          for (const file of entry.plan.files)
            await assertExactDirectoryCopy(
              file.source,
              file.target,
              "Exact setup copy verification failed",
            );
      await recordInstallBatch(freshEntries, snapshot.id);
      await recordManagedProfileReconciliation(reconciliation);
      await options.afterRecord?.();
    },
    { label: `install ${entries.length} skill repositories` },
  );
  return applied.snapshotId;
}

/**
 * Download a batch into the reviewed library without exposing any skill to an
 * agent yet. This is the safe destination for Maximum Library.
 */
export async function applySkillLibraryBatch(
  entries: InstallBatchEntry[],
  options: { afterRecord?: () => Promise<void> } = {},
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
  const libraryPaths = [
    ...new Set(
      entries.flatMap((entry) =>
        entry.plan.targetAgents.map((agent) =>
          activationLibraryPath(entry.plan.packageId, agent),
        ),
      ),
    ),
  ];
  const applied = await runMutationTransaction(
    async () => {
      const state = await readInstallState();
      const selected = new Set(entries.map((entry) => entry.plan.packageId));
      const active = (state.activations ?? []).filter(
        (record) =>
          selected.has(record.packageId) &&
          record.installationState === "installed" &&
          record.activationState === "active",
      );
      for (const activation of active) {
        const current = state.installs.find(
          (record) => record.packageId === activation.packageId,
        );
        const incoming = entries.find(
          (entry) => entry.plan.packageId === activation.packageId,
        );
        if (
          !current?.resolvedCommit ||
          !incoming?.metadata?.resolvedCommit ||
          current.resolvedCommit.toLowerCase() !==
            incoming.metadata.resolvedCommit.toLowerCase()
        )
          throw new Error(
            `Maximum Library cannot preserve active '${activation.packageId}/${activation.unitId ?? "skill"}' because its reviewed revision differs or is unknown. Update or disable it explicitly first.`,
          );
        const incomingActiveTargets = new Set(
          incoming.plan.files
            .filter(
              (file) =>
                (file.targetAgent === activation.agent ||
                  (!file.targetAgent &&
                    incoming.plan.targetAgents.length === 1)) &&
                basename(file.target) === activation.unitId,
            )
            .map((file) => file.target),
        );
        const includesActiveUnit =
          activation.targets.length > 0 &&
          activation.targets.every((target) =>
            incomingActiveTargets.has(target.activePath),
          );
        if (!includesActiveUnit)
          throw new Error(
            `Maximum Library cannot preserve active '${activation.packageId}/${activation.unitId ?? "skill"}' because that unit is absent from the prepared library.`,
          );
      }
      return {
        targets: [...libraryPaths, installStatePath()],
        value: entries,
      };
    },
    async (freshEntries, snapshot) => {
      for (const path of libraryPaths)
        await rm(path, { recursive: true, force: true });
      for (const entry of freshEntries) {
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
      await recordLibraryInstallBatch(freshEntries, snapshot.id);
      await options.afterRecord?.();
    },
    { label: `download ${entries.length} repositories to Maximum library` },
  );
  return applied.snapshotId;
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
