import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type {
  AgentId,
  InstallRecord,
  ManagedActivationRecord,
} from "../shared/types.js";
import { agentSkillsDirectory, ensureDirectory } from "./paths.js";
import {
  activationLibraryPath,
  installStatePath,
  readInstallState,
  writeInstallState,
} from "./state.js";
import { inspectTargetOccupancy } from "./target-occupancy.js";
import { runMutationTransaction } from "./transaction.js";

export type ActivationAction = "enable" | "disable";

export interface ActivationChange {
  packageId: string;
  unitId?: string;
  agent: AgentId;
  from: "active" | "disabled";
  to: "active" | "disabled";
  libraryPath: string;
  targets: Array<{ activePath: string; libraryRelativePath: string }>;
  blockers: string[];
}

export interface ActivationPlan {
  action: ActivationAction;
  packages: string[];
  requestedAgents?: AgentId[];
  changes: ActivationChange[];
  skipped: Array<{
    packageId: string;
    unitId?: string;
    agent: AgentId;
    reason: string;
  }>;
  blocked: boolean;
  warnings: string[];
}

export interface LibraryStateReport {
  generatedAt: string;
  records: ManagedActivationRecord[];
  /** Immutable source identity when a package was installed from a repository. */
  repositories: Record<string, string>;
  counts: {
    packages: number;
    downloaded: number;
    reviewed: number;
    quarantined: number;
    installed: number;
    active: number;
    disabled: number;
    removed: number;
  };
  migrationPending: number;
}

interface HashedFile {
  path: string;
  sha256: string;
}

/** Resolve a managed file to its active location or disabled library copy. */
export function managedFileReadPath(
  packageId: string,
  filePath: string,
  activations: ManagedActivationRecord[],
): string {
  const disabled = activations.find(
    (activation) =>
      activation.packageId === packageId &&
      activation.installationState === "installed" &&
      activation.activationState === "disabled" &&
      activation.targets.some((target) =>
        isInside(target.activePath, filePath),
      ),
  );
  if (!disabled) return filePath;
  const target = disabled.targets.find((item) =>
    isInside(item.activePath, filePath),
  )!;
  return join(
    disabled.libraryPath,
    target.libraryRelativePath,
    relative(target.activePath, filePath),
  );
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (!path.startsWith("..") && !path.startsWith(sep));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    )
      return false;
    throw error;
  }
}

async function hashTree(root: string): Promise<HashedFile[]> {
  const files: HashedFile[] = [];
  async function visit(path: string): Promise<void> {
    const info = await lstat(path);
    if (info.isSymbolicLink())
      throw new Error(`Refusing symlink in managed active set: ${path}`);
    if (info.isFile()) {
      files.push({
        path: relative(root, path).split(sep).join("/"),
        sha256: createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      });
      return;
    }
    if (!info.isDirectory())
      throw new Error(`Refusing unsupported managed entry: ${path}`);
    for (const entry of await readdir(path)) await visit(join(path, entry));
  }
  if (!(await pathExists(root))) return [];
  await visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function legacyTargets(record: InstallRecord, agent: AgentId): string[] {
  const root = agentSkillsDirectory(agent);
  const withinAgent = record.files
    .filter(
      (file) => isInside(root, file.path) && basename(file.path) === "SKILL.md",
    )
    .map((file) => dirname(file.path));
  if (withinAgent.length) return [...new Set(withinAgent)].sort();
  if (record.targetAgents.length === 1)
    return [
      ...new Set(
        record.files
          .filter((file) => basename(file.path) === "SKILL.md")
          .map((file) => dirname(file.path)),
      ),
    ].sort();
  return [];
}

function legacyActivations(
  installs: InstallRecord[],
  existing: ManagedActivationRecord[],
): ManagedActivationRecord[] {
  const keys = new Set(
    existing.map((entry) => `${entry.packageId}\0${entry.agent}`),
  );
  return installs.flatMap((install) =>
    install.targetAgents.flatMap((agent): ManagedActivationRecord[] => {
      if (keys.has(`${install.packageId}\0${agent}`)) return [];
      const targets = legacyTargets(install, agent);
      if (!targets.length) return [];
      return [
        {
          packageId: install.packageId,
          agent,
          cacheState: "missing",
          reviewState: "unreviewed",
          installationState: "installed",
          activationState: "active",
          libraryPath: activationLibraryPath(install.packageId, agent),
          targets: targets.map((activePath) => ({
            activePath,
            libraryRelativePath: basename(activePath),
          })),
          libraryFiles: [],
          updatedAt: install.installedAt,
        },
      ];
    }),
  );
}

function allActivationRecords(
  installs: InstallRecord[],
  existing: ManagedActivationRecord[],
): ManagedActivationRecord[] {
  return [...existing, ...legacyActivations(installs, existing)].sort(
    (left, right) =>
      left.packageId.localeCompare(right.packageId) ||
      left.agent.localeCompare(right.agent) ||
      (left.unitId ?? "").localeCompare(right.unitId ?? ""),
  );
}

function exactTreeDifferences(
  expected: HashedFile[],
  actual: HashedFile[],
): string[] {
  const expectedMap = new Map(expected.map((file) => [file.path, file.sha256]));
  const actualMap = new Map(actual.map((file) => [file.path, file.sha256]));
  const missing = [...expectedMap].filter(([path]) => !actualMap.has(path));
  const modified = [...expectedMap].filter(
    ([path, digest]) => actualMap.get(path) && actualMap.get(path) !== digest,
  );
  const extra = [...actualMap].filter(([path]) => !expectedMap.has(path));
  return [
    ...(missing.length
      ? [`${missing.length} expected file(s) are missing`]
      : []),
    ...(modified.length ? [`${modified.length} managed file(s) changed`] : []),
    ...(extra.length
      ? [`${extra.length} untracked file(s) would be affected`]
      : []),
  ];
}

function expectedActiveFiles(
  install: InstallRecord,
  targets: ActivationChange["targets"],
): HashedFile[] {
  return install.files
    .filter((file) =>
      targets.some((target) => isInside(target.activePath, file.path)),
    )
    .map((file) => ({ path: resolve(file.path), sha256: file.sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function expectedLibraryFiles(
  install: InstallRecord,
  targets: ActivationChange["targets"],
): HashedFile[] {
  return install.files
    .flatMap((file): HashedFile[] => {
      const target = targets.find((item) =>
        isInside(item.activePath, file.path),
      );
      if (!target) return [];
      return [
        {
          path: join(
            target.libraryRelativePath,
            relative(target.activePath, file.path),
          )
            .split(sep)
            .join("/"),
          sha256: file.sha256,
        },
      ];
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function activeTreeFiles(
  targets: ActivationChange["targets"],
): Promise<HashedFile[]> {
  const files = await Promise.all(
    targets.map(async (target) =>
      (await hashTree(target.activePath)).map((file) => ({
        path: resolve(target.activePath, file.path),
        sha256: file.sha256,
      })),
    ),
  );
  return files
    .flat()
    .sort((left, right) => left.path.localeCompare(right.path));
}

export async function buildLibraryStateReport(): Promise<LibraryStateReport> {
  const state = await readInstallState();
  const records = allActivationRecords(state.installs, state.activations ?? []);
  const repositories = Object.fromEntries(
    state.installs
      .filter((install) => Boolean(install.repository))
      .map((install) => [install.packageId, install.repository!]),
  );
  return {
    generatedAt: new Date().toISOString(),
    records,
    repositories,
    counts: {
      packages: new Set(records.map((record) => record.packageId)).size,
      downloaded: records.filter((record) => record.cacheState === "downloaded")
        .length,
      reviewed: records.filter((record) => record.reviewState === "reviewed")
        .length,
      quarantined: records.filter(
        (record) => record.reviewState === "quarantined",
      ).length,
      installed: records.filter(
        (record) => record.installationState === "installed",
      ).length,
      active: records.filter((record) => record.activationState === "active")
        .length,
      disabled: records.filter(
        (record) => record.activationState === "disabled",
      ).length,
      removed: records.filter(
        (record) => record.installationState === "removed",
      ).length,
    },
    migrationPending: records.filter(
      (record) =>
        record.installationState === "installed" &&
        record.cacheState === "missing",
    ).length,
  };
}

export async function planActivationChange(
  action: ActivationAction,
  packageIds: string[],
  options: { agents?: AgentId[] } = {},
): Promise<ActivationPlan> {
  const packages = [
    ...new Set(packageIds.map((id) => id.trim()).filter(Boolean)),
  ];
  if (!packages.length) throw new Error("At least one package id is required");
  const state = await readInstallState();
  const installs = new Map(
    state.installs.map((install) => [install.packageId, install]),
  );
  const selectors = packages.map((selector) => {
    const separator = selector.indexOf("/");
    return {
      selector,
      packageId: separator < 0 ? selector : selector.slice(0, separator),
      unitId: separator < 0 ? undefined : selector.slice(separator + 1),
    };
  });
  for (const selector of selectors)
    if (!installs.has(selector.packageId))
      throw new Error(
        `Package is not managed by Loadout: ${selector.packageId}`,
      );
  const records = allActivationRecords(state.installs, state.activations ?? []);
  const changes: ActivationChange[] = [];
  const skipped: ActivationPlan["skipped"] = [];
  for (const selector of selectors) {
    const { packageId, unitId } = selector;
    const candidates = records.filter(
      (record) =>
        record.packageId === packageId &&
        (!unitId || record.unitId === unitId) &&
        (!options.agents || options.agents.includes(record.agent)),
    );
    if (!candidates.length)
      throw new Error(
        `No managed skill activation for '${selector.selector}' matches the requested agents`,
      );
    for (const record of candidates) {
      const desired = action === "enable" ? "active" : "disabled";
      if (record.activationState === desired) {
        skipped.push({
          packageId,
          ...(record.unitId ? { unitId: record.unitId } : {}),
          agent: record.agent,
          reason: `already ${desired}`,
        });
        continue;
      }
      const change: ActivationChange = {
        packageId,
        ...(record.unitId ? { unitId: record.unitId } : {}),
        agent: record.agent,
        from: record.activationState,
        to: desired,
        libraryPath: record.libraryPath,
        targets: record.targets,
        blockers: [],
      };
      const install = installs.get(packageId)!;
      if (
        resolve(record.libraryPath) !==
        resolve(activationLibraryPath(packageId, record.agent, record.unitId))
      )
        change.blockers.push(
          "the library path does not match Loadout's managed path",
        );
      const validRoots = new Set(
        install.files
          .filter((file) => basename(file.path) === "SKILL.md")
          .map((file) => resolve(dirname(file.path))),
      );
      if (
        change.targets.some(
          (target) =>
            !validRoots.has(resolve(target.activePath)) ||
            target.libraryRelativePath !== basename(target.activePath) ||
            target.libraryRelativePath === "." ||
            target.libraryRelativePath === ".." ||
            /[\\/]/.test(target.libraryRelativePath),
        )
      )
        change.blockers.push(
          "one or more activation targets are not backed by the managed install record",
        );
      if (
        new Set(change.targets.map((target) => target.libraryRelativePath))
          .size !== change.targets.length
      )
        change.blockers.push(
          "activation targets collide inside the library copy",
        );
      if (record.reviewState === "quarantined")
        change.blockers.push("the reviewed library entry is quarantined");
      if (record.installationState !== "installed")
        change.blockers.push("the package has been removed");
      if (action === "disable") {
        const expected = expectedActiveFiles(install, change.targets);
        const actual = await activeTreeFiles(change.targets);
        change.blockers.push(...exactTreeDifferences(expected, actual));
      } else {
        if (record.cacheState !== "downloaded" || !record.libraryFiles.length)
          change.blockers.push(
            "no complete reviewed-library copy is available",
          );
        else {
          const libraryActual = await hashTree(record.libraryPath);
          change.blockers.push(
            ...exactTreeDifferences(record.libraryFiles, libraryActual).map(
              (message) => `library copy: ${message}`,
            ),
          );
        }
        const occupied = (
          await Promise.all(
            change.targets.map(async (target) => ({
              target,
              result: await inspectTargetOccupancy(target.activePath),
            })),
          )
        ).filter((item) => item.result.occupied);
        if (occupied.length)
          change.blockers.push(
            `${occupied.length} active target(s) already contain protected content and would be overwritten; first target: ${occupied[0].target.activePath} (${occupied[0].result.reason})`,
          );
      }
      changes.push(change);
    }
  }
  const warnings = changes.flatMap((change) =>
    change.blockers.map(
      (blocker) => `${change.packageId}/${change.agent}: ${blocker}`,
    ),
  );
  return {
    action,
    packages,
    ...(options.agents ? { requestedAgents: options.agents } : {}),
    changes,
    skipped,
    blocked: warnings.length > 0,
    warnings,
  };
}

function activationKey(
  record: Pick<ManagedActivationRecord, "packageId" | "agent" | "unitId">,
): string {
  return `${record.packageId}\0${record.agent}\0${record.unitId ?? ""}`;
}

export async function applyActivationChange(
  plan: ActivationPlan,
): Promise<string> {
  const applied = await runMutationTransaction(
    async () => {
      const fresh = await planActivationChange(plan.action, plan.packages, {
        ...(plan.requestedAgents ? { agents: plan.requestedAgents } : {}),
      });
      if (fresh.blocked) throw new Error(fresh.warnings.join("; "));
      if (!fresh.changes.length)
        throw new Error(
          `Nothing to ${plan.action}; every selected activation is already ${plan.action === "enable" ? "active" : "disabled"}`,
        );
      const state = await readInstallState();
      const records = allActivationRecords(
        state.installs,
        state.activations ?? [],
      );
      const targets = [
        ...fresh.changes.flatMap((change) =>
          change.targets.map((target) => target.activePath),
        ),
        ...(fresh.action === "disable"
          ? fresh.changes.map((change) => change.libraryPath)
          : []),
        installStatePath(),
      ];
      return { targets, value: { fresh, state, records } };
    },
    async ({ fresh, state, records }, snapshot) => {
      const replacements = new Map<string, ManagedActivationRecord>();
      const installs = new Map(
        state.installs.map((install) => [install.packageId, install]),
      );
      for (const change of fresh.changes) {
        const current = records.find(
          (record) => activationKey(record) === activationKey(change),
        )!;
        if (fresh.action === "disable") {
          await rm(change.libraryPath, { recursive: true, force: true });
          await ensureDirectory(change.libraryPath);
          for (const target of change.targets) {
            const destination = join(
              change.libraryPath,
              target.libraryRelativePath,
            );
            await mkdir(dirname(destination), { recursive: true });
            await cp(target.activePath, destination, {
              recursive: true,
              errorOnExist: true,
              force: false,
            });
          }
          const libraryFiles = await hashTree(change.libraryPath);
          const copyDifferences = exactTreeDifferences(
            expectedLibraryFiles(
              installs.get(change.packageId)!,
              change.targets,
            ),
            libraryFiles,
          );
          if (copyDifferences.length)
            throw new Error(
              `${change.packageId}/${change.agent}: copied library verification failed: ${copyDifferences.join("; ")}`,
            );
          for (const target of change.targets)
            await rm(target.activePath, { recursive: true, force: true });
          replacements.set(activationKey(change), {
            ...current,
            cacheState: "downloaded",
            activationState: "disabled",
            libraryFiles,
            updatedAt: new Date().toISOString(),
            snapshotId: snapshot.id,
          });
        } else {
          for (const target of change.targets) {
            const source = join(change.libraryPath, target.libraryRelativePath);
            const occupancy = await inspectTargetOccupancy(target.activePath);
            if (occupancy.occupied)
              throw new Error(
                `${change.packageId}/${change.agent}: activation target became occupied: ${target.activePath} (${occupancy.reason})`,
              );
            await rm(target.activePath, { recursive: true, force: true });
            await mkdir(dirname(target.activePath), { recursive: true });
            await cp(source, target.activePath, {
              recursive: true,
              errorOnExist: true,
              force: false,
            });
          }
          const activeFiles = await activeTreeFiles(change.targets);
          const copyDifferences = exactTreeDifferences(
            expectedActiveFiles(
              installs.get(change.packageId)!,
              change.targets,
            ),
            activeFiles,
          );
          if (copyDifferences.length)
            throw new Error(
              `${change.packageId}/${change.agent}: activated copy verification failed: ${copyDifferences.join("; ")}`,
            );
          replacements.set(activationKey(change), {
            ...current,
            activationState: "active",
            updatedAt: new Date().toISOString(),
            snapshotId: snapshot.id,
          });
        }
      }
      state.activations = records.map(
        (record) => replacements.get(activationKey(record)) ?? record,
      );
      await writeInstallState(state);
    },
  );
  return applied.snapshotId;
}

function formatLibraryHeadline(report: LibraryStateReport): string {
  return `Managed library: ${report.counts.packages} package(s), ${report.counts.active} active, ${report.counts.disabled} disabled, ${report.counts.downloaded} cached`;
}

function countByAgent(
  report: LibraryStateReport,
  activationState: "active" | "disabled",
): string {
  const counts = new Map<string, number>();
  for (const record of report.records)
    if (record.activationState === activationState)
      counts.set(record.agent, (counts.get(record.agent) ?? 0) + 1);
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([agent, count]) => `${agent} ${count}`)
    .join(", ");
}

/** Concise default for people with a broad Maximum library. */
export function formatLibrarySummary(report: LibraryStateReport): string {
  if (!report.records.length)
    return "No Loadout-managed skill activations exist.";
  return [
    formatLibraryHeadline(report),
    `Active now: ${countByAgent(report, "active") || "none"}`,
    `Disabled library: ${countByAgent(report, "disabled") || "none"}`,
    "Disabled library skills are reviewed copies, not extra agent context.",
    ...(report.migrationPending
      ? [
          `Migration pending: ${report.migrationPending} active installation(s) will be cached on first disable.`,
        ]
      : []),
    "Use `loadout library --all` for every skill, source package, and activation state.",
  ].join("\n");
}

/** Full per-skill provenance report for audits and explicit investigation. */
export function formatLibraryStateReport(report: LibraryStateReport): string {
  if (!report.records.length)
    return "No Loadout-managed skill activations exist.";
  return [
    formatLibraryHeadline(report),
    ...(report.migrationPending
      ? [
          `Migration pending: ${report.migrationPending} active installation(s) will be cached on first disable.`,
        ]
      : []),
    ...report.records.map(
      (record) =>
        `${record.packageId}${record.unitId ? `/${record.unitId}` : ""}${report.repositories[record.packageId] ? ` (${report.repositories[record.packageId]})` : ""} — ${record.agent} — cache:${record.cacheState} review:${record.reviewState} install:${record.installationState} activation:${record.activationState} — ${record.targets.length} target(s)`,
    ),
  ].join("\n");
}

export function formatActivationPlan(plan: ActivationPlan): string {
  return [
    `${plan.action === "enable" ? "Enable" : "Disable"} plan: ${plan.changes.length} change(s), ${plan.skipped.length} already in desired state`,
    ...plan.changes.map(
      (change) =>
        `${change.packageId}${change.unitId ? `/${change.unitId}` : ""}/${change.agent}: ${change.from} -> ${change.to} (${change.targets.length} target(s))${change.blockers.length ? ` BLOCKED: ${change.blockers.join("; ")}` : ""}`,
    ),
    ...plan.skipped.map(
      (item) =>
        `${item.packageId}${item.unitId ? `/${item.unitId}` : ""}/${item.agent}: skipped (${item.reason})`,
    ),
    ...(plan.blocked
      ? ["No changes can be applied until every blocker is resolved."]
      : []),
  ].join("\n");
}
