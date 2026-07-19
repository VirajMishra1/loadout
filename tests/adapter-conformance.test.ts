import { afterEach, describe, expect, it } from "vitest";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ADAPTER_CAPABILITIES,
  planAdapterSkillInstall,
} from "../src/core/adapters.js";
import {
  buildAdapterConformanceMatrix,
  markFilesystemConformanceVerified,
  platformEvidenceFromCiWorkflow,
} from "../src/core/conformance.js";
import {
  applyActivationChange,
  planActivationChange,
} from "../src/core/active-set.js";
import { inspectAgent } from "../src/core/agent-inspection.js";
import { applySkillInstall } from "../src/core/install.js";
import { agentSkillsDirectory } from "../src/core/paths.js";
import { readSnapshot, restoreSnapshot } from "../src/core/snapshot.js";
import { readInstallState } from "../src/core/state.js";
import type { ComponentType, DetectedAgent } from "../src/shared/types.js";

const originalLoadoutHome = process.env.LOADOUT_HOME;
const originalUserHome = process.env.LOADOUT_USER_HOME;
const componentTypes: ComponentType[] = [
  "skill",
  "rule",
  "command",
  "agent",
  "mcp",
  "plugin",
  "root",
];

describe("adapter filesystem conformance evidence", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
    if (originalLoadoutHome === undefined) delete process.env.LOADOUT_HOME;
    else process.env.LOADOUT_HOME = originalLoadoutHome;
    if (originalUserHome === undefined) delete process.env.LOADOUT_USER_HOME;
    else process.env.LOADOUT_USER_HOME = originalUserHome;
  });

  it.each(ADAPTER_CAPABILITIES)(
    "proves the disposable skill lifecycle for $displayName",
    async (adapter) => {
      root = await mkdtemp(
        join(tmpdir(), `loadout-conformance-${adapter.agent}-`),
      );
      const home = join(root, "user-home");
      const source = join(root, "source");
      const packageId = `conformance-${adapter.agent}`;
      process.env.LOADOUT_USER_HOME = home;
      process.env.LOADOUT_HOME = join(root, "loadout-state");
      await mkdir(source, { recursive: true });
      await writeFile(
        join(source, "SKILL.md"),
        `---\nname: ${packageId}\ndescription: Disposable adapter conformance fixture\n---\n\nDo not execute this fixture.\n`,
      );
      const agent: DetectedAgent = {
        id: adapter.agent,
        displayName: adapter.displayName,
        installed: true,
        skillsDirectory: agentSkillsDirectory(adapter.agent, home),
      };

      const initial = buildAdapterConformanceMatrix([agent], []);
      expect(initial).toContainEqual(
        expect.objectContaining({
          agent: adapter.agent,
          pathKnown: true,
          filesystemVerified: false,
          nativeApplicationVerified: false,
        }),
      );

      const plan = await planAdapterSkillInstall(source, packageId, agent);
      const snapshotId = await applySkillInstall(plan);
      const installed = join(agent.skillsDirectory, packageId, "SKILL.md");
      expect(await readFile(installed, "utf8")).toContain(packageId);

      const inventory = await inspectAgent(agent);
      expect(
        inventory.components.find((component) => component.type === "skill"),
      ).toMatchObject({
        compatibility: "native",
        scanned: true,
        directoryExists: true,
      });
      for (const type of componentTypes) {
        if (adapter.components[type] !== "unsupported") continue;
        expect(
          inventory.components.find((component) => component.type === type),
        ).toMatchObject({
          compatibility: "unsupported",
          scanned: false,
          note: expect.stringMatching(
            /unsupported.*will not install or inspect/i,
          ),
        });
      }

      const disable = await planActivationChange("disable", [packageId]);
      expect(disable.blocked).toBe(false);
      await applyActivationChange(disable);
      await expect(access(installed)).rejects.toThrow();
      const enable = await planActivationChange("enable", [packageId]);
      expect(enable.blocked).toBe(false);
      await applyActivationChange(enable);
      expect(await readFile(installed, "utf8")).toContain(packageId);

      await restoreSnapshot(await readSnapshot(snapshotId));
      await expect(access(installed)).rejects.toThrow();
      expect((await readInstallState()).installs).toEqual([]);

      expect(
        markFilesystemConformanceVerified(initial, adapter.agent),
      ).toContainEqual(
        expect.objectContaining({
          agent: adapter.agent,
          filesystemVerified: true,
          nativeApplicationVerified: false,
        }),
      );
    },
  );

  it("derives configured platform evidence from the actual cross-platform CI job", async () => {
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");
    const evidence = platformEvidenceFromCiWorkflow(workflow);
    const matrix = buildAdapterConformanceMatrix(undefined, evidence);
    expect(matrix).toHaveLength(ADAPTER_CAPABILITIES.length);
    expect(matrix.every((entry) => entry.pathKnown)).toBe(true);
    expect(matrix.every((entry) => !entry.filesystemVerified)).toBe(true);
    expect(matrix.every((entry) => !entry.nativeApplicationVerified)).toBe(
      true,
    );
    expect(matrix.every((entry) => entry.platformEvidence.length > 0)).toBe(
      true,
    );
    expect(matrix.flatMap((entry) => entry.platformEvidence)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ platform: "linux", kind: "ci-configured" }),
        expect.objectContaining({ platform: "macos", kind: "ci-configured" }),
        expect.objectContaining({ platform: "windows", kind: "ci-configured" }),
      ]),
    );
  });

  it("rejects CI drift instead of retaining unconditional platform evidence", () => {
    expect(() =>
      platformEvidenceFromCiWorkflow(`
on: [push]
jobs:
  verify:
    runs-on: ubuntu-latest
`),
    ).toThrow(/cross-platform.*workflow_dispatch/i);
  });
});
