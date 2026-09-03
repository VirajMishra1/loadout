import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..");

async function repositoryFile(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

describe("community health files", () => {
  it("gives contributors one accurate pre-release gate", async () => {
    const [contributing, pullRequestTemplate] = await Promise.all([
      repositoryFile("CONTRIBUTING.md"),
      repositoryFile(".github/pull_request_template.md"),
    ]);

    expect(contributing).toContain("npm run verify:full");
    expect(pullRequestTemplate).toContain("npm run verify:full");
    expect(contributing).toContain("SECURITY.md");
  });

  it("provides actionable issue forms and conduct reporting guidance", async () => {
    const [bugReport, featureRequest, issueConfig, conduct] = await Promise.all(
      [
        repositoryFile(".github/ISSUE_TEMPLATE/bug_report.yml"),
        repositoryFile(".github/ISSUE_TEMPLATE/feature_request.yml"),
        repositoryFile(".github/ISSUE_TEMPLATE/config.yml"),
        repositoryFile("CODE_OF_CONDUCT.md"),
      ],
    );

    expect(bugReport).toContain("Loadout version");
    expect(bugReport).toContain("Steps to reproduce");
    expect(featureRequest).toContain("Problem");
    expect(issueConfig).toContain("security/advisories/new");
    expect(conduct).toMatch(/report(ed|ing)|enforcement/i);
    expect(conduct).toContain("SECURITY.md");
  });
});
