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
});
