import { describe, expect, it } from "vitest";
import type { CatalogPackage, InstallState } from "../src/shared/types.js";
import { evaluateInstalledProfileState } from "../src/core/profile-state.js";

const pkg = (id: string, commit: string): CatalogPackage => ({
  id,
  displayName: id,
  repository: `owner/${id}`,
  description: id,
  category: "workflow",
  tier: "stable",
  components: ["skill"],
  operatingSystems: ["macos", "linux", "windows"],
  license: "MIT",
  source: {
    type: "github",
    url: `https://github.com/owner/${id}`,
    defaultBranch: "main",
    commit,
    evidencePaths: ["SKILL.md"],
    verifiedAt: "2026-07-18T00:00:00Z",
  },
});

describe("saved loadout profile evaluation", () => {
  it("reports missing packages and reviewed revision changes", () => {
    const oldCommit = "a".repeat(40);
    const newCommit = "b".repeat(40);
    const state: InstallState = {
      version: 1,
      installs: [
        {
          packageId: "one",
          repository: "owner/one",
          resolvedCommit: oldCommit,
          targetAgents: ["codex"],
          files: [],
          snapshotId: "snapshot",
          installedAt: "2026-07-18T00:00:00Z",
        },
      ],
      profile: {
        mode: "custom",
        packageIds: ["one", "two"],
        agents: ["codex"],
        catalogPackages: [{ packageId: "one", reviewedCommit: oldCommit }],
        appliedAt: "2026-07-18T00:00:00Z",
      },
    };
    const status = evaluateInstalledProfileState(state, [
      pkg("one", newCommit),
      pkg("two", newCommit),
    ]);
    expect(status.missingPackages).toEqual(["two"]);
    expect(status.reviewedRevisionChanges).toEqual([
      {
        packageId: "one",
        previousReviewedCommit: oldCommit,
        reviewedCommit: newCommit,
      },
    ]);
    expect(status.needsRefresh).toBe(true);
    expect(status.boundary).toMatch(/discovered candidates.*review/i);
  });

  it("does not mistake an explicitly screened package update for catalog drift", () => {
    const reviewed = "a".repeat(40);
    const upstream = "c".repeat(40);
    const state: InstallState = {
      version: 1,
      installs: [
        {
          packageId: "one",
          repository: "owner/one",
          resolvedCommit: upstream,
          targetAgents: ["codex"],
          files: [],
          snapshotId: "snapshot",
          installedAt: "2026-07-18T00:00:00Z",
        },
      ],
      profile: {
        mode: "custom",
        packageIds: ["one"],
        agents: ["codex"],
        catalogPackages: [{ packageId: "one", reviewedCommit: reviewed }],
        appliedAt: "2026-07-18T00:00:00Z",
      },
    };
    expect(
      evaluateInstalledProfileState(state, [pkg("one", reviewed)]),
    ).toMatchObject({ needsRefresh: false, reviewedRevisionChanges: [] });
  });
});
