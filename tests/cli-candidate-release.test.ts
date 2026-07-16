import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCandidateDossier,
  writeCandidateDossier,
  type DiscoveryArtifact,
} from "../src/core/candidate-intelligence.js";
import { loadCatalog } from "../src/core/catalog.js";
import { generateSigningKeys, signJsonFile } from "../src/core/signing.js";
import { repositoryCachePath } from "../src/core/source.js";

const exec = promisify(execFile);
const tsx = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const entry = join(process.cwd(), "src", "cli.ts");

async function runCli(root: string, ...args: string[]) {
  return exec(process.execPath, [tsx, entry, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LOADOUT_HOME: join(root, "state"),
      LOADOUT_USER_HOME: join(root, "user"),
      NO_COLOR: "1",
    },
    maxBuffer: 10 * 1024 * 1024,
  });
}

describe("candidate and catalog release CLI contracts", () => {
  let root = "";
  const previousHome = process.env.LOADOUT_HOME;
  afterEach(async () => {
    if (previousHome === undefined) delete process.env.LOADOUT_HOME;
    else process.env.LOADOUT_HOME = previousHome;
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("emits valid candidate JSON and rejects unquoted excess query words", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-cli-candidate-list-"));
    const result = await runCli(
      root,
      "candidate",
      "list",
      "--limit",
      "2",
      "--json",
    );
    expect(JSON.parse(result.stdout)).toHaveLength(2);
    const failure = await runCli(
      root,
      "--json-errors",
      "candidate",
      "list",
      "--query",
      "codex",
      "skills",
    ).catch((error: unknown) => error as { stdout: string; stderr: string });
    expect(failure.stdout).toBe("");
    expect(JSON.parse(failure.stderr)).toMatchObject({
      error: {
        code: "commander.excessArguments",
        message: expect.stringContaining("too many arguments"),
      },
    });
  });

  it("keeps proposal preview and approved JSON machine-readable", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-cli-candidate-propose-"));
    process.env.LOADOUT_HOME = join(root, "state");
    const source = join(root, "source");
    await mkdir(join(source, "skills", "demo"), { recursive: true });
    await writeFile(
      join(source, "skills", "demo", "SKILL.md"),
      "---\nname: phase-fourteen-demo\ndescription: Focused unique capability\n---\n",
    );
    await exec("git", ["init", "--quiet", source]);
    await exec("git", [
      "-C",
      source,
      "config",
      "user.email",
      "loadout@example.com",
    ]);
    await exec("git", ["-C", source, "config", "user.name", "Loadout Test"]);
    await exec("git", ["-C", source, "add", "."]);
    await exec("git", ["-C", source, "commit", "--quiet", "-m", "fixture"]);
    const commit = (
      await exec("git", ["-C", source, "rev-parse", "HEAD"])
    ).stdout.trim();
    const artifact: DiscoveryArtifact = {
      schemaVersion: 1,
      generatedAt: "2026-07-16T00:00:00.000Z",
      repositories: [
        {
          repository: "example/phase-fourteen-demo",
          url: "https://github.com/example/phase-fourteen-demo",
          description: "Focused unique capability",
          stars: 10,
          forks: 1,
          openIssues: 0,
          language: "TypeScript",
          license: "MIT",
          topics: ["agent-skills"],
          createdAt: "2026-07-01T00:00:00Z",
          pushedAt: "2026-07-16T00:00:00Z",
          updatedAt: "2026-07-16T00:00:00Z",
          defaultBranch: "main",
          matchedQueries: ["agent-skills"],
          catalogStatus: "candidate",
          firstSeenAt: "2026-07-16T00:00:00Z",
          lastSeenAt: "2026-07-16T00:00:00Z",
          seenInLatestRun: true,
          starsPerDaySinceCreation: 0.625,
        },
      ],
    };
    const feed = join(root, "feed.json");
    await writeFile(feed, JSON.stringify(artifact));
    const dossier = await buildCandidateDossier("example/phase-fourteen-demo", {
      discoveryPath: feed,
      catalog: [],
      fetchSnapshot: async () => ({
        repository: "example/phase-fourteen-demo",
        commit,
        path: source,
      }),
    });
    const dossierPath = await writeCandidateDossier(
      dossier,
      join(root, "dossier.json"),
    );
    const cached = repositoryCachePath("example/phase-fourteen-demo", commit);
    await mkdir(dirname(cached), { recursive: true });
    await rename(source, cached);
    const preview = await runCli(
      root,
      "candidate",
      "propose",
      dossierPath,
      "--id",
      "phase-fourteen-demo",
      "--category",
      "focused-demo",
      "--platforms",
      "linux",
      "--json",
    );
    expect(JSON.parse(preview.stdout)).toMatchObject({
      approved: false,
      catalogMutated: false,
      proposal: { id: "phase-fourteen-demo" },
    });
    const output = join(root, "proposal.json");
    const approved = await runCli(
      root,
      "candidate",
      "propose",
      dossierPath,
      "--id",
      "phase-fourteen-demo",
      "--category",
      "focused-demo",
      "--platforms",
      "linux",
      "--approve",
      "--output",
      output,
      "--json",
    );
    expect(JSON.parse(approved.stdout)).toMatchObject({
      approved: true,
      catalogMutated: false,
      output,
    });
    expect(JSON.parse(await readFile(output, "utf8")).id).toBe(
      "phase-fourteen-demo",
    );
  });

  it("emits one JSON document for signed preview and apply", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-cli-release-"));
    const privateKey = join(root, "private.pem");
    const publicKey = join(root, "public.pem");
    const signed = join(root, "catalog.signed.json");
    await generateSigningKeys(privateKey, publicKey);
    expect((await loadCatalog()).length).toBeGreaterThan(0);
    await signJsonFile("catalog/packages.json", privateKey, signed);
    const preview = await runCli(
      root,
      "catalog-update",
      "--source",
      signed,
      "--public-key",
      publicKey,
      "--json",
    );
    expect(JSON.parse(preview.stdout)).toMatchObject({ applied: false });
    const applied = await runCli(
      root,
      "catalog-update",
      "--source",
      signed,
      "--public-key",
      publicKey,
      "--yes",
      "--json",
    );
    expect(JSON.parse(applied.stdout)).toMatchObject({
      applied: true,
      path: expect.stringContaining("trusted.json"),
      snapshotId: expect.stringMatching(/^\d+-[a-f0-9]{12}$/),
    });
  });

  it("exposes adapter gaps and agent-scoped recommendation outcomes through the CLI", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-cli-personalization-"));
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({
        dependencies: { zod: "latest" },
        scripts: { test: "vitest run" },
      }),
    );

    const gaps = JSON.parse(
      (await runCli(root, "capabilities", "--gaps", "--json")).stdout,
    ) as Array<{
      agent: string;
      component: string;
      requirement: string;
    }>;
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent: "windsurf",
          component: "command",
          requirement: expect.stringContaining("Official"),
        }),
      ]),
    );

    await runCli(
      root,
      "outcome",
      "superpowers/review",
      "--agent",
      "codex",
      "--task",
      "javascript",
      "--result",
      "rollback",
    );
    const personalized = JSON.parse(
      (
        await runCli(
          root,
          "recommend",
          "--project",
          project,
          "--agent",
          "codex",
          "--json",
        )
      ).stdout,
    ) as {
      recommendations: Array<{
        packageId: string;
        localOutcomeAdjustment?: number;
      }>;
      personalization: { agent: string; privacy: string };
    };
    expect(personalized.personalization).toEqual({
      agent: "codex",
      privacy: "local-only-no-project-or-content",
    });
    expect(
      personalized.recommendations.find(
        (item) => item.packageId === "superpowers",
      ),
    ).toMatchObject({ localOutcomeAdjustment: -35 });

    for (const agent of ["codex,claude-code", "not-an-agent"]) {
      const failure = await runCli(
        root,
        "--json-errors",
        "recommend",
        "--project",
        project,
        "--agent",
        agent,
        "--json",
      ).catch((error: unknown) => error as { stdout: string; stderr: string });
      expect(failure.stdout).toBe("");
      expect(JSON.parse(failure.stderr)).toMatchObject({
        error: {
          message: expect.any(String),
        },
      });
    }
  });
});
