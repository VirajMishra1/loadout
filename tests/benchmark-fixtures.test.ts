import { createHash } from "node:crypto";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BENCHMARK_CONTROLS,
  BENCHMARK_FIXTURES,
  BENCHMARK_FIXTURE_SUITE_SHA256,
  BENCHMARK_FIXTURE_SUITE_VERSION,
  benchmarkCampaignFixtureReference,
  benchmarkFixtureSuiteManifest,
  benchmarkFixtureSuiteSha256,
  getBenchmarkFixture,
  gradeBenchmarkFixtureOutput,
  materializeBenchmarkFixture,
  renderBenchmarkFixtureInput,
  validateBenchmarkFixtureSuite,
  verifyMaterializedBenchmarkFixture,
  type BenchmarkFixture,
} from "../src/core/benchmark-fixtures.js";

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

function passingSelections(fixture: BenchmarkFixture): string[] {
  const required = new Set(
    fixture.rubric.criteria
      .filter((criterion) => criterion.kind === "required-selection")
      .map((criterion) =>
        criterion.kind === "ordered-selection" ? "" : criterion.optionId,
      ),
  );
  const ordered = fixture.rubric.criteria.find(
    (criterion) => criterion.kind === "ordered-selection",
  );
  const selections =
    ordered?.kind === "ordered-selection" ? [...ordered.optionIds] : [];
  for (const option of fixture.task.options)
    if (required.has(option.id) && !selections.includes(option.id))
      selections.push(option.id);
  return selections;
}

describe("P16-04 synthetic benchmark fixture suite", () => {
  it("pins seven permissively licensed families and all required controls", () => {
    expect(() => validateBenchmarkFixtureSuite()).not.toThrow();
    expect(BENCHMARK_FIXTURES).toHaveLength(7);
    expect(
      new Set(BENCHMARK_FIXTURES.map((fixture) => fixture.family)),
    ).toEqual(
      new Set([
        "planning-workflow-adherence",
        "code-review",
        "frontend-accessibility",
        "debugging",
        "documentation-freshness",
        "api-design",
        "safe-migration",
      ]),
    );
    for (const fixture of BENCHMARK_FIXTURES) {
      expect(fixture.source).toMatchObject({
        kind: "synthetic",
        license: { spdx: "MIT", textPath: "LICENSE" },
      });
      expect(fixture.source.provenance).toContain("no copied repository");
      expect(fixture.runtime).toMatchObject({
        setup: "materialize-static-files-v1",
        grader: "deterministic-option-selection-v1",
        platforms: ["darwin", "linux", "win32"],
        network: "disabled",
      });
      expect(fixture.fixtureSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(fixture.rubricSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(
        fixture.files.every((file) => sha256(file.content) === file.sha256),
      ).toBe(true);
    }

    expect(new Set(BENCHMARK_CONTROLS.map((control) => control.role))).toEqual(
      new Set([
        "no-skill",
        "negative-control",
        "outdated-guidance",
        "overlap-primary",
        "overlap-secondary",
      ]),
    );
    expect(
      BENCHMARK_CONTROLS.every(
        (control) => sha256(control.instructions) === control.instructionSha256,
      ),
    ).toBe(true);
    expect(
      BENCHMARK_CONTROLS.every(
        (control) =>
          control.source.kind === "synthetic" &&
          control.source.license.spdx === "MIT",
      ),
    ).toBe(true);
    expect(
      BENCHMARK_CONTROLS.every((control) =>
        /no claim|does not claim|no negative outcome|requires real trials/i.test(
          control.outcomeBoundary,
        ),
      ),
    ).toBe(true);
  });

  it("binds a stable suite manifest without trial or provider outcomes", () => {
    const manifest = benchmarkFixtureSuiteManifest();
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.suiteVersion).toBe(BENCHMARK_FIXTURE_SUITE_VERSION);
    expect(benchmarkFixtureSuiteSha256()).toBe(BENCHMARK_FIXTURE_SUITE_SHA256);
    expect(JSON.stringify(manifest)).not.toMatch(
      /passRate|latency|tokens|reportedCost|modelOutput|winner/i,
    );
  });

  it("exports campaign-compatible immutable fixture and rubric references", () => {
    for (const fixture of BENCHMARK_FIXTURES)
      expect(benchmarkCampaignFixtureReference(fixture.id)).toEqual({
        id: fixture.id,
        version: fixture.version,
        fixtureSha256: fixture.fixtureSha256,
        rubricSha256: fixture.rubricSha256,
      });
    expect(() => benchmarkCampaignFixtureReference("unknown-fixture")).toThrow(
      /Unknown benchmark fixture/,
    );
  });

  it("renders source and public options but not hidden rubric decisions", () => {
    const fixture = getBenchmarkFixture("review-tenant-export-v1");
    const input = renderBenchmarkFixtureInput(fixture.id);
    expect(input).toContain("src/export.ts");
    expect(input).toContain("R01:");
    expect(input).toContain("strict JSON");
    expect(input).not.toContain("review-cache-boundary");
    expect(input).not.toContain(fixture.rubricSha256);
    expect(renderBenchmarkFixtureInput(fixture.id)).toBe(input);
  });

  it("deterministically accepts the declared criteria for every family", () => {
    for (const fixture of BENCHMARK_FIXTURES) {
      const output = JSON.stringify({
        schemaVersion: 1,
        fixtureId: fixture.id,
        selectedOptionIds: passingSelections(fixture),
      });
      const first = gradeBenchmarkFixtureOutput(fixture.id, output);
      const second = gradeBenchmarkFixtureOutput(fixture.id, output);
      expect(first).toEqual(second);
      expect(first).toMatchObject({
        fixtureId: fixture.id,
        fixtureSha256: fixture.fixtureSha256,
        rubricSha256: fixture.rubricSha256,
        outputSha256: sha256(output),
        validResponse: true,
        passed: true,
        score: 100,
      });
      expect(first.safetyBoundary).toContain("no model judge");
      expect(JSON.stringify(first)).not.toContain(output);
    }
  });

  it("rejects malformed, oversized, duplicate, and unknown selections", () => {
    const fixture = getBenchmarkFixture("debug-cache-expiry-v1");
    expect(gradeBenchmarkFixtureOutput(fixture.id, "not json")).toMatchObject({
      validResponse: false,
      passed: false,
      score: 0,
      failureCodes: expect.arrayContaining(["response-not-json"]),
    });
    expect(
      gradeBenchmarkFixtureOutput(
        fixture.id,
        JSON.stringify({
          schemaVersion: 1,
          fixtureId: fixture.id,
          selectedOptionIds: ["D01", "D01"],
        }),
      ).failureCodes,
    ).toContain("response-duplicate-selection");
    expect(
      gradeBenchmarkFixtureOutput(
        fixture.id,
        JSON.stringify({
          schemaVersion: 1,
          fixtureId: fixture.id,
          selectedOptionIds: ["UNKNOWN"],
        }),
      ).failureCodes,
    ).toContain("response-unknown-selection");
    expect(
      gradeBenchmarkFixtureOutput(
        fixture.id,
        " ".repeat(fixture.task.responseContract.maximumBytes + 1),
      ).failureCodes,
    ).toContain("response-too-large");
  });

  it("fails forbidden guidance, omissions, and unsafe execution order", () => {
    const workflow = getBenchmarkFixture("workflow-release-guardrails-v1");
    const unsafe = gradeBenchmarkFixtureOutput(
      workflow.id,
      JSON.stringify({
        schemaVersion: 1,
        fixtureId: workflow.id,
        selectedOptionIds: ["W04", "W03", "W02", "W01", "W05"],
      }),
    );
    expect(unsafe.validResponse).toBe(true);
    expect(unsafe.passed).toBe(false);
    expect(unsafe.failureCodes).toEqual(
      expect.arrayContaining([
        "criterion-failed:workflow-order",
        "criterion-failed:workflow-no-force",
      ]),
    );

    const incomplete = gradeBenchmarkFixtureOutput(
      workflow.id,
      JSON.stringify({
        schemaVersion: 1,
        fixtureId: workflow.id,
        selectedOptionIds: ["W01"],
      }),
    );
    expect(incomplete.passed).toBe(false);
    expect(incomplete.score).toBeLessThan(100);
  });

  it("materializes exact bytes and detects edits, extras, and symlinks", async () => {
    const parent = await mkdtemp(join(tmpdir(), "loadout-benchmark-fixture-"));
    const root = join(parent, "fixture");
    const fixture = getBenchmarkFixture("api-batch-jobs-v1");
    const report = await materializeBenchmarkFixture(fixture.id, root);
    expect(report).toMatchObject({
      fixtureId: fixture.id,
      fixtureSha256: fixture.fixtureSha256,
    });
    await expect(
      verifyMaterializedBenchmarkFixture(fixture.id, root),
    ).resolves.toBeUndefined();
    expect(await readFile(join(root, "REQUIREMENTS.md"), "utf8")).toBe(
      fixture.files.find((file) => file.path === "REQUIREMENTS.md")!.content,
    );

    await writeFile(join(root, "REQUIREMENTS.md"), "tampered", "utf8");
    await expect(
      verifyMaterializedBenchmarkFixture(fixture.id, root),
    ).rejects.toThrow(/pinned hash/);

    const extraRoot = join(parent, "extra");
    await materializeBenchmarkFixture(fixture.id, extraRoot);
    await writeFile(join(extraRoot, "unexpected.txt"), "extra", "utf8");
    await expect(
      verifyMaterializedBenchmarkFixture(fixture.id, extraRoot),
    ).rejects.toThrow(/inventory/);

    const linkRoot = join(parent, "link");
    await materializeBenchmarkFixture(fixture.id, linkRoot);
    await symlink(join(linkRoot, "REQUIREMENTS.md"), join(linkRoot, "link.md"));
    await expect(
      verifyMaterializedBenchmarkFixture(fixture.id, linkRoot),
    ).rejects.toThrow(/symbolic link/);
    await expect(
      materializeBenchmarkFixture(fixture.id, linkRoot),
    ).rejects.toThrow(/must be empty/);
  });
});
