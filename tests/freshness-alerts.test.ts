import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildFreshnessAlerts,
  ignoreFreshnessAlert,
  pinReplacement,
  readReplacementPins,
  unpinReplacement,
} from "../src/core/freshness-alerts.js";
import type { CatalogPackage, InstallState } from "../src/shared/types.js";

describe("freshness and replacement alerts", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("uses disclosed evidence and persists exact local ignores", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-alerts-"));
    process.env.LOADOUT_HOME = root;
    const oldCommit = "a".repeat(40);
    const reviewedCommit = "b".repeat(40);
    const state: InstallState = {
      version: 1,
      installs: [
        {
          packageId: "archived",
          repository: "owner/archived",
          resolvedCommit: oldCommit,
          targetAgents: ["codex"],
          files: [],
          snapshotId: "snapshot",
          installedAt: "2025-01-01T00:00:00Z",
        },
        {
          packageId: "stale",
          repository: "owner/stale",
          resolvedCommit: oldCommit,
          targetAgents: ["codex"],
          files: [],
          snapshotId: "snapshot",
          installedAt: "2025-01-01T00:00:00Z",
        },
      ],
      mcpInstalls: [],
      activations: [],
    };
    const item = (
      id: string,
      extra: Partial<CatalogPackage>,
    ): CatalogPackage => ({
      id,
      displayName: id,
      repository: `owner/${id}`,
      description: id,
      category: "skills",
      tier: "stable",
      source: {
        type: "github",
        url: `https://github.com/owner/${id}`,
        defaultBranch: "main",
        commit: reviewedCommit,
        evidencePaths: ["SKILL.md"],
        verifiedAt: "2026-07-15T00:00:00Z",
      },
      ...extra,
    });
    const alerts = await buildFreshnessAlerts({
      state,
      catalog: [
        item("archived", { archived: true }),
        item("stale", { pushedAt: "2024-01-01T00:00:00Z" }),
      ],
      updates: [
        {
          packageId: "stale",
          repository: "owner/stale",
          installedCommit: oldCommit,
          availableCommit: reviewedCommit,
          targetAgents: ["codex"],
          status: "update-available",
          action: "review",
          approvalRequired: true,
          safetyFindings: [
            {
              category: "script",
              severity: "warning",
              message: "new script",
              paths: ["scripts/install.sh"],
            },
          ],
        },
      ],
      now: new Date("2026-07-15T00:00:00Z"),
    });
    expect(alerts.map((alert) => alert.kind)).toEqual(
      expect.arrayContaining([
        "archived",
        "materially-stale",
        "reviewed-commit-changed",
        "permission-expansion",
      ]),
    );
    expect(alerts.every((alert) => alert.evidence.length > 0)).toBe(true);
    await ignoreFreshnessAlert(alerts[0].id);
    const ignored = await buildFreshnessAlerts({
      state,
      catalog: [
        item("archived", { archived: true }),
        item("stale", { pushedAt: "2024-01-01T00:00:00Z" }),
      ],
      updates: [],
      now: new Date("2026-07-15T00:00:00Z"),
    });
    expect(ignored.find((alert) => alert.id === alerts[0].id)?.ignored).toBe(
      true,
    );
  });

  it("shows only evidence-backed replacements and persists explicit local pins", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-alert-pins-"));
    process.env.LOADOUT_HOME = root;
    const state: InstallState = {
      version: 1,
      installs: [
        {
          packageId: "old",
          targetAgents: ["codex"],
          files: [],
          snapshotId: "snapshot",
          installedAt: "2026-01-01T00:00:00Z",
        },
      ],
      mcpInstalls: [],
      activations: [],
    };
    const catalog = ["old", "new"].map((id) => ({
      id,
      displayName: id,
      repository: `owner/${id}`,
      description: id,
      category: "review",
      tier: "stable" as const,
    }));
    const alerts = await buildFreshnessAlerts({
      state,
      catalog,
      replacementEvidence: [
        {
          installedPackageId: "old",
          replacementPackageId: "new",
          scoreDelta: 4.2,
          evidenceId: "signed-fixture",
        },
      ],
    });
    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "outperformed", packageId: "old" }),
      ]),
    );
    await pinReplacement("old", "new");
    await pinReplacement("old", "newer");
    expect(await readReplacementPins()).toEqual([
      expect.objectContaining({
        packageId: "old",
        replacementPackageId: "newer",
      }),
    ]);
    await expect(unpinReplacement("old")).resolves.toBe(true);
  });
});
