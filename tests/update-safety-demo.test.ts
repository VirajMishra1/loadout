import { afterEach, describe, expect, it } from "vitest";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPackageUpdate } from "../src/core/update.js";
import { readInstallState } from "../src/core/state.js";
import type { DetectedAgent } from "../src/shared/types.js";

const fixtureRoot = join(process.cwd(), "tests", "fixtures", "update-safety");
const oldCommit = "1111111";
const newCommit = "2222222";

function codexAgent(skillsDirectory: string): DetectedAgent {
  return {
    id: "codex",
    displayName: "Codex",
    binary: "codex",
    installed: true,
    skillsDirectory,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("safe update demo fixtures", () => {
  const roots: string[] = [];
  const originalLoadoutHome = process.env.LOADOUT_HOME;

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
    if (originalLoadoutHome === undefined) delete process.env.LOADOUT_HOME;
    else process.env.LOADOUT_HOME = originalLoadoutHome;
  });

  async function setup(candidate: "benign-v2" | "risky-v2") {
    const root = await mkdtemp(join(tmpdir(), "loadout-update-demo-"));
    roots.push(root);
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const cache = join(
      process.env.LOADOUT_HOME,
      "cache",
      "owner__ponytail",
      oldCommit,
    );
    const target = join(root, "agents", "skills");
    const source = join(fixtureRoot, candidate);
    await cp(join(fixtureRoot, "benign-v1"), cache, { recursive: true });
    await cp(join(fixtureRoot, "benign-v1"), join(target, "ponytail-demo"), {
      recursive: true,
    });
    await mkdir(process.env.LOADOUT_HOME, { recursive: true });
    await writeFile(
      join(process.env.LOADOUT_HOME, "state.json"),
      JSON.stringify({
        version: 1,
        installs: [
          {
            packageId: "ponytail-demo",
            repository: "owner/ponytail",
            resolvedCommit: oldCommit,
            targetAgents: ["codex"],
            files: [],
            snapshotId: "initial",
            installedAt: "2026-07-14T00:00:00.000Z",
          },
        ],
      }),
    );
    return {
      root,
      target,
      source,
      runtime: {
        fetchSnapshot: async () => ({
          repository: "owner/ponytail",
          commit: newCommit,
          path: source,
        }),
        detectAgents: async () => [codexAgent(target)],
      },
    };
  }

  it("accepts a benign Ponytail-style documentation update without executing repository code", async () => {
    const demo = await setup("benign-v2");
    const result = await applyPackageUpdate("ponytail-demo", {}, demo.runtime);

    expect(result.commit).toBe(newCommit);
    expect(
      await readFile(join(demo.target, "ponytail-demo", "SKILL.md"), "utf8"),
    ).toContain("Summarize the affected files");
    expect((await readInstallState()).installs[0].resolvedCommit).toBe(
      newCommit,
    );
    expect(
      await exists(
        join(process.env.LOADOUT_HOME!, "fixture-hook-was-executed"),
      ),
    ).toBe(false);
  });

  it("quarantines a risky hook and domain update until the user supplies explicit approval", async () => {
    const demo = await setup("risky-v2");
    await expect(
      applyPackageUpdate("ponytail-demo", {}, demo.runtime),
    ).rejects.toThrow(/blocked pending explicit risk approval.*quarantined at/);

    const metadata = JSON.parse(
      await readFile(
        join(
          process.env.LOADOUT_HOME!,
          "quarantine",
          `ponytail-demo-${newCommit}`,
          "metadata.json",
        ),
        "utf8",
      ),
    );
    expect(
      metadata.findings.map(
        (finding: { category: string }) => finding.category,
      ),
    ).toEqual(expect.arrayContaining(["hook", "script", "domain"]));
    expect(
      await readFile(join(demo.target, "ponytail-demo", "SKILL.md"), "utf8"),
    ).not.toContain("reviewEndpoint");
    expect((await readInstallState()).installs[0].resolvedCommit).toBe(
      oldCommit,
    );
    expect(
      await exists(
        join(process.env.LOADOUT_HOME!, "fixture-hook-was-executed"),
      ),
    ).toBe(false);
  });

  it("restores the prior files and install state after a simulated static smoke-test failure", async () => {
    const demo = await setup("benign-v2");
    await expect(
      applyPackageUpdate(
        "ponytail-demo",
        {},
        {
          ...demo.runtime,
          verify: async () => {
            throw new Error("simulated smoke-test failure");
          },
        },
      ),
    ).rejects.toThrow(/verification failed; restored snapshot/);

    const restored = await readFile(
      join(demo.target, "ponytail-demo", "SKILL.md"),
      "utf8",
    );
    expect(restored).toBe(
      await readFile(join(fixtureRoot, "benign-v1", "SKILL.md"), "utf8"),
    );
    expect((await readInstallState()).installs[0].resolvedCommit).toBe(
      oldCommit,
    );
  });
});
