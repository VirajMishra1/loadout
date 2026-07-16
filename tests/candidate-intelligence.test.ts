import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCandidateDossier,
  buildCatalogProposal,
  listDiscoveryCandidates,
  readCandidateDossier,
  verifyCandidateDossierSource,
  writeCandidateDossier,
  type DiscoveryArtifact,
} from "../src/core/candidate-intelligence.js";
import type { CatalogPackage } from "../src/shared/types.js";

function repository(
  name: string,
  overrides: Record<string, unknown> = {},
): DiscoveryArtifact["repositories"][number] {
  return {
    repository: `example/${name}`,
    url: `https://github.com/example/${name}`,
    description: `${name} coding workflow skills`,
    stars: 100,
    forks: 10,
    openIssues: 1,
    language: "TypeScript",
    license: "MIT",
    topics: ["agent-skills", "coding"],
    createdAt: "2026-01-01T00:00:00Z",
    pushedAt: "2026-07-15T00:00:00Z",
    updatedAt: "2026-07-15T00:00:00Z",
    defaultBranch: "main",
    matchedQueries: ["agent-skills"],
    catalogStatus: "candidate",
    firstSeenAt: "2026-07-15T00:00:00Z",
    lastSeenAt: "2026-07-16T00:00:00Z",
    seenInLatestRun: true,
    starsPerDaySinceCreation: 0.5,
    ...overrides,
  };
}

describe("candidate intelligence", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function fixture(): Promise<{
    feed: string;
    source: string;
    artifact: DiscoveryArtifact;
  }> {
    root = await mkdtemp(join(tmpdir(), "loadout-candidate-"));
    const source = join(root, "source");
    await mkdir(join(source, "skills", "review"), { recursive: true });
    await writeFile(
      join(source, "skills", "review", "SKILL.md"),
      "---\nname: review-workflow\ndescription: Review coding changes safely\n---\n",
    );
    const artifact: DiscoveryArtifact = {
      schemaVersion: 1,
      generatedAt: "2026-07-16T00:00:00.000Z",
      repositories: [
        repository("review-kit", {
          stars: 5000,
          matchedQueries: ["agent-skills", "codex", "claude-code"],
          starVelocityPerDay: 125,
          starVelocityWindowDays: 2,
        }),
        repository("older-kit", { seenInLatestRun: false }),
      ],
    };
    const feed = join(root, "discovered.json");
    await writeFile(feed, JSON.stringify(artifact));
    return { feed, source, artifact };
  }

  it("lists evidence-backed triage priority without calling it quality", async () => {
    const { feed } = await fixture();
    const candidates = await listDiscoveryCandidates({ path: feed, limit: 10 });
    expect(candidates.map((item) => item.repository)).toEqual([
      "example/review-kit",
      "example/older-kit",
    ]);
    expect(candidates[0].growth.kind).toBe("observed-star-velocity");
    expect(candidates[0].triageEvidence.join(" ")).toMatch(
      /not quality or safety/,
    );
  });

  it("keeps negative observed growth finite and rejects malformed consumed fields", async () => {
    const { feed, artifact } = await fixture();
    artifact.repositories[0] = repository("review-kit", {
      starVelocityPerDay: -50,
      starVelocityWindowDays: 2,
    });
    await writeFile(feed, JSON.stringify(artifact));
    const candidates = await listDiscoveryCandidates({ path: feed });
    expect(Number.isFinite(candidates[0].triagePriority)).toBe(true);
    expect(candidates[0].growth.starsPerDay).toBe(-50);

    artifact.repositories[0] = {
      ...artifact.repositories[0],
      topics: null,
    } as unknown as DiscoveryArtifact["repositories"][number];
    await writeFile(feed, JSON.stringify(artifact));
    await expect(listDiscoveryCandidates({ path: feed })).rejects.toThrow(
      /repository 1 is invalid/,
    );
  });

  it("builds a path-portable immutable dossier without executing source", async () => {
    const { feed, source } = await fixture();
    const catalog: CatalogPackage[] = [
      {
        id: "review-baseline",
        displayName: "Review Baseline",
        repository: "catalog/review-baseline",
        description: "Coding review workflow",
        category: "workflow",
        tier: "stable",
      },
    ];
    const dossier = await buildCandidateDossier("example/review-kit", {
      discoveryPath: feed,
      catalog,
      now: new Date("2026-07-16T12:00:00Z"),
      fetchSnapshot: async () => ({
        repository: "example/review-kit",
        commit: "a".repeat(40),
        path: source,
      }),
    });
    expect(dossier.review.status).toBe("needs-human-review");
    expect(dossier.components).toContain("skill");
    expect(dossier.evidencePaths).toEqual(["skills/review/SKILL.md"]);
    expect(dossier.overlap[0]?.packageId).toBe("review-baseline");
    expect(JSON.stringify(dossier)).not.toContain(source);
    expect(dossier.safetyBoundary).toMatch(/without running/);
    expect(dossier.review.reasons).toContain(
      "A human must review usefulness, overlap, license, platform claims, and runtime behavior",
    );

    const path = await writeCandidateDossier(
      dossier,
      join(root, "dossier.json"),
    );
    expect((await readCandidateDossier(path)).commit).toBe("a".repeat(40));
    const forged = {
      ...dossier,
      inspection: {},
      components: ["skill" as const],
      evidencePaths: ["README.md"],
    };
    await writeFile(path, JSON.stringify(forged));
    await expect(readCandidateDossier(path)).rejects.toThrow(
      /inspection evidence is invalid|schema is invalid/,
    );
    expect(() =>
      buildCatalogProposal(forged as typeof dossier, {
        id: "forged",
        category: "workflow",
        operatingSystems: ["linux"],
      }),
    ).toThrow(/inspection evidence is invalid/);
    const editedEvaluation = {
      ...dossier,
      evaluation: {
        ...dossier.evaluation,
        uncertainty: "edited after inspection",
      },
    };
    expect(() =>
      buildCatalogProposal(editedEvaluation, {
        id: "edited-evaluation",
        category: "workflow",
        operatingSystems: ["linux"],
      }),
    ).toThrow(/re-verified against its pinned source/);
    await expect(
      verifyCandidateDossierSource(editedEvaluation, {
        fetchSnapshot: async () => ({
          repository: dossier.repository,
          commit: dossier.commit,
          path: source,
        }),
      }),
    ).rejects.toThrow(/differs from its pinned source/);
    await writeFile(
      path,
      JSON.stringify({
        ...dossier,
        review: { ...dossier.review, status: "approved" },
      }),
    );
    await expect(readCandidateDossier(path)).rejects.toThrow(
      /schema is invalid/,
    );
    dossier.evaluation.uncertainty = "mutated after verification";
    expect(() =>
      buildCatalogProposal(dossier, {
        id: "mutated-in-place",
        category: "workflow",
        operatingSystems: ["linux"],
      }),
    ).toThrow(/re-verified against its pinned source/);
  });

  it("requires explicit human platform claims and refuses blocked proposals", async () => {
    const { feed, source } = await fixture();
    const dossier = await buildCandidateDossier("example/review-kit", {
      discoveryPath: feed,
      catalog: [],
      fetchSnapshot: async () => ({
        repository: "example/review-kit",
        commit: "b".repeat(40),
        path: source,
      }),
    });
    expect(() =>
      buildCatalogProposal(dossier, {
        id: "review-kit",
        category: "workflow",
        operatingSystems: [],
      }),
    ).toThrow(/explicitly reviewed platform/);
    const proposal = buildCatalogProposal(dossier, {
      id: "review-kit",
      category: "workflow",
      operatingSystems: ["macos", "linux"],
    });
    expect(proposal.source?.commit).toBe("b".repeat(40));
    expect(proposal.operatingSystems).toEqual(["macos", "linux"]);
    expect(() =>
      buildCatalogProposal(
        { ...dossier, review: { ...dossier.review, status: "blocked" } },
        {
          id: "review-kit",
          category: "workflow",
          operatingSystems: ["linux"],
        },
      ),
    ).toThrow(/Blocked dossiers/);
    expect(() =>
      buildCatalogProposal(
        { ...dossier, evidencePaths: ["../escape"] },
        {
          id: "review-kit",
          category: "workflow",
          operatingSystems: ["linux"],
        },
      ),
    ).toThrow(/evidencePaths/);
  });

  it("rejects snapshot evidence for a different repository", async () => {
    const { feed, source } = await fixture();
    await expect(
      buildCandidateDossier("example/review-kit", {
        discoveryPath: feed,
        catalog: [],
        fetchSnapshot: async () => ({
          repository: "attacker/other",
          commit: "c".repeat(40),
          path: source,
        }),
      }),
    ).rejects.toThrow(/mismatched or non-immutable/);
  });

  it("reconciles stale discovery status against the effective catalog", async () => {
    const { feed } = await fixture();
    await expect(
      buildCandidateDossier("example/review-kit", {
        discoveryPath: feed,
        catalog: [
          {
            id: "already-reviewed",
            displayName: "Already Reviewed",
            repository: "example/review-kit",
            description: "reviewed",
            category: "workflow",
            tier: "stable",
          },
        ],
        fetchSnapshot: async () => {
          throw new Error("must not fetch stale catalog candidates");
        },
      }),
    ).rejects.toThrow(/effective reviewed catalog/);
  });

  it("does not claim components from empty MCP or invalid plugin manifests", async () => {
    const { feed } = await fixture();
    const source = join(root, "invalid-source");
    await mkdir(join(source, ".claude-plugin"), { recursive: true });
    await writeFile(join(source, ".claude-plugin", "plugin.json"), "{");
    await writeFile(
      join(source, "mcp.json"),
      JSON.stringify({ mcpServers: {} }),
    );
    const dossier = await buildCandidateDossier("example/review-kit", {
      discoveryPath: feed,
      catalog: [],
      fetchSnapshot: async () => ({
        repository: "example/review-kit",
        commit: "d".repeat(40),
        path: source,
      }),
    });
    expect(dossier.components).toEqual([]);
    expect(dossier.evidencePaths).toEqual([]);
    expect(dossier.review.status).toBe("blocked");
    const path = await writeCandidateDossier(
      dossier,
      join(root, "blocked-dossier.json"),
    );
    expect((await readCandidateDossier(path)).review.status).toBe("blocked");
    await writeFile(
      path,
      JSON.stringify({
        ...dossier,
        review: { ...dossier.review, status: "needs-human-review" },
      }),
    );
    await expect(readCandidateDossier(path)).rejects.toThrow(
      /review status is inconsistent/,
    );
  });
});
