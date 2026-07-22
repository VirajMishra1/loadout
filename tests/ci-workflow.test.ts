import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

function jobBlock(workflow: string, name: string): string {
  const start = workflow.indexOf(`  ${name}:\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = [...workflow.matchAll(/^ {2}[A-Za-z0-9_-]+:\s*$/gm)]
    .map((match) => match.index)
    .find((index) => index > start);
  return workflow.slice(start, next);
}

describe("history-dependent workflow jobs", () => {
  it("runs the canonical release verification suite on ordinary pushes and pull requests", async () => {
    const [ci, packageJson] = await Promise.all([
      readFile(".github/workflows/ci.yml", "utf8"),
      readFile("package.json", "utf8"),
    ]);
    const verifyJob = jobBlock(ci, "verify");
    const scripts = (
      JSON.parse(packageJson) as { scripts: Record<string, string> }
    ).scripts;

    expect(verifyJob).toContain("run: npm run verify");
    for (const releaseCriticalCheck of [
      "format:check",
      "lint",
      "typecheck",
      "check:evidence",
      "test:e2e:cli",
      "test:e2e:readme",
      "test:package",
      "test:performance",
    ]) {
      expect(scripts.verify).toContain(`npm run ${releaseCriticalCheck}`);
    }
  });

  it("fetches full history before validating historical release evidence", async () => {
    const [ci, release] = await Promise.all([
      readFile(".github/workflows/ci.yml", "utf8"),
      readFile(".github/workflows/release.yml", "utf8"),
    ]);
    for (const block of [
      jobBlock(ci, "verify"),
      jobBlock(ci, "cross-platform"),
      jobBlock(release, "publish"),
    ]) {
      expect(block).toMatch(
        /uses: actions\/checkout@[^\n]+\n\s+with:\n(?:\s+[^\n]+\n)*?\s+fetch-depth: 0/m,
      );
    }
  });

  it("lets discovery refresh commits trigger CI on the new main head", async () => {
    const discovery = await readFile(
      ".github/workflows/daily-discovery.yml",
      "utf8",
    );

    expect(discovery).not.toMatch(
      /\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]/i,
    );
  });
});
