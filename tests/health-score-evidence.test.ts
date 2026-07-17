import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildLocalAgentHealthScores,
  collectLocalAgentHealthEvidence,
} from "../src/core/health-score-evidence.js";
import { createSnapshot } from "../src/core/snapshot.js";
import { writeInstallState } from "../src/core/state.js";
import type { CatalogPackage, DetectedAgent } from "../src/shared/types.js";

describe("local Agent Health Score evidence", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    delete process.env.LOADOUT_HOME;
    delete process.env.LOADOUT_USER_HOME;
  });

  it("keeps an empty detected profile at zero rather than treating absence as health", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-health-evidence-"));
    process.env.LOADOUT_HOME = join(root, "state");
    process.env.LOADOUT_USER_HOME = join(root, "home");
    const agent: DetectedAgent = {
      id: "codex",
      displayName: "Codex",
      installed: true,
      binary: "codex",
      skillsDirectory: join(root, "home", ".agents", "skills"),
    };
    const scores = await buildLocalAgentHealthScores({
      agents: [agent],
      catalog: [],
      asOf: new Date("2026-07-16T00:00:00.000Z"),
    });
    expect(scores[0]).toMatchObject({
      agent: "codex",
      score: 0,
      rating: "unknown",
    });
  });

  it("collects pinned provenance, byte drift, duplicates, compatibility, and snapshots", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-health-evidence-"));
    process.env.LOADOUT_HOME = join(root, "state");
    process.env.LOADOUT_USER_HOME = join(root, "home");
    const skill = join(root, "home", ".agents", "skills", "reviewed");
    await mkdir(skill, { recursive: true });
    const content = "---\nname: reviewed\ndescription: Reviewed\n---\n";
    const path = join(skill, "SKILL.md");
    await writeFile(path, content);
    const snapshot = await createSnapshot([skill]);
    const commit = "a".repeat(40);
    await writeInstallState({
      version: 1,
      installs: [
        {
          packageId: "reviewed",
          repository: "example/reviewed",
          resolvedCommit: commit,
          targetAgents: ["codex"],
          files: [
            {
              path,
              sha256: createHash("sha256").update(content).digest("hex"),
            },
          ],
          snapshotId: snapshot.id,
          installedAt: "2026-07-16T00:00:00.000Z",
          staticAssessment: {
            status: "clear",
            findingCount: 0,
            assessedAt: "2026-07-16T00:00:00.000Z",
            policy: "install-safety-v1",
          },
        },
      ],
      activations: [],
    });
    const agent: DetectedAgent = {
      id: "codex",
      displayName: "Codex",
      installed: true,
      binary: "codex",
      skillsDirectory: join(root, "home", ".agents", "skills"),
    };
    const catalog: CatalogPackage[] = [
      {
        id: "reviewed",
        displayName: "Reviewed",
        repository: "example/reviewed",
        description: "Reviewed",
        category: "test",
        tier: "stable",
        license: "MIT",
        components: ["skill"],
        source: {
          type: "github",
          url: "https://github.com/example/reviewed",
          defaultBranch: "main",
          commit,
          evidencePaths: ["SKILL.md"],
          verifiedAt: "2026-07-16T00:00:00.000Z",
        },
        pushedAt: "2026-07-15T00:00:00.000Z",
      },
    ];
    const evidence = await collectLocalAgentHealthEvidence({
      agents: [agent],
      catalog,
      asOf: new Date("2026-07-16T00:00:00.000Z"),
    });
    expect(evidence[0]).toMatchObject({
      packages: [
        {
          packageId: "reviewed",
          provenance: "verified",
          license: "MIT",
          staticRisk: { status: "clear", findingCount: 0 },
          freshness: { status: "fresh", ageDays: 1 },
        },
      ],
      drift: { checkedFiles: 1, driftedFiles: 0 },
      duplicates: { scannedSkills: 1, withinAgentGroups: 0 },
      activeSet: { active: 1, capacity: 30 },
      compatibility: [{ component: "skill", compatibility: "native" }],
      recoverability: { readableSnapshots: 1, corruptSnapshots: 0 },
    });
  });
});
