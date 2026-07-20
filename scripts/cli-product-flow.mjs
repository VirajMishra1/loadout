import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cli = join(repositoryRoot, "dist", "src", "cli.js");
const temporary = await mkdtemp(join(tmpdir(), "loadout-cli-product-flow-"));
const userHome = join(temporary, "user");
const stateHome = join(temporary, "state");
const project = join(temporary, "project");
const provenanceSource = join(temporary, "reviewed-source");
const librarySource = join(temporary, "library-source");
const codexSkills = join(userHome, ".agents", "skills");
const claudeSkills = join(userHome, ".claude", "skills");
const existingSkill = join(codexSkills, "review");
const activatedSkill = join(codexSkills, "systematic-debugging");
const claudeActivatedSkill = join(claudeSkills, "systematic-debugging");
const claudeExistingSkills = Array.from({ length: 12 }, (_, index) =>
  join(claudeSkills, `existing-${index + 1}`),
);
const reviewedCommit = "a".repeat(40);
const environment = {
  ...process.env,
  LOADOUT_HOME: stateHome,
  LOADOUT_USER_HOME: userHome,
  HOME: userHome,
  USERPROFILE: userHome,
  NO_COLOR: "1",
};

function parseJson(stdout, command) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `${command} did not emit standalone JSON:\n${stdout.slice(0, 2000)}`,
      { cause: error },
    );
  }
}

async function runCli(...args) {
  try {
    return await execFileAsync(process.execPath, [cli, ...args], {
      cwd: repositoryRoot,
      env: environment,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    const stdout = error?.stdout ?? "";
    const stderr = error?.stderr ?? "";
    throw new Error(
      `loadout ${args.join(" ")} failed\n${stdout}${stderr}`.trim(),
      { cause: error },
    );
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

try {
  process.env.LOADOUT_HOME = stateHome;
  process.env.LOADOUT_USER_HOME = userHome;
  process.env.HOME = userHome;
  process.env.USERPROFILE = userHome;

  const reviewContent =
    "---\nname: review\ndescription: Review code carefully with evidence\n---\n\nInspect real code before recommending a change.\n";
  const debuggingContent =
    "---\nname: systematic-debugging\ndescription: Diagnose Python test failures systematically\n---\n\nReproduce, isolate, explain, fix, and verify failures.\n";
  await Promise.all([
    mkdir(existingSkill, { recursive: true }),
    ...claudeExistingSkills.map((directory) =>
      mkdir(directory, { recursive: true }),
    ),
    mkdir(join(provenanceSource, "skills", "review"), { recursive: true }),
    mkdir(join(librarySource, "skills", "systematic-debugging"), {
      recursive: true,
    }),
    mkdir(project, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(existingSkill, "SKILL.md"), reviewContent),
    ...claudeExistingSkills.map((directory, index) =>
      writeFile(
        join(directory, "SKILL.md"),
        `---\nname: existing-${index + 1}\ndescription: Existing Claude skill\n---\n\nPreserve these exact bytes.\n`,
      ),
    ),
    writeFile(
      join(provenanceSource, "skills", "review", "SKILL.md"),
      reviewContent,
    ),
    writeFile(
      join(librarySource, "skills", "systematic-debugging", "SKILL.md"),
      debuggingContent,
    ),
    writeFile(join(project, "requirements.txt"), "pytest==8.3.5\n"),
    writeFile(
      join(project, "test_example.py"),
      "def test_example():\n    assert 1 + 1 == 2\n",
    ),
  ]);

  const [{ detectAgents }, install, provenance, state] = await Promise.all([
    import("../dist/src/core/paths.js"),
    import("../dist/src/core/install.js"),
    import("../dist/src/core/provenance.js"),
    import("../dist/src/core/state.js"),
  ]);
  const codex = (await detectAgents()).find(
    (agent) => agent.id === "codex" && agent.installed,
  );
  const claude = (await detectAgents()).find(
    (agent) => agent.id === "claude-code" && agent.installed,
  );
  assert.ok(codex, "the disposable Codex profile must be detected");
  assert.ok(claude, "the disposable Claude profile must be detected");
  assert.equal(codex.skillsDirectory, codexSkills);
  assert.equal(claude.skillsDirectory, claudeSkills);

  const fixtureCatalog = [
    {
      id: "reviewed-e2e",
      displayName: "Reviewed E2E Source",
      repository: "loadout-test/reviewed-e2e",
      description: "Local immutable source used to verify provenance behavior",
      category: "review",
      tier: "stable",
      license: "MIT",
      components: ["skill"],
      operatingSystems: ["windows", "macos", "linux"],
      source: {
        type: "github",
        url: "https://github.com/loadout-test/reviewed-e2e",
        defaultBranch: "main",
        commit: reviewedCommit,
        evidencePaths: ["skills/review/SKILL.md"],
        verifiedAt: "2026-07-16T00:00:00.000Z",
      },
    },
  ];
  await provenance.buildCatalogSkillIndex({
    catalog: fixtureCatalog,
    fetchSnapshot: async (repository, options) => ({
      repository,
      commit: options.ref,
      path: provenanceSource,
    }),
    now: new Date("2026-07-16T00:00:00.000Z"),
  });

  const libraryPlan = await install.buildSkillPlan(
    librarySource,
    "e2e-reviewed-pack",
    [codex, claude],
  );
  await install.applySkillLibraryBatch([
    {
      plan: libraryPlan,
      metadata: {
        repository: "loadout-test/library-e2e",
        resolvedCommit: reviewedCommit,
        reviewed: true,
      },
    },
  ]);
  assert.equal(
    await pathExists(activatedSkill),
    false,
    "preparing the reviewed library must not activate its skill",
  );
  await Promise.all([
    mkdir(join(activatedSkill, "empty", "nested"), { recursive: true }),
    mkdir(join(claudeActivatedSkill, "empty", "nested"), {
      recursive: true,
    }),
  ]);

  const scan = parseJson(
    (await runCli("scan", "--agents", "codex", "--json")).stdout,
    "scan",
  );
  const scannedReview = scan.skills.find((skill) => skill.name === "review");
  assert.ok(scannedReview, "scan must inventory the existing skill");
  assert.equal(scannedReview.provenance.kind, "catalog-exact");
  assert.equal(scan.provenance.exact, 1);

  const comparison = parseJson(
    (
      await runCli(
        "compare",
        "review",
        "--agent",
        "codex",
        "--offline",
        "--json",
      )
    ).stdout,
    "compare",
  );
  assert.equal(comparison.subject.source, "installed");
  assert.equal(comparison.subject.provenance.kind, "catalog-exact");
  assert.match(comparison.recommendation, /Keep the installed skill/i);

  const optimizeArguments = [
    "optimize",
    "--project",
    project,
    "--agents",
    "codex,claude-code",
    "--limit",
    "13",
    "--pin",
    "e2e-reviewed-pack/systematic-debugging",
    "--json",
  ];
  const preview = parseJson(
    (await runCli(...optimizeArguments)).stdout,
    "optimize preview",
  );
  assert.deepEqual(
    preview.selected.map((item) => item.selector),
    ["e2e-reviewed-pack/systematic-debugging"],
  );
  assert.deepEqual(
    preview.agentPlans.map((item) => ({
      agent: item.agent,
      activeBefore: item.activeBefore,
      capacity: item.capacity,
      additions: item.selected.length,
    })),
    [
      { agent: "codex", activeBefore: 1, capacity: 12, additions: 1 },
      {
        agent: "claude-code",
        activeBefore: 12,
        capacity: 1,
        additions: 1,
      },
    ],
  );
  assert.ok(preview.project.languages.includes("python"));
  assert.equal(
    await pathExists(join(activatedSkill, "SKILL.md")),
    false,
    "optimize preview must not replace empty Codex residue",
  );
  assert.equal(
    await pathExists(join(claudeActivatedSkill, "SKILL.md")),
    false,
    "optimize preview must not replace empty Claude residue",
  );

  const applied = parseJson(
    (await runCli(...optimizeArguments, "--yes")).stdout,
    "optimize apply",
  );
  assert.match(applied.snapshotId, /^[0-9a-f-]+$/i);
  assert.equal(
    await readFile(join(activatedSkill, "SKILL.md"), "utf8"),
    debuggingContent,
    "optimize apply must copy the reviewed bytes into the Codex profile",
  );
  assert.equal(
    await readFile(join(claudeActivatedSkill, "SKILL.md"), "utf8"),
    debuggingContent,
    "optimize apply must copy the reviewed bytes into the Claude profile",
  );
  assert.equal(
    (await state.readInstallState()).activations.find(
      (record) =>
        record.packageId === "e2e-reviewed-pack" &&
        record.unitId === "systematic-debugging",
    )?.activationState,
    "active",
  );

  const rollback = await runCli("rollback", "--snapshot", applied.snapshotId);
  assert.match(rollback.stdout, new RegExp(applied.snapshotId));
  assert.equal(
    await pathExists(join(activatedSkill, "SKILL.md")),
    false,
    "rollback must remove the Codex skill that optimize activated",
  );
  assert.equal(
    await pathExists(join(claudeActivatedSkill, "SKILL.md")),
    false,
    "rollback must remove the Claude skill that optimize activated",
  );
  assert.equal(
    await readFile(join(existingSkill, "SKILL.md"), "utf8"),
    reviewContent,
    "rollback must preserve the pre-existing unmanaged skill byte-for-byte",
  );
  assert.equal(
    await readFile(join(claudeExistingSkills[0], "SKILL.md"), "utf8"),
    "---\nname: existing-1\ndescription: Existing Claude skill\n---\n\nPreserve these exact bytes.\n",
    "rollback must preserve unmanaged Claude skills byte-for-byte",
  );
  assert.equal(
    (await state.readInstallState()).activations.find(
      (record) =>
        record.packageId === "e2e-reviewed-pack" &&
        record.unitId === "systematic-debugging",
    )?.activationState,
    "disabled",
  );

  const afterRollback = parseJson(
    (await runCli(...optimizeArguments)).stdout,
    "optimize after rollback",
  );
  assert.deepEqual(
    afterRollback.selected.map((item) => item.selector),
    ["e2e-reviewed-pack/systematic-debugging"],
    "the rolled-back skill must be eligible for activation again",
  );
  process.stdout.write(
    `CLI product flow passed on ${process.platform}, Node ${process.versions.node}: scan -> compare -> per-agent optimize preview/apply through empty residue -> rollback.\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
