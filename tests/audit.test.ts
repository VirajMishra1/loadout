import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditLoadout } from "../src/core/audit.js";

describe("team reproducibility audit", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    delete process.env.LOADOUT_HOME;
  });
  it("passes matching state and detects later file drift", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-audit-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    await mkdir(process.env.LOADOUT_HOME);
    const file = join(root, "SKILL.md");
    await writeFile(file, "original");
    const sha256 = createHash("sha256").update("original").digest("hex");
    const source = { type: "github", repository: "owner/repo" };
    const manifest = {
      schemaVersion: 1,
      name: "team",
      scope: "project",
      agents: ["codex"],
      packages: [{ id: "demo", source }],
    };
    const locked = {
      id: "demo",
      source,
      repository: "owner/repo",
      resolvedCommit: "abc",
      targetAgents: ["codex"],
      files: [{ path: file, sha256 }],
      installedAt: "now",
    };
    const manifestPath = join(root, "loadout.json");
    const lockPath = join(root, "loadout.lock");
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(
      lockPath,
      JSON.stringify({
        schemaVersion: 1,
        manifestName: "team",
        generatedAt: "now",
        packages: [locked],
      }),
    );
    await writeFile(
      join(process.env.LOADOUT_HOME, "state.json"),
      JSON.stringify({
        version: 1,
        installs: [
          {
            packageId: "demo",
            repository: "owner/repo",
            resolvedCommit: "abc",
            targetAgents: ["codex"],
            files: [{ path: file, sha256 }],
            snapshotId: "s",
            installedAt: "now",
          },
        ],
      }),
    );
    expect((await auditLoadout(manifestPath, lockPath)).valid).toBe(true);
    await writeFile(file, "drifted");
    const report = await auditLoadout(manifestPath, lockPath);
    expect(report.valid).toBe(false);
    expect(report.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "file-drift" })]),
    );
  });

  it("audits disabled files from the private library copy", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-audit-disabled-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    await mkdir(process.env.LOADOUT_HOME);
    const activeRoot = join(root, "skills", "demo");
    const activeFile = join(activeRoot, "SKILL.md");
    const libraryPath = join(root, "library");
    const libraryFile = join(libraryPath, "demo", "SKILL.md");
    await mkdir(join(libraryPath, "demo"), { recursive: true });
    await writeFile(libraryFile, "disabled bytes");
    const sha256 = createHash("sha256").update("disabled bytes").digest("hex");
    const source = { type: "github", repository: "owner/repo" };
    const manifestPath = join(root, "loadout.json");
    const lockPath = join(root, "loadout.lock");
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        name: "team",
        scope: "project",
        agents: ["codex"],
        packages: [{ id: "demo", source }],
      }),
    );
    const locked = {
      id: "demo",
      source,
      repository: "owner/repo",
      resolvedCommit: "abc",
      targetAgents: ["codex"],
      files: [{ path: activeFile, sha256 }],
      installedAt: "now",
    };
    await writeFile(
      lockPath,
      JSON.stringify({
        schemaVersion: 1,
        manifestName: "team",
        generatedAt: "now",
        packages: [locked],
      }),
    );
    await writeFile(
      join(process.env.LOADOUT_HOME, "state.json"),
      JSON.stringify({
        version: 1,
        installs: [
          {
            packageId: "demo",
            repository: "owner/repo",
            resolvedCommit: "abc",
            targetAgents: ["codex"],
            files: [{ path: activeFile, sha256 }],
            snapshotId: "s",
            installedAt: "now",
          },
        ],
        activations: [
          {
            packageId: "demo",
            agent: "codex",
            cacheState: "downloaded",
            reviewState: "reviewed",
            installationState: "installed",
            activationState: "disabled",
            libraryPath,
            targets: [
              {
                activePath: activeRoot,
                libraryRelativePath: "demo",
              },
            ],
            libraryFiles: [{ path: "demo/SKILL.md", sha256 }],
            updatedAt: "now",
          },
        ],
      }),
    );
    expect((await auditLoadout(manifestPath, lockPath)).valid).toBe(true);
    await writeFile(libraryFile, "drifted");
    expect((await auditLoadout(manifestPath, lockPath)).valid).toBe(false);
  });
});
