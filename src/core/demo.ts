import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { AgentId, DetectedAgent } from "../shared/types.js";
import type { CatalogPackage } from "../shared/types.js";
import { buildSkillPlan, applySkillInstall } from "./install.js";
import { loadEffectiveCatalog } from "./catalog.js";
import { agentSkillsDirectory } from "./paths.js";
import { fetchRepositorySnapshot } from "./source.js";
import { readInstallState } from "./state.js";
import { restoreSnapshot } from "./snapshot.js";

const DEFAULT_REPOSITORY = "obra/superpowers";
const DEFAULT_PACKAGE_ID = "obra-superpowers";

export interface DemoOptions {
  /** A public GitHub repository. The default is a verified catalog package. */
  repository?: string;
  /** Only intended for deterministic automated tests and local development. */
  source?: string;
  /** Only intended for deterministic automated tests. */
  catalog?: CatalogPackage[];
  /** Only intended for deterministic automated tests. */
  fetchSnapshot?: typeof fetchRepositorySnapshot;
  packageId?: string;
  agents?: AgentId[];
  /** Preserve the isolated profile after a successful install for inspection. */
  keep?: boolean;
}

export interface DemoResult {
  profile: string;
  loadoutHome: string;
  packageId: string;
  repository: string;
  resolvedCommit?: string;
  reviewed: boolean;
  targetAgents: AgentId[];
  plannedFiles: number;
  installedFiles: number;
  snapshotId: string;
  rolledBack: boolean;
  cleanedUp: boolean;
}

function isWithin(root: string, path: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  return (
    resolvedPath === resolvedRoot ||
    resolvedPath.startsWith(`${resolvedRoot}${sep}`)
  );
}

/**
 * Run a real install and rollback inside a disposable profile. This function
 * deliberately creates virtual agent targets instead of detecting local
 * binaries: the demo proves the installer while never treating a user's real
 * Codex, Claude, or other agent profile as a demo target.
 */
export async function runIsolatedDemo(
  options: DemoOptions = {},
): Promise<DemoResult> {
  if (options.source && options.repository)
    throw new Error(
      "Demo accepts either a local source or a repository, not both",
    );
  const profile = await mkdtemp(join(tmpdir(), "loadout-demo-"));
  const demoLoadoutHome = join(profile, ".loadout");
  const packageId = options.packageId ?? DEFAULT_PACKAGE_ID;
  const agentIds: AgentId[] = options.agents?.length
    ? options.agents
    : ["codex"];
  const previousUserHome = process.env.LOADOUT_USER_HOME;
  const previousLoadoutHome = process.env.LOADOUT_HOME;
  let completed = false;

  process.env.LOADOUT_USER_HOME = profile;
  process.env.LOADOUT_HOME = demoLoadoutHome;
  try {
    const requestedRepository = options.repository ?? DEFAULT_REPOSITORY;
    const catalog = options.source
      ? []
      : (options.catalog ?? (await loadEffectiveCatalog()));
    const reviewedPackage = catalog.find(
      (pkg) =>
        pkg.repository.toLowerCase() === requestedRepository.toLowerCase() &&
        Boolean(pkg.source?.commit),
    );
    if (!options.source && !options.repository && !reviewedPackage)
      throw new Error(
        `The default demo repository ${DEFAULT_REPOSITORY} is missing its reviewed catalog commit`,
      );
    const fetched = options.source
      ? undefined
      : await (options.fetchSnapshot ?? fetchRepositorySnapshot)(
          requestedRepository,
          reviewedPackage?.source?.commit
            ? { ref: reviewedPackage.source.commit }
            : undefined,
        );
    if (
      reviewedPackage?.source?.commit &&
      fetched!.commit.toLowerCase() !==
        reviewedPackage.source.commit.toLowerCase()
    )
      throw new Error(
        `Demo resolved ${fetched!.commit}, expected reviewed commit ${reviewedPackage.source.commit}`,
      );
    const source = options.source ?? fetched!.path;
    const repository =
      fetched?.repository ?? `local source: ${resolve(source)}`;
    const targets: DetectedAgent[] = agentIds.map((id) => ({
      id,
      displayName: `${id} (isolated demo target)`,
      installed: true,
      skillsDirectory: agentSkillsDirectory(id, profile),
    }));

    const plan = await buildSkillPlan(source, packageId, targets);
    if (plan.files.some((file) => !isWithin(profile, file.target))) {
      throw new Error(
        "Demo safety check failed: a planned target escaped the isolated profile",
      );
    }
    const snapshotId = await applySkillInstall(
      plan,
      fetched
        ? { repository: fetched.repository, resolvedCommit: fetched.commit }
        : undefined,
    );
    const state = await readInstallState();
    const record = state.installs.find(
      (item) => item.packageId === packageId && item.snapshotId === snapshotId,
    );
    if (!record)
      throw new Error(
        "Demo safety check failed: the isolated install was not recorded",
      );
    if (record.files.some((file) => !isWithin(profile, file.path))) {
      throw new Error(
        "Demo safety check failed: managed state escaped the isolated profile",
      );
    }

    let rolledBack = false;
    if (!options.keep) {
      const snapshotPath = join(
        demoLoadoutHome,
        "snapshots",
        `${snapshotId}.json`,
      );
      const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
      await restoreSnapshot(snapshot);
      rolledBack = true;
    }
    completed = true;
    return {
      profile,
      loadoutHome: demoLoadoutHome,
      packageId,
      repository,
      resolvedCommit: fetched?.commit,
      reviewed: Boolean(reviewedPackage),
      targetAgents: agentIds,
      plannedFiles: plan.files.length,
      installedFiles: record.files.length,
      snapshotId,
      rolledBack,
      cleanedUp: !options.keep,
    };
  } finally {
    if (previousUserHome === undefined) delete process.env.LOADOUT_USER_HOME;
    else process.env.LOADOUT_USER_HOME = previousUserHome;
    if (previousLoadoutHome === undefined) delete process.env.LOADOUT_HOME;
    else process.env.LOADOUT_HOME = previousLoadoutHome;
    // The default mode has completed its rollback before removal. On an error
    // we also remove the partial profile; source repositories are never deleted.
    if (!options.keep || !completed)
      await rm(profile, { recursive: true, force: true });
  }
}

export function formatDemoResult(result: DemoResult): string {
  const source = result.resolvedCommit
    ? `${result.repository} @ ${result.resolvedCommit}`
    : result.repository;
  const ending = result.rolledBack
    ? "Rollback verified and the temporary profile was removed."
    : `Isolated profile retained at ${result.profile}. Delete it when finished.`;
  return [
    "Loadout safe demo complete.",
    `${result.reviewed ? "Reviewed source" : "Source"}: ${source}`,
    `Virtual targets: ${result.targetAgents.join(", ")}`,
    `Installed ${result.plannedFiles} planned skill directory(ies); tracking ${result.installedFiles} file(s).`,
    `Snapshot: ${result.snapshotId}`,
    ending,
  ].join("\n");
}

export const demoDefaults = {
  repository: DEFAULT_REPOSITORY,
  packageId: DEFAULT_PACKAGE_ID,
} as const;
