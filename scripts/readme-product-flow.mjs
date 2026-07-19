import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const liveCatalog = process.argv.includes("--live-catalog");
const jsonOutput = process.argv.includes("--json");
const temporary = await mkdtemp(join(tmpdir(), "loadout-readme-flow-"));
const buildRoot = await mkdtemp(join(repositoryRoot, ".readme-build-"));
const cli = join(buildRoot, "src", "cli.js");
const userHome = join(temporary, "user");
const stateHome = join(temporary, "state");
const project = join(temporary, "project");
const fixtureSource = join(temporary, "reviewed-source");
const codexSkills = join(userHome, ".agents", "skills");
const sentinel = join(codexSkills, "user-sentinel", "note.txt");
const activeSkill = join(codexSkills, "readme-proof", "SKILL.md");
const manifestPath = join(project, "loadout.json");
const lockPath = join(project, "loadout.lock");
const reviewedCommit = "a".repeat(40);
const sentinelBytes = "unmanaged user file — do not replace\n";
const skillBytes =
  "---\nname: readme-proof\ndescription: Prove the documented Loadout flow\n---\n\nVerify real outcomes, not slogans.\n";
const environment = {
  ...process.env,
  LOADOUT_HOME: stateHome,
  LOADOUT_USER_HOME: userHome,
  HOME: userHome,
  USERPROFILE: userHome,
  NO_COLOR: "1",
};
let liveEvidence;
let stableSnapshotId;
let stablePackageIds;
let stableInstalledFiles;
let stableLibraryPaths;

function parseJson(stdout, command) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${command} did not emit standalone JSON:\n${stdout}`, {
      cause: error,
    });
  }
}

async function runCli(...args) {
  try {
    return await execFileAsync(process.execPath, [cli, ...args], {
      cwd: repositoryRoot,
      env: environment,
      timeout: liveCatalog ? 180_000 : 30_000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(
      `loadout ${args.join(" ")} failed\n${error?.stdout ?? ""}${error?.stderr ?? ""}`.trim(),
      { cause: error },
    );
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

try {
  await execFileAsync(
    process.execPath,
    [
      join(repositoryRoot, "node_modules", "typescript", "bin", "tsc"),
      "-p",
      join(repositoryRoot, "tsconfig.json"),
      "--outDir",
      buildRoot,
    ],
    {
      cwd: repositoryRoot,
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    },
  );
  Object.assign(process.env, environment);
  await Promise.all([
    mkdir(join(fixtureSource, "skills", "readme-proof"), { recursive: true }),
    mkdir(join(sentinel, ".."), { recursive: true }),
    mkdir(project, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(fixtureSource, "skills", "readme-proof", "SKILL.md"),
      skillBytes,
    ),
    writeFile(sentinel, sentinelBytes),
    writeFile(
      join(project, "package.json"),
      '{"name":"readme-flow","private":true}\n',
    ),
  ]);

  const [paths, install, catalogInstall, state, activeSet, manifest, audit] =
    await Promise.all([
      import(pathToFileURL(join(buildRoot, "src", "core", "paths.js"))),
      import(pathToFileURL(join(buildRoot, "src", "core", "install.js"))),
      import(
        pathToFileURL(join(buildRoot, "src", "core", "catalog-install.js"))
      ),
      import(pathToFileURL(join(buildRoot, "src", "core", "state.js"))),
      import(pathToFileURL(join(buildRoot, "src", "core", "active-set.js"))),
      import(pathToFileURL(join(buildRoot, "src", "core", "manifest.js"))),
      import(pathToFileURL(join(buildRoot, "src", "core", "audit.js"))),
    ]);
  const codex = (await paths.detectAgents()).find(
    (agent) => agent.id === "codex" && agent.installed,
  );
  assert.ok(codex, "the disposable Codex profile must be detected");
  assert.equal(codex.skillsDirectory, codexSkills);

  if (liveCatalog) {
    const stable = await catalogInstall.prepareCatalogInstall(
      { mode: "stable", packageIds: [] },
      { detectedAgents: [codex] },
    );
    assert.ok(
      stable.entries.length,
      "the pinned Stable profile must prepare packages",
    );
    assert.ok(
      stable.entries.every(
        (entry) =>
          entry.package.source?.commit &&
          entry.metadata?.resolvedCommit?.toLowerCase() ===
            entry.package.source.commit.toLowerCase(),
      ),
      "every live Stable package must resolve to its reviewed pinned commit",
    );
    const stableSnapshot = await catalogInstall.applyPreparedCatalogInstall(
      stable,
      {
        approveRisk: true,
      },
    );
    stableSnapshotId = stableSnapshot;
    stablePackageIds = new Set(stable.entries.map((entry) => entry.package.id));
    const stableState = await state.readInstallState();
    const stableRecords = stableState.installs.filter((entry) =>
      stablePackageIds.has(entry.packageId),
    );
    stableInstalledFiles = [];
    assert.equal(stableRecords.length, stable.entries.length);
    for (const record of stableRecords) {
      assert.ok(
        record.files.length,
        `${record.packageId} must persist file hashes`,
      );
      for (const file of record.files) {
        const path = activeSet.managedFileReadPath(
          record.packageId,
          file.path,
          stableState.activations ?? [],
        );
        const bytes = await readFile(path);
        stableInstalledFiles.push({ path, bytes });
        assert.equal(
          createHash("sha256").update(bytes).digest("hex"),
          file.sha256,
        );
      }
    }
    stableLibraryPaths = (stableState.activations ?? [])
      .filter((entry) => stablePackageIds.has(entry.packageId))
      .map((entry) => entry.libraryPath);
    assert.ok(stableInstalledFiles.length);
    assert.ok(stableLibraryPaths.length);
    assert.equal(
      await exists(join(stateHome, "snapshots", `${stableSnapshot}.json`)),
      true,
    );
    liveEvidence = {
      packages: stable.entries.length,
      pinnedCommits: true,
      persistedRecords: true,
      fileHashes: true,
      snapshot: true,
    };
  }

  const plan = await install.buildSkillPlan(fixtureSource, "readme-fixture", [
    codex,
  ]);
  const librarySnapshot = await install.applySkillLibraryBatch([
    {
      plan,
      metadata: {
        repository: "loadout-test/readme-fixture",
        resolvedCommit: reviewedCommit,
        reviewed: true,
      },
    },
  ]);
  assert.equal(await exists(activeSkill), false);

  const libraryState = await state.readInstallState();
  const installRecord = libraryState.installs.find(
    (entry) => entry.packageId === "readme-fixture",
  );
  const disabledRecord = libraryState.activations?.find(
    (entry) => entry.packageId === "readme-fixture",
  );
  assert.ok(
    installRecord?.files.length,
    "install state must record managed files",
  );
  assert.ok(disabledRecord, "library state must record the skill");
  assert.equal(disabledRecord.activationState, "disabled");
  assert.equal(disabledRecord.reviewState, "reviewed");
  assert.equal(
    await exists(join(stateHome, "snapshots", `${librarySnapshot}.json`)),
    true,
  );
  for (const file of installRecord.files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    const bytes = await readFile(
      activeSet.managedFileReadPath(
        installRecord.packageId,
        file.path,
        libraryState.activations ?? [],
      ),
    );
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
  }

  const optimizeArgs = [
    "optimize",
    "--project",
    project,
    "--agents",
    "codex",
    "--limit",
    liveCatalog ? "200" : "1",
    "--pin",
    "readme-fixture/readme-proof",
    "--json",
  ];
  const preview = parseJson(
    (await runCli(...optimizeArgs)).stdout,
    "optimize preview",
  );
  assert.deepEqual(
    preview.selected.map((item) => item.selector),
    ["readme-fixture/readme-proof"],
  );
  assert.equal(
    await exists(activeSkill),
    false,
    "preview must remain read-only",
  );

  const applied = parseJson(
    (await runCli(...optimizeArgs, "--yes")).stdout,
    "optimize apply",
  );
  assert.equal(await readFile(activeSkill, "utf8"), skillBytes);
  assert.equal(
    await exists(join(stateHome, "snapshots", `${applied.snapshotId}.json`)),
    true,
  );
  const activeState = await state.readInstallState();
  assert.equal(
    activeState.activations?.find(
      (entry) => entry.packageId === "readme-fixture",
    )?.activationState,
    "active",
  );

  const manifestValue = {
    schemaVersion: 1,
    name: "readme-product-flow",
    scope: "project",
    agents: ["codex"],
    profile: "maximum",
    packages: [
      {
        id: "readme-fixture",
        source: { type: "local", path: fixtureSource },
      },
    ],
  };
  await writeFile(manifestPath, `${JSON.stringify(manifestValue, null, 2)}\n`);
  await manifest.writeLockfile(manifest.parseManifest(manifestValue), lockPath);
  const auditReport = await audit.auditLoadout(manifestPath, lockPath);
  assert.equal(auditReport.valid, true, JSON.stringify(auditReport.findings));
  assert.equal(
    auditReport.findings.some((finding) => finding.level === "error"),
    false,
  );

  const card = parseJson((await runCli("card", "--json")).stdout, "card");
  assert.deepEqual(Object.keys(card).sort(), [
    "agents",
    "claimBoundary",
    "generatedAt",
    "privacy",
    "schemaVersion",
    "totals",
  ]);
  const serializedCard = JSON.stringify(card);
  for (const privateValue of [
    temporary,
    project,
    fixtureSource,
    "loadout-test/readme-fixture",
  ])
    assert.equal(serializedCard.includes(privateValue), false);
  assert.match(card.claimBoundary, /not .*proof of task improvement/i);
  assert.match(card.privacy, /no project paths/i);

  await runCli("rollback", "--snapshot", applied.snapshotId);
  const restoredState = await state.readInstallState();
  assert.equal(await exists(activeSkill), false);
  assert.equal(
    restoredState.activations?.find(
      (entry) => entry.packageId === "readme-fixture",
    )?.activationState,
    "disabled",
  );
  assert.equal(await readFile(sentinel, "utf8"), sentinelBytes);

  if (liveEvidence) {
    assert.ok(stableSnapshotId);
    assert.ok(stablePackageIds);
    assert.ok(stableInstalledFiles);
    assert.ok(stableLibraryPaths);
    await runCli("rollback", "--snapshot", stableSnapshotId);
    const stableRestoredState = await state.readInstallState();
    assert.equal(
      stableRestoredState.installs.some((entry) =>
        stablePackageIds.has(entry.packageId),
      ),
      false,
    );
    for (const file of stableInstalledFiles) {
      assert.ok(file.bytes.length, `${file.path} must contain installed bytes`);
      assert.equal(
        await exists(file.path),
        false,
        `${file.path} must be removed by Stable rollback`,
      );
    }
    for (const path of stableLibraryPaths)
      assert.equal(
        await exists(path),
        false,
        `${path} must be removed by Stable rollback`,
      );
    assert.equal(await readFile(sentinel, "utf8"), sentinelBytes);
    liveEvidence.rollback = true;
    liveEvidence.filesystemRestoration = true;
  }

  const result = {
    build: "isolated",
    mode: liveCatalog ? "live-catalog" : "offline-fixture",
    ...(liveEvidence ? { liveCatalog: liveEvidence } : {}),
    verified: {
      stateDirectories:
        (await exists(stateHome)) &&
        (await exists(join(stateHome, "snapshots"))) &&
        (await exists(disabledRecord.libraryPath)),
      installRecords: Boolean(installRecord),
      fileHashes: installRecord.files.every((file) =>
        /^[a-f0-9]{64}$/.test(file.sha256),
      ),
      snapshots: true,
      libraryTransitions: true,
      manifestLockConsistency: auditReport.valid,
      privacySafeCard: true,
      rollbackRestoration: true,
      unmanagedSentinelPreserved: true,
    },
  };
  assert.ok(Object.values(result.verified).every(Boolean));
  process.stdout.write(
    jsonOutput
      ? `${JSON.stringify(result)}\n`
      : `README product flow passed (${result.mode}): library install -> activate -> manifest/lock audit -> privacy card -> rollback.\n`,
  );
} finally {
  await Promise.all([
    rm(temporary, { recursive: true, force: true }),
    rm(buildRoot, { recursive: true, force: true }),
  ]);
}
