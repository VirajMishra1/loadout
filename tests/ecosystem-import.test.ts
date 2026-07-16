import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  parseBoundedYaml,
  planApmImportFiles,
  planApmLockEvidenceImport,
  planApmManifestImport,
  planOpenPackageImportFiles,
  planOpenPackageIndexEvidenceImport,
  planOpenPackageManifestImport,
} from "../src/core/ecosystem-import.js";

const fixture = (name: string) =>
  new URL(`./fixtures/ecosystem-import/${name}`, import.meta.url);

describe("bounded ecosystem YAML parser", () => {
  it("parses the supported mappings, sequences, comments, and flow sequences", () => {
    expect(
      parseBoundedYaml(`
name: fixture # comment
targets: [codex, "claude"]
dependencies:
  - name: pack
    url: https://github.com/example/pack.git#main
enabled: true
empty: []
`),
    ).toEqual({
      name: "fixture",
      targets: ["codex", "claude"],
      dependencies: [
        {
          name: "pack",
          url: "https://github.com/example/pack.git#main",
        },
      ],
      enabled: true,
      empty: [],
    });
  });

  it("accepts OpenAPM's emitted indentationless lockfile sequences", () => {
    expect(
      parseBoundedYaml(`
lockfile_version: '1'
dependencies:
- repo_url: _local/example
  name: example
deployments:
- kind: project-relative
  target: agents
`),
    ).toEqual({
      lockfile_version: "1",
      dependencies: [{ repo_url: "_local/example", name: "example" }],
      deployments: [{ kind: "project-relative", target: "agents" }],
    });
  });

  it("accepts OpenAPM's emitted scalar explicit keys for long file paths", () => {
    expect(
      parseBoundedYaml(`
hashes:
  ? .agents/skills/example/a-very-long-generated-evidence-path.json
  : sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`),
    ).toEqual({
      hashes: {
        ".agents/skills/example/a-very-long-generated-evidence-path.json":
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });
  });

  it.each([
    ["anchors", "base: &base value\ncopy: *base\n"],
    ["merge keys", "base:\n  value: one\nitem:\n  <<: base\n"],
    ["tags", "value: !env SECRET\n"],
    ["duplicate keys", "name: one\nname: two\n"],
    ["block scalars", "script: |\n  echo unsafe\n"],
  ])("rejects %s instead of guessing", (_label, source) => {
    expect(() => parseBoundedYaml(source)).toThrow();
  });
});

describe("OpenAPM v0.1 read-only import planning", () => {
  it("maps supported package pointers and loss-reports everything else", async () => {
    const source = await readFile(fixture("apm.yml"), "utf8");
    const plan = planApmManifestImport(source);

    expect(plan.packageName).toBe("interoperable-agent");
    expect(plan.packageVersion).toBe("1.2.3");
    expect(plan.source.text).toBe(source);
    expect(plan.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.executionBoundary).toEqual(
      expect.objectContaining({
        readOnly: true,
        externalCommandsRun: false,
        networkRequestsMade: false,
        filesWritten: false,
        installReady: false,
      }),
    );
    expect(plan.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: {
            type: "github",
            repository: "anthropics/skills",
            ref: "v1.0.0",
            path: "skills/frontend-design",
          },
          disposition: "ready-for-loadout-review",
        }),
        expect.objectContaining({
          source: {
            type: "github",
            repository: "example/review-pack",
            ref: "0123456789abcdef0123456789abcdef01234567",
            path: "skills/review",
          },
        }),
        expect.objectContaining({
          source: { type: "local", path: "./local-skill" },
        }),
        expect.objectContaining({
          dependencyKind: "mcp",
          disposition: "manual-review-only",
        }),
      ]),
    );
    expect(plan.unsupported.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(["scripts", "target", "x-owner-note"]),
    );
    expect(plan.warnings.join(" ")).toContain("not executed");
  });

  it("imports immutable lock evidence without claiming it was verified", async () => {
    const source = await readFile(fixture("apm.lock.yaml"), "utf8");
    const plan = planApmLockEvidenceImport(source);

    expect(plan.artifact).toBe("lock-evidence");
    expect(plan.trust.level).toBe("integrity-evidence-present");
    expect(plan.trust.uncertainties.join(" ")).toContain("not fetched");
    expect(plan.candidates[0]).toEqual(
      expect.objectContaining({
        source: {
          type: "github",
          repository: "anthropics/skills",
          ref: "0123456789abcdef0123456789abcdef01234567",
          path: "skills/frontend-design",
        },
        resolvedCommit: "0123456789abcdef0123456789abcdef01234567",
        integrity:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    );
    expect(plan.candidates[1].warnings.join(" ")).toContain("Local");
    expect(plan.unsupported.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(["attestations", "mcp_servers", "x-lock-note"]),
    );
  });

  it("rejects malformed immutable evidence", () => {
    expect(() =>
      planApmLockEvidenceImport(`
lockfile_version: '1'
dependencies:
  - name: broken
    resolved_commit: not-a-sha
`),
    ).toThrow(/40-hex Git SHA/);
  });

  it("recognizes per-file hashes as unverified integrity evidence", () => {
    const plan = planApmLockEvidenceImport(`
lockfile_version: '1'
dependencies:
  - name: file-hashed
    local_path: ./file-hashed
    deployed_file_hashes:
      SKILL.md: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`);
    expect(plan.trust.level).toBe("integrity-evidence-present");
    expect(plan.trust.evidence.join(" ")).toContain("1 declared");
  });

  it("offers filesystem-ready API exports while remaining read-only", async () => {
    const result = await planApmImportFiles(
      fixture("apm.yml").pathname,
      fixture("apm.lock.yaml").pathname,
    );
    expect(result.manifest.candidates.length).toBe(5);
    expect(result.lockEvidence?.candidates.length).toBe(2);
    expect(result.manifest.source.filename).toContain("apm.yml");
  });
});

describe("OpenPackage current-format read-only import planning", () => {
  it("maps Git/local declarations and requires registry resolution", async () => {
    const source = await readFile(fixture("openpackage.yml"), "utf8");
    const plan = planOpenPackageManifestImport(source);

    expect(plan.packageName).toBe("openpackage-fixture");
    expect(plan.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: {
            type: "github",
            repository: "example/skills",
            ref: "v2.0.0",
            path: "skills/frontend",
          },
          disposition: "ready-for-loadout-review",
        }),
        expect.objectContaining({
          source: { type: "local", path: "../local-pack" },
        }),
        expect.objectContaining({
          source: {
            type: "remote-registry",
            registry: "https://openpackage.dev",
            name: "registry-pack",
            version: "^1.2.0",
          },
          disposition: "requires-resolution",
        }),
        expect.objectContaining({
          id: "partial-pack",
          disposition: "manual-review-only",
        }),
      ]),
    );
    expect(plan.unsupported.map((entry) => entry.path)).toContain(
      "unknown-future-field",
    );
    expect(plan.executionBoundary.externalCommandsRun).toBe(false);
  });

  it("treats the workspace index as evidence, never as a portable lock", async () => {
    const source = await readFile(fixture("openpackage.index.yml"), "utf8");
    const plan = planOpenPackageIndexEvidenceImport(source);

    expect(plan.trust.level).toBe("integrity-evidence-present");
    expect(plan.trust.uncertainties.join(" ")).toContain("not a portable");
    expect(plan.candidates).toHaveLength(2);
    expect(
      plan.candidates.every(
        (candidate) => candidate.disposition === "manual-review-only",
      ),
    ).toBe(true);
    expect(plan.unsupported.map((entry) => entry.path)).toContain(
      "x-index-note",
    );
  });

  it("reads a manifest and optional index through the CLI-ready file API", async () => {
    const result = await planOpenPackageImportFiles(
      fixture("openpackage.yml").pathname,
      fixture("openpackage.index.yml").pathname,
    );
    expect(result.manifest.candidates).toHaveLength(5);
    expect(result.lockEvidence?.candidates).toHaveLength(2);
    expect(result.lockEvidence?.executionBoundary.filesWritten).toBe(false);
  });
});
