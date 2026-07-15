import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseLockfile } from "../src/core/audit.js";
import { parseManifest } from "../src/core/manifest.js";
import { readInstallState } from "../src/core/state.js";
import { formatSchemaError, installPlanSchema } from "../src/shared/schemas.js";

describe("runtime data schemas", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    delete process.env.LOADOUT_HOME;
  });

  it("parses a valid plan and pinpoints unsupported agents", () => {
    const plan = {
      packageId: "docs",
      files: [
        {
          source: "/tmp/source/SKILL.md",
          target: "/tmp/target/SKILL.md",
          componentType: "skill",
          compatibility: "native",
        },
      ],
      targetAgents: ["codex"],
      warnings: [],
    };
    expect(installPlanSchema.parse(plan).packageId).toBe("docs");
    const result = installPlanSchema.safeParse({
      ...plan,
      targetAgents: ["unknown-agent"],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(formatSchemaError(result.error)).toMatch(/targetAgents\.0/);
  });

  it("rejects malformed lockfile hashes before reproducibility audit", () => {
    expect(() =>
      parseLockfile({
        schemaVersion: 1,
        manifestName: "team",
        generatedAt: "2026-07-15T00:00:00Z",
        packages: [
          {
            id: "docs",
            source: { type: "github", repository: "upstash/context7" },
            targetAgents: ["codex"],
            files: [{ path: "/tmp/SKILL.md", sha256: "not-a-hash" }],
            installedAt: "2026-07-15T00:00:00Z",
          },
        ],
      }),
    ).toThrow(/packages\.0\.files\.0\.sha256/);
  });

  it("rejects malformed persisted install state with its exact field", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-schema-state-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    await mkdir(process.env.LOADOUT_HOME);
    await writeFile(
      join(process.env.LOADOUT_HOME, "state.json"),
      JSON.stringify({
        version: 1,
        installs: [
          {
            packageId: "docs",
            targetAgents: ["not-an-agent"],
            files: [],
            snapshotId: "snapshot",
            installedAt: "2026-07-15T00:00:00Z",
          },
        ],
      }),
    );
    await expect(readInstallState()).rejects.toThrow(
      /installs\.0\.targetAgents\.0/,
    );
  });

  it("rejects malformed manifest policy values without accepting secret fields", () => {
    expect(() =>
      parseManifest({
        schemaVersion: 1,
        name: "team",
        scope: "project",
        agents: ["codex"],
        packages: [],
        policy: { blockedDomains: [42] },
      }),
    ).toThrow(/policy\.blockedDomains\.0/);
  });
});
