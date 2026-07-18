import type {
  CatalogPackage,
  InstalledLoadoutProfile,
  InstallState,
} from "../shared/types.js";
import type { PreparedCatalogInstall } from "./catalog-install.js";
import { resolveCatalogProfile } from "./profiles.js";
import { readInstallState, writeInstallState } from "./state.js";

export interface InstalledProfileStatus {
  installed: boolean;
  mode?: InstalledLoadoutProfile["mode"];
  appliedAt?: string;
  expectedPackages: string[];
  missingPackages: string[];
  reviewedRevisionChanges: Array<{
    packageId: string;
    previousReviewedCommit?: string;
    reviewedCommit?: string;
  }>;
  needsRefresh: boolean;
  evaluatedAt: string;
  boundary: string;
}

export async function recordInstalledProfile(
  prepared: PreparedCatalogInstall,
): Promise<InstalledLoadoutProfile> {
  const profile: InstalledLoadoutProfile = {
    mode: prepared.selection.mode,
    ...(prepared.selection.packageIds
      ? { packageIds: [...prepared.selection.packageIds] }
      : {}),
    agents: prepared.agents.map((agent) => agent.id),
    catalogPackages: prepared.resolution.packages
      .filter((pkg) => pkg.components?.includes("skill"))
      .map((pkg) => ({
        packageId: pkg.id,
        ...(pkg.source?.commit ? { reviewedCommit: pkg.source.commit } : {}),
      })),
    appliedAt: new Date().toISOString(),
  };
  const state = await readInstallState();
  await writeInstallState({ ...state, profile });
  return profile;
}

export function evaluateInstalledProfileState(
  state: InstallState,
  catalog: CatalogPackage[],
): InstalledProfileStatus {
  const evaluatedAt = new Date().toISOString();
  const boundary =
    "Checks the current signed/reviewed catalog. Newly discovered candidates stay recommendations until review evidence promotes them.";
  if (!state.profile)
    return {
      installed: false,
      expectedPackages: [],
      missingPackages: [],
      reviewedRevisionChanges: [],
      needsRefresh: false,
      evaluatedAt,
      boundary,
    };
  const resolution = resolveCatalogProfile(catalog, {
    mode: state.profile.mode,
    ...(state.profile.packageIds
      ? { packageIds: state.profile.packageIds }
      : {}),
  });
  const expected = resolution.packages.filter((pkg) =>
    pkg.components?.includes("skill"),
  );
  const installed = new Map(
    state.installs.map((record) => [record.packageId, record]),
  );
  const previousCatalog = new Map(
    state.profile.catalogPackages.map((record) => [record.packageId, record]),
  );
  const missingPackages = expected
    .filter((pkg) => !installed.has(pkg.id))
    .map((pkg) => pkg.id);
  const reviewedRevisionChanges = expected.flatMap((pkg) => {
    const previous = previousCatalog.get(pkg.id);
    if (
      !previous ||
      !pkg.source?.commit ||
      previous.reviewedCommit?.toLowerCase() === pkg.source.commit.toLowerCase()
    )
      return [];
    return [
      {
        packageId: pkg.id,
        previousReviewedCommit: previous.reviewedCommit,
        reviewedCommit: pkg.source.commit,
      },
    ];
  });
  const oldIds = state.profile.catalogPackages
    .map((item) => item.packageId)
    .sort();
  const expectedPackages = expected.map((pkg) => pkg.id).sort();
  const selectionChanged = oldIds.join("\0") !== expectedPackages.join("\0");
  return {
    installed: true,
    mode: state.profile.mode,
    appliedAt: state.profile.appliedAt,
    expectedPackages,
    missingPackages,
    reviewedRevisionChanges,
    needsRefresh:
      selectionChanged ||
      missingPackages.length > 0 ||
      reviewedRevisionChanges.length > 0,
    evaluatedAt,
    boundary,
  };
}

export async function evaluateInstalledProfile(
  catalog: CatalogPackage[],
): Promise<InstalledProfileStatus> {
  return evaluateInstalledProfileState(await readInstallState(), catalog);
}

export function formatInstalledProfileStatus(
  status: InstalledProfileStatus,
): string {
  if (!status.installed)
    return "PROFILE No saved Stable, Power, Maximum, or Custom profile yet.";
  return [
    `PROFILE ${status.mode?.toUpperCase()}: ${status.needsRefresh ? "reviewed changes available" : "current against reviewed catalog"}`,
    `Expected repositories: ${status.expectedPackages.length}`,
    ...(status.missingPackages.length
      ? [`Missing: ${status.missingPackages.join(", ")}`]
      : []),
    ...(status.reviewedRevisionChanges.length
      ? [
          `Reviewed revisions changed: ${status.reviewedRevisionChanges
            .map((item) => item.packageId)
            .join(", ")}`,
        ]
      : []),
    `Trust boundary: ${status.boundary}`,
  ].join("\n");
}
