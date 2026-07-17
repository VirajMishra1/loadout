#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");

function failure(claimId, observed, authoritativeSource, remediation) {
  return { claimId, observed, authoritativeSource, remediation };
}

function portablePath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").includes("..")
  );
}

function isRepositoryCommand(reference) {
  return /^(?:npm|node|npx)\s/.test(reference);
}

function referencedNpmScript(command) {
  const run = /^npm run ([a-z0-9:_-]+)\b/i.exec(command);
  if (run) return run[1];
  if (/^npm test\b/i.test(command)) return "test";
  return undefined;
}

function presentCapability(summary) {
  return /\b(?:is|are|can|has|have|provides?|supports?|installs?|runs?|uses?|keeps?|stores?|writes?|restores?|exposes?|presents?|manages?)\b/i.test(
    summary,
  );
}

function normalizeProse(value) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function logicalShellLines(block) {
  const logical = [];
  let current = "";
  for (const sourceLine of block.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    current = current ? `${current} ${line}` : line;
    if (current.endsWith("\\")) {
      current = current.slice(0, -1).trimEnd();
      continue;
    }
    logical.push(current);
    current = "";
  }
  if (current) logical.push(current);
  return logical;
}

/** Extract documented Loadout invocations only from shell code fences. */
export function documentedLoadoutCommands(readme) {
  const commands = [];
  for (const fence of readme.matchAll(
    /```(?:bash|sh|shell)?[ \t]*\r?\n([\s\S]*?)```/gi,
  )) {
    for (const line of logicalShellLines(fence[1])) {
      const uncommented = line.split(/\s+#\s*/u, 1)[0];
      for (const segment of uncommented.split(/\s+(?:\||&&|;)\s*/u)) {
        const start = segment.search(/\bloadout(?=\s|$)/);
        if (start !== -1) commands.push(segment.slice(start).trim());
      }
    }
  }
  return [...new Set(commands)].sort();
}

function helpCommands(help) {
  const lines = help.split(/\r?\n/);
  const start = lines.findIndex((line) => line === "Commands:");
  if (start === -1) return new Set();
  const commands = new Set();
  for (const line of lines.slice(start + 1)) {
    const entry = /^ {2}(\S+)/.exec(line);
    if (!entry) {
      if (/^\S/.test(line)) break;
      continue;
    }
    const token = entry[1];
    if (!token || token === "help") continue;
    for (const alias of token.split("|")) commands.add(alias);
  }
  return commands;
}

function isoTimestamp(value) {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function commandTokens(command) {
  return command
    .trim()
    .split(/\s+/)
    .slice(1)
    .filter((token) => token && !token.startsWith("-"));
}

/** Validate command paths by executing the compiled Commander's help tree. */
export function auditDocumentedCommands({ readme, cliPath }) {
  const failures = [];
  const helpCache = new Map();
  const loadHelp = (prefix) => {
    const key = prefix.join("\u0000");
    if (helpCache.has(key)) return helpCache.get(key);
    const result = spawnSync(process.execPath, [cliPath, ...prefix, "--help"], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
      timeout: 30_000,
    });
    const loaded =
      result.status === 0
        ? { ok: true, help: result.stdout }
        : {
            ok: false,
            error:
              result.error?.message || result.stderr || `exit ${result.status}`,
          };
    helpCache.set(key, loaded);
    return loaded;
  };

  for (const command of documentedLoadoutCommands(readme)) {
    const tokens = commandTokens(command);
    let prefix = [];
    for (const token of tokens) {
      const loaded = loadHelp(prefix);
      if (!loaded.ok) {
        failures.push(
          failure(
            "product.scope",
            `Could not read built CLI help for 'loadout ${prefix.join(" ") || "--help"}': ${loaded.error}`,
            cliPath,
            "Run `npm run build`, then correct the CLI build or the documented command.",
          ),
        );
        break;
      }
      const children = helpCommands(loaded.help);
      if (children.size === 0) break;
      if (!children.has(token)) {
        failures.push(
          failure(
            "product.scope",
            `Documented command '${command}' is absent from built CLI help at 'loadout ${prefix.join(" ") || "<root>"}'.`,
            `${cliPath} ${prefix.join(" ")} --help`.replace(/\s+/g, " "),
            "Correct the README command or register the command in the compiled Commander tree.",
          ),
        );
        break;
      }
      prefix = [...prefix, token];
    }
  }
  return failures;
}

async function hasSignedBenchmarkRun(root, evidence) {
  const envelopePaths = evidence.filter((path) => /\.json$/i.test(path));
  const keyPaths = evidence.filter((path) => /\.(?:pem|pub)$/i.test(path));
  if (!envelopePaths.length || !keyPaths.length) return false;
  const { verifyBenchmarkTrustEvidence } =
    await import("../src/core/benchmark-trust.ts");
  for (const envelopePath of envelopePaths) {
    let envelope;
    try {
      envelope = JSON.parse(
        await readFile(resolve(root, envelopePath), "utf8"),
      );
    } catch {
      continue;
    }
    for (const keyPath of keyPaths) {
      try {
        const publicKey = await readFile(resolve(root, keyPath), "utf8");
        const evidenceValue = verifyBenchmarkTrustEvidence(envelope, publicKey);
        if (
          evidenceValue.events.some(
            (event) => event.payload.type === "run-completed",
          )
        )
          return true;
      } catch {
        // A malformed, mismatched, or unsigned artifact is not evidence.
      }
    }
  }
  return false;
}

async function hasStructuredHumanReview(root, evidence) {
  for (const path of evidence.filter((value) => /\.json$/i.test(value))) {
    let review;
    try {
      review = JSON.parse(await readFile(resolve(root, path), "utf8"));
    } catch {
      continue;
    }
    if (
      review?.schemaVersion === 1 &&
      typeof review.reviewer === "string" &&
      review.reviewer.trim().length > 0 &&
      isoTimestamp(review.reviewedAt) &&
      typeof review.reviewedSourceCommit === "string" &&
      /^[a-f0-9]{40}$/i.test(review.reviewedSourceCommit) &&
      typeof review.scope === "string" &&
      review.scope.trim().length > 0 &&
      Array.isArray(review.findings) &&
      review.findings.length > 0 &&
      review.findings.every(
        (finding) => typeof finding === "string" && finding.trim().length > 0,
      ) &&
      typeof review.decision === "string" &&
      review.decision.trim().length > 0
    )
      return true;
  }
  return false;
}

async function hasSignedDatedLiveEvidence(root, evidence) {
  const envelopePaths = evidence.filter((path) => /\.json$/i.test(path));
  const keyPaths = evidence.filter((path) => /\.(?:pem|pub)$/i.test(path));
  if (!envelopePaths.length || !keyPaths.length) return false;
  const { verifyEnvelope } = await import("../src/core/signing.ts");
  for (const envelopePath of envelopePaths) {
    let envelope;
    try {
      envelope = JSON.parse(
        await readFile(resolve(root, envelopePath), "utf8"),
      );
    } catch {
      continue;
    }
    for (const keyPath of keyPaths) {
      try {
        const publicKey = await readFile(resolve(root, keyPath), "utf8");
        if (!verifyEnvelope(envelope, publicKey).valid) continue;
        const payload = envelope.payload;
        if (
          payload?.schemaVersion === 1 &&
          payload.evidenceVersion === "loadout-live-verification-v1" &&
          payload.result === "verified" &&
          typeof payload.target === "string" &&
          payload.target.trim().length > 0 &&
          isoTimestamp(payload.verifiedAt) &&
          envelope.createdAt === payload.verifiedAt
        )
          return true;
      } catch {
        // Missing keys and invalid signatures remain explicitly unverified.
      }
    }
  }
  return false;
}

function releaseCommandFailures(releaseIndex, packageJson) {
  const failures = [];
  if (releaseIndex.releaseBlocked && !(releaseIndex.blockers ?? []).length)
    failures.push(
      failure(
        "release.state",
        "Release evidence index is blocked without an actionable blocker.",
        "src/core/release-claims.ts",
        "Add the concrete blocker to the release index, then resolve it without weakening the boundary.",
      ),
    );
  for (const blocker of releaseIndex.blockers ?? [])
    failures.push(
      failure(
        "release.state",
        blocker,
        "src/core/release-claims.ts",
        "Resolve the release evidence blocker without weakening its stated boundary.",
      ),
    );
  for (const claim of releaseIndex.claims ?? []) {
    for (const command of claim.evidence?.commands ?? []) {
      const script = referencedNpmScript(command);
      if (script && !packageJson.scripts?.[script])
        failures.push(
          failure(
            claim.id,
            `Release evidence references missing package script '${script}' via '${command}'.`,
            "package.json#scripts",
            `Restore the '${script}' script or update the release evidence index to an executable command.`,
          ),
        );
    }
  }
  return failures;
}

/** Audit a README and claim manifest using only checked-in/offline evidence. */
export async function auditReadmeClaims({
  root,
  readme,
  manifest,
  packageJson,
  facts,
  releaseIndex,
  cliPath,
}) {
  const failures = [];
  const claims = Array.isArray(manifest?.claims) ? manifest.claims : [];
  const seen = new Set();
  for (const claim of claims) {
    if (seen.has(claim.id))
      failures.push(
        failure(
          claim.id,
          `Manifest contains duplicate claim ID '${claim.id}'.`,
          "docs/evidence/readme-claims.json",
          "Keep one authoritative entry for each stable claim ID.",
        ),
      );
    seen.add(claim.id);
  }

  try {
    const { parseReadmeClaimManifest } =
      await import("../src/core/readme-claims.ts");
    parseReadmeClaimManifest(manifest);
  } catch (error) {
    if (!failures.some((item) => /duplicate/i.test(item.observed)))
      failures.push(
        failure(
          "manifest.schema",
          error instanceof Error ? error.message : String(error),
          "src/shared/schemas.ts#readmeClaimManifestSchema",
          "Correct the checked-in manifest to satisfy the strict schema.",
        ),
      );
  }

  for (const claim of claims) {
    for (const reference of claim.evidence ?? []) {
      if (isRepositoryCommand(reference)) {
        const script = referencedNpmScript(reference);
        if (script && !packageJson.scripts?.[script])
          failures.push(
            failure(
              claim.id,
              `Evidence command '${reference}' references missing package script '${script}'.`,
              "package.json#scripts",
              `Restore the '${script}' script or point the claim at an executable deterministic command.`,
            ),
          );
        continue;
      }
      if (!portablePath(reference)) {
        failures.push(
          failure(
            claim.id,
            `Evidence path '${reference}' is not a safe repository-relative path.`,
            "docs/evidence/readme-claims.json",
            "Use a portable path inside the repository.",
          ),
        );
        continue;
      }
      const target = resolve(root, reference);
      const fromRoot = relative(root, target);
      if (fromRoot.startsWith(`..${sep}`) || fromRoot === "..") {
        failures.push(
          failure(
            claim.id,
            `Evidence path '${reference}' escapes the repository root.`,
            "docs/evidence/readme-claims.json",
            "Use a repository-owned evidence path.",
          ),
        );
        continue;
      }
      try {
        await access(target);
      } catch {
        failures.push(
          failure(
            claim.id,
            `Authoritative evidence path is absent: '${reference}'.`,
            reference,
            "Restore the evidence artifact or narrow/remove the claim.",
          ),
        );
      }
    }

    if (
      claim.status === "unfulfilled" &&
      presentCapability(claim.summary ?? "") &&
      normalizeProse(readme).includes(normalizeProse(claim.summary ?? ""))
    )
      failures.push(
        failure(
          claim.id,
          `Unfulfilled claim is presented in README as a current capability: '${claim.summary}'.`,
          "docs/evidence/readme-claims.json",
          "Remove the present-tense capability statement or explicitly describe it as unavailable/future work.",
        ),
      );

    if (
      claim.evidenceClass === "human-reviewed" &&
      !(await hasStructuredHumanReview(root, claim.evidence ?? []))
    )
      failures.push(
        failure(
          claim.id,
          "Human-reviewed claim has no complete structured review artifact with reviewer, date, source commit, scope, findings, and decision.",
          "docs/evidence/readme-claims.json and the referenced review JSON",
          "Add the genuine structured review artifact, or classify the claim by the weaker evidence that exists.",
        ),
      );

    if (
      claim.evidenceClass === "benchmarked" &&
      !(await hasSignedBenchmarkRun(root, claim.evidence ?? []))
    )
      failures.push(
        failure(
          claim.id,
          "Benchmarked claim has no verifiable signed run evidence: an Ed25519 envelope, completed run, and public key are required.",
          "src/core/benchmark-trust.ts#verifyBenchmarkTrustEvidence",
          "Reference genuine signed completed-run evidence plus its public key, or classify protocol-only material by its weaker structural evidence.",
        ),
      );

    if (claim.evidenceClass === "live-verified") {
      const boundedWithPrerequisites =
        claim.status === "bounded" &&
        Array.isArray(claim.externalPrerequisites) &&
        claim.externalPrerequisites.length > 0;
      if (
        claim.status === "bounded" &&
        !boundedWithPrerequisites &&
        !(await hasSignedDatedLiveEvidence(root, claim.evidence ?? []))
      )
        failures.push(
          failure(
            claim.id,
            "Bounded live-verified claim has no external prerequisite and no verifiable signed dated live evidence.",
            "docs/evidence/readme-claims.json#externalPrerequisites",
            "List the current external prerequisite, or reference genuine signed dated live-verification evidence plus its public key.",
          ),
        );
      if (
        claim.status !== "bounded" &&
        !(await hasSignedDatedLiveEvidence(root, claim.evidence ?? []))
      )
        failures.push(
          failure(
            claim.id,
            "Live-verified claim has no verifiable signed dated live evidence.",
            "docs/evidence/readme-claims.json and referenced live evidence",
            "Reference genuine signed dated live-verification evidence plus its public key, or mark the claim bounded with explicit external prerequisites.",
          ),
        );
    }
  }

  const expectedInstall = `${facts.package.name}@${facts.package.version}`;
  const documentedVersions = [
    ...readme.matchAll(
      new RegExp(
        `npm\\s+install(?:\\s+--global|\\s+-g)?\\s+${facts.package.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@([^\\s\x60]+)`,
        "gi",
      ),
    ),
  ].map((match) => match[1]);
  for (const version of documentedVersions)
    if (version !== facts.package.version)
      failures.push(
        failure(
          "distribution.npm",
          `README documents npm version '${version}', but the derived package version is '${facts.package.version}'.`,
          "package.json#version",
          `Document '${expectedInstall}' or update package metadata and release evidence together.`,
        ),
      );
  if (!documentedVersions.includes(facts.package.version))
    failures.push(
      failure(
        "distribution.npm",
        `README does not contain the current pinned npm install target '${expectedInstall}'.`,
        "package.json#name,version",
        `Add a bounded install example for '${expectedInstall}'.`,
      ),
    );
  if (
    /\bavailable as a public npm\b/i.test(readme) &&
    /\b(?:not yet published|unpublished)\b/i.test(readme)
  )
    failures.push(
      failure(
        "distribution.npm",
        "README says the package is both available and not published.",
        "README.md and package.json#version",
        "Remove the stale publication statement and retain the externally verified, version-pinned wording.",
      ),
    );

  if (claims.some((claim) => claim.id === "catalog.coverage")) {
    const expected = `${facts.catalog.records} credited public repositories`;
    if (!readme.includes(expected))
      failures.push(
        failure(
          "catalog.coverage",
          `README catalog fact is stale; expected '${expected}'.`,
          "catalog/packages.json via deriveReadmeFacts",
          "Run `npm run readme:update` and review the generated block.",
        ),
      );
  }
  if (claims.some((claim) => claim.id === "agents.support")) {
    const expected = `**${facts.agents.supportedNames.length} agents**`;
    if (!readme.includes(expected))
      failures.push(
        failure(
          "agents.support",
          `README adapter count is stale; expected '${expected}'.`,
          "src/core/adapters.ts via deriveReadmeFacts",
          "Run `npm run readme:update` and review the generated block.",
        ),
      );
  }

  failures.push(...releaseCommandFailures(releaseIndex, packageJson));
  failures.push(...auditDocumentedCommands({ readme, cliPath }));
  failures.sort(
    (left, right) =>
      left.claimId.localeCompare(right.claimId) ||
      left.observed.localeCompare(right.observed),
  );
  return { ok: failures.length === 0, failures };
}

export function formatReadmeClaimFailures(failures) {
  return failures
    .map(
      (item) =>
        `[${item.claimId}]\n  Observed: ${item.observed}\n  Authoritative source: ${item.authoritativeSource}\n  Remediation: ${item.remediation}`,
    )
    .join("\n");
}

async function loadRepositoryInputs(root = projectRoot) {
  const [
    packageJson,
    manifest,
    readme,
    catalog,
    { ADAPTER_CAPABILITIES },
    { deriveReadmeFacts },
    { POWER_SKILL_ALLOWLIST, STABLE_SKILL_ALLOWLIST },
    { buildReleaseEvidenceIndex },
  ] = await Promise.all([
    readFile(resolve(root, "package.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "docs/evidence/readme-claims.json"), "utf8").then(
      JSON.parse,
    ),
    readFile(resolve(root, "README.md"), "utf8"),
    import("../src/core/catalog.ts").then(({ loadCatalog }) =>
      loadCatalog(resolve(root, "catalog/packages.json")),
    ),
    import("../src/core/adapters.ts"),
    import("../src/core/readme-facts.ts"),
    import("../src/core/profiles.ts"),
    import("./check-release-claims.ts"),
  ]);
  return {
    root,
    readme,
    manifest,
    packageJson,
    facts: deriveReadmeFacts({
      catalog,
      packageJson,
      agents: ADAPTER_CAPABILITIES,
      profiles: {
        stable: STABLE_SKILL_ALLOWLIST,
        power: POWER_SKILL_ALLOWLIST,
      },
    }),
    releaseIndex: await buildReleaseEvidenceIndex(root),
    cliPath: resolve(root, packageJson.bin.loadout),
  };
}

async function main() {
  const result = await auditReadmeClaims(await loadRepositoryInputs());
  if (!result.ok) {
    process.stderr.write(`${formatReadmeClaimFailures(result.failures)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `README claim gate: PASS (${result.failures.length} contradiction(s))\n`,
  );
}

function isEntrypoint() {
  return process.argv[1] && resolve(process.argv[1]) === scriptPath;
}

if (isEntrypoint()) {
  if (!process.env.LOADOUT_README_CLAIMS_TSX) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", scriptPath, ...process.argv.slice(2)],
      {
        env: { ...process.env, LOADOUT_README_CLAIMS_TSX: "1" },
        stdio: "inherit",
      },
    );
    process.exitCode = result.status ?? 1;
  } else {
    main().catch((error) => {
      process.stderr.write(
        `${formatReadmeClaimFailures([
          failure(
            "verifier.runtime",
            error instanceof Error ? error.message : String(error),
            "README.md, docs/evidence/readme-claims.json, package.json, and built CLI",
            "Restore or correct the authoritative repository input, then rerun the offline verifier.",
          ),
        ])}\n`,
      );
      process.exitCode = 1;
    });
  }
}
