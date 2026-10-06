import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAccept, planAccept } from "../src/core/install/accept.js";
import { buildHealthReport } from "../src/core/reporting/health.js";
import {
  readInstallState,
  writeInstallState,
} from "../src/core/workspace/state.js";
import type { DetectedAgent, InstallState } from "../src/shared/types.js";

const ORIGINAL_LOADOUT_HOME = process.env.LOADOUT_HOME;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const agents = async (): Promise<DetectedAgent[]> => [];
const ORIGINAL = "---\nname: my-skill\ndescription: Original\n---\nBody\n";
const EDITED = "---\nname: my-skill\ndescription: Edited\n---\nBetter body\n";

describe("accepting local edits to managed skills", () => {
  let root = "";
  let activePath = "";
  let libraryPath = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-accept-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    activePath = join(root, "skills", "my-skill");
    libraryPath = join(root, ".loadout", "library", "pkg", "claude-code");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    if (ORIGINAL_LOADOUT_HOME === undefined) delete process.env.LOADOUT_HOME;
    else process.env.LOADOUT_HOME = ORIGINAL_LOADOUT_HOME;
  });

  async function seed(activationState: "active" | "disabled"): Promise<void> {
    const state: InstallState = {
      version: 1,
      installs: [
        {
          packageId: "pkg",
          targetAgents: ["claude-code"],
          files: [
            { path: join(activePath, "SKILL.md"), sha256: sha(ORIGINAL) },
          ],
          snapshotId: "seed",
          installedAt: "2026-10-06T00:00:00.000Z",
        },
      ],
      mcpInstalls: [],
      activations: [
        {
          packageId: "pkg",
          unitId: "my-skill",
          agent: "claude-code",
          cacheState: activationState === "disabled" ? "downloaded" : "missing",
          reviewState: "reviewed",
          installationState: "installed",
          activationState,
          libraryPath,
          targets: [{ activePath, libraryRelativePath: "my-skill" }],
          libraryFiles:
            activationState === "disabled"
              ? [{ path: "my-skill/SKILL.md", sha256: sha(ORIGINAL) }]
              : [],
          updatedAt: "2026-10-06T00:00:00.000Z",
        },
      ],
    };
    const home =
      activationState === "active" ? activePath : join(libraryPath, "my-skill");
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "SKILL.md"), ORIGINAL);
    await writeInstallState(state);
  }

  it("records an edited active skill as the new baseline and clears drift", async () => {
    await seed("active");
    await writeFile(join(activePath, "SKILL.md"), EDITED);
    expect((await buildHealthReport({ agents })).driftedFiles).toBe(1);

    const plan = await planAccept({ selector: "my-skill" });
    expect(plan.files).toEqual([
      expect.objectContaining({
        packageId: "pkg",
        recordedSha256: sha(ORIGINAL),
        actualSha256: sha(EDITED),
      }),
    ]);
    const snapshotId = await applyAccept(plan);

    expect(snapshotId).toBeTruthy();
    expect((await readInstallState()).installs[0].files[0].sha256).toBe(
      sha(EDITED),
    );
    expect((await buildHealthReport({ agents })).driftedFiles).toBe(0);
  });

  it("updates the library hash too when a disabled skill's library copy was edited", async () => {
    await seed("disabled");
    await writeFile(join(libraryPath, "my-skill", "SKILL.md"), EDITED);

    await applyAccept(await planAccept({ selector: null }));

    const state = await readInstallState();
    expect(state.installs[0].files[0].sha256).toBe(sha(EDITED));
    expect(state.activations?.[0].libraryFiles[0].sha256).toBe(sha(EDITED));
    expect((await buildHealthReport({ agents })).driftedFiles).toBe(0);
  });

  it("refuses when the files change after the preview", async () => {
    await seed("active");
    await writeFile(join(activePath, "SKILL.md"), EDITED);
    const plan = await planAccept({ selector: "pkg" });
    await writeFile(join(activePath, "SKILL.md"), `${EDITED}later\n`);

    await expect(applyAccept(plan)).rejects.toThrow(/changed after preview/);
    expect((await readInstallState()).installs[0].files[0].sha256).toBe(
      sha(ORIGINAL),
    );
  });

  it("reports missing files and will not accept them", async () => {
    await seed("active");
    await rm(join(activePath, "SKILL.md"));

    const plan = await planAccept({ selector: "my-skill" });
    expect(plan.missing).toHaveLength(1);
    await expect(applyAccept(plan)).rejects.toThrow(/missing/);
  });

  it("filters by agent and rejects unknown names", async () => {
    await seed("active");
    await writeFile(join(activePath, "SKILL.md"), EDITED);

    expect(
      (await planAccept({ selector: "my-skill", agent: "codex" })).files,
    ).toHaveLength(0);
    await expect(planAccept({ selector: "nope" })).rejects.toThrow(
      /No managed skill or package named 'nope'/,
    );
  });
});
