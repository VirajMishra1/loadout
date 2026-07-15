import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyProjectActivation,
  planProjectActivation,
} from "../src/core/active-policy.js";
import { activationLibraryPath, writeInstallState } from "../src/core/state.js";
import type { ManagedActivationRecord } from "../src/shared/types.js";

describe("project-aware active-set policy", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("scores reviewed skill units and activates the selected set", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-active-policy-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const project = join(root, "project");
    const activeRoot = join(root, "codex-skills");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, "requirements.txt"), "pytest\n");
    const content =
      "---\nname: managed\ndescription: Managed test skill\n---\n";
    const digest = createHash("sha256").update(content).digest("hex");
    const units = [
      "systematic-debugging",
      "python-testing-patterns",
      "apple-appstore-reviewer",
    ];
    const activations: ManagedActivationRecord[] = [];
    const files: Array<{ path: string; sha256: string }> = [];
    for (const unitId of units) {
      const libraryPath = activationLibraryPath("collection", "codex", unitId);
      await mkdir(join(libraryPath, unitId), { recursive: true });
      await writeFile(join(libraryPath, unitId, "SKILL.md"), content);
      const activePath = join(activeRoot, unitId);
      files.push({ path: join(activePath, "SKILL.md"), sha256: digest });
      activations.push({
        packageId: "collection",
        unitId,
        agent: "codex",
        cacheState: "downloaded",
        reviewState: "reviewed",
        installationState: "installed",
        activationState: "disabled",
        libraryPath,
        targets: [{ activePath, libraryRelativePath: unitId }],
        libraryFiles: [{ path: `${unitId}/SKILL.md`, sha256: digest }],
        updatedAt: "2026-07-15T00:00:00Z",
      });
    }
    await writeInstallState({
      version: 1,
      installs: [
        {
          packageId: "collection",
          targetAgents: ["codex"],
          files,
          snapshotId: "library",
          installedAt: "2026-07-15T00:00:00Z",
        },
      ],
      mcpInstalls: [],
      activations,
    });

    const preview = await planProjectActivation(project, {
      agents: ["codex"],
      limit: 1,
    });
    expect(preview.project.languages).toContain("python");
    expect(preview.selected.map((item) => item.unitId)).toEqual([
      "systematic-debugging",
    ]);

    const plan = await planProjectActivation(project, {
      agents: ["codex"],
      limit: 2,
    });
    expect(plan.selected).toHaveLength(2);
    expect(plan.selected.map((item) => item.unitId)).not.toContain(
      "apple-appstore-reviewer",
    );
    const snapshot = await applyProjectActivation(plan);
    expect(snapshot).toBeTruthy();
    expect(
      await readFile(
        join(activeRoot, "python-testing-patterns", "SKILL.md"),
        "utf8",
      ),
    ).toBe(content);
  });
});
