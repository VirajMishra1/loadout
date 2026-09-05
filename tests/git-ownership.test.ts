import { describe, expect, it, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { initHandoff } from "../src/core/delegation/handoff.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]) {
  return execFileAsync("git", args, { cwd });
}

async function setupGitRepo(root: string) {
  await git(root, "init");
  await git(root, "config", "user.email", "test@test.com");
  await git(root, "config", "user.name", "TestUser");
}

describe("git-ownership", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "loadout-git-ownership-test-"));
  });

  it("scans git log and returns per-author directory stats", async () => {
    const { scanGitHistory } =
      await import("../src/core/coordination/git-ownership.js");

    await setupGitRepo(projectRoot);
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await mkdir(join(projectRoot, "tests"), { recursive: true });

    await writeFile(join(projectRoot, "src", "app.ts"), "export const a = 1;");
    await git(projectRoot, "add", ".");
    await git(projectRoot, "commit", "-m", "feat: app");

    await writeFile(
      join(projectRoot, "tests", "app.test.ts"),
      'import { a } from "../src/app";',
    );
    await git(projectRoot, "add", ".");
    await git(projectRoot, "commit", "-m", "test: app");

    const stats = await scanGitHistory(projectRoot);
    expect(stats).toHaveLength(1);
    expect(stats[0].author).toBe("TestUser");
    expect(stats[0].totalCommits).toBe(2);
    expect(stats[0].directories.get("src")).toBe(1);
    expect(stats[0].directories.get("tests")).toBe(1);
  });

  it("filters by author names", async () => {
    const { scanGitHistory } =
      await import("../src/core/coordination/git-ownership.js");

    await setupGitRepo(projectRoot);
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "src", "a.ts"), "1");
    await git(projectRoot, "add", ".");
    await git(projectRoot, "commit", "-m", "a");

    const stats = await scanGitHistory(projectRoot, {
      authors: ["nonexistent"],
    });
    expect(stats).toHaveLength(0);

    const filtered = await scanGitHistory(projectRoot, {
      authors: ["TestUser"],
    });
    expect(filtered).toHaveLength(1);
  });

  it("suggests ownership when author dominates a directory", async () => {
    const { suggestOwnership } =
      await import("../src/core/coordination/git-ownership.js");

    await setupGitRepo(projectRoot);
    // Initialize handoff dir for ownership tracking
    await initHandoff(projectRoot);
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await mkdir(join(projectRoot, "tests"), { recursive: true });

    // All commits from one author
    await writeFile(join(projectRoot, "src", "a.ts"), "1");
    await git(projectRoot, "add", ".");
    await git(projectRoot, "commit", "-m", "a");

    await writeFile(join(projectRoot, "src", "b.ts"), "2");
    await git(projectRoot, "add", ".");
    await git(projectRoot, "commit", "-m", "b");

    await writeFile(join(projectRoot, "tests", "a.test.ts"), "t");
    await git(projectRoot, "add", ".");
    await git(projectRoot, "commit", "-m", "c");

    const result = await suggestOwnership(projectRoot, ["TestUser"]);
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);

    const srcSuggestion = result.suggestions.find((s) => s.directory === "src");
    expect(srcSuggestion).toBeDefined();
    expect(srcSuggestion!.suggestedOwner).toBe("TestUser");
    expect(srcSuggestion!.percentage).toBe(100);
    expect(srcSuggestion!.alreadyClaimed).toBe(false);
  });

  it("keeps unselected authors in the confidence denominator", async () => {
    const { suggestOwnership } =
      await import("../src/core/coordination/git-ownership.js");
    await setupGitRepo(projectRoot);
    await initHandoff(projectRoot);
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "src", "agent.ts"), "1");
    await git(projectRoot, "add", ".");
    await git(projectRoot, "commit", "-m", "agent");
    await git(projectRoot, "config", "user.name", "HumanMaintainer");
    for (let index = 0; index < 2; index++) {
      await writeFile(join(projectRoot, "src", `human-${index}.ts`), `${index}`);
      await git(projectRoot, "add", ".");
      await git(projectRoot, "commit", "-m", `human ${index}`);
    }

    const result = await suggestOwnership(projectRoot, ["TestUser"], {
      threshold: 60,
    });
    expect(result.suggestions).toEqual([]);
  });

  it("maps an agent identity to its configured Git author", async () => {
    const { suggestOwnership } =
      await import("../src/core/coordination/git-ownership.js");
    await setupGitRepo(projectRoot);
    await initHandoff(projectRoot);
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "src", "app.ts"), "1");
    await git(projectRoot, "add", ".");
    await git(projectRoot, "commit", "-m", "agent work");

    const result = await suggestOwnership(projectRoot, ["codex=TestUser"]);
    expect(result.suggestions[0].suggestedOwner).toBe("codex");
  });

  it("marks already-claimed directories", async () => {
    const { suggestOwnership } =
      await import("../src/core/coordination/git-ownership.js");
    const { claimOwnership } =
      await import("../src/core/coordination/coordinator.js");

    await setupGitRepo(projectRoot);
    await initHandoff(projectRoot);
    await mkdir(join(projectRoot, "src"), { recursive: true });

    await writeFile(join(projectRoot, "src", "a.ts"), "1");
    await git(projectRoot, "add", ".");
    await git(projectRoot, "commit", "-m", "a");

    // Claim ownership first
    await claimOwnership(projectRoot, {
      agent: "TestUser",
      paths: ["src"],
      mode: "exclusive",
    });

    const result = await suggestOwnership(projectRoot, ["TestUser"]);
    const srcSuggestion = result.suggestions.find((s) => s.directory === "src");
    expect(srcSuggestion?.alreadyClaimed).toBe(true);
  });

  it("applies ownership for unclaimed directories", async () => {
    const { applyGitOwnership } =
      await import("../src/core/coordination/git-ownership.js");
    const { getOwnership } =
      await import("../src/core/coordination/coordinator.js");

    await setupGitRepo(projectRoot);
    await initHandoff(projectRoot);
    await mkdir(join(projectRoot, "src"), { recursive: true });

    await writeFile(join(projectRoot, "src", "a.ts"), "1");
    await git(projectRoot, "add", ".");
    await git(projectRoot, "commit", "-m", "a");

    const result = await applyGitOwnership(projectRoot, ["TestUser"]);
    expect(result.ownershipApplied).toBe(true);

    const ownership = await getOwnership(projectRoot);
    const claimed = [...ownership.values()].find(
      (c) => c.agent === "TestUser" && c.paths.includes("src"),
    );
    expect(claimed).toBeDefined();
  });

  it("dry run does not apply ownership", async () => {
    const { applyGitOwnership } =
      await import("../src/core/coordination/git-ownership.js");

    await setupGitRepo(projectRoot);
    await initHandoff(projectRoot);
    await mkdir(join(projectRoot, "src"), { recursive: true });

    await writeFile(join(projectRoot, "src", "a.ts"), "1");
    await git(projectRoot, "add", ".");
    await git(projectRoot, "commit", "-m", "a");

    const result = await applyGitOwnership(projectRoot, ["TestUser"], {
      dryRun: true,
    });
    expect(result.ownershipApplied).toBe(false);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it("returns empty for non-git directory", async () => {
    const { scanGitHistory } =
      await import("../src/core/coordination/git-ownership.js");

    const stats = await scanGitHistory(projectRoot);
    expect(stats).toEqual([]);
  });

  it("skips node_modules and .git directories", async () => {
    const { scanGitHistory } =
      await import("../src/core/coordination/git-ownership.js");

    await setupGitRepo(projectRoot);
    await mkdir(join(projectRoot, "src"), { recursive: true });

    await writeFile(join(projectRoot, "src", "a.ts"), "1");
    await git(projectRoot, "add", ".");
    await git(projectRoot, "commit", "-m", "a");

    const stats = await scanGitHistory(projectRoot);
    for (const s of stats) {
      for (const dir of s.directories.keys()) {
        expect(dir).not.toMatch(/^(node_modules|\.git|dist|build)/);
      }
    }
  });

  it("formats output with unclaimed suggestions", async () => {
    const { formatGitOwnership } =
      await import("../src/core/coordination/git-ownership.js");

    const result = {
      suggestions: [
        {
          directory: "src",
          suggestedOwner: "claude-code",
          commits: 15,
          percentage: 75,
          alreadyClaimed: false,
        },
        {
          directory: "tests",
          suggestedOwner: "codex",
          commits: 10,
          percentage: 100,
          alreadyClaimed: true,
        },
      ],
      authorStats: [],
      ownershipApplied: false,
    };

    const output = formatGitOwnership(result, true);
    expect(output).toContain("src/");
    expect(output).toContain("claude-code");
    expect(output).toContain("75%");
    expect(output).toContain("unclaimed");
    expect(output).toContain("Add --yes to apply");
  });
});
