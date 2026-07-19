#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  join,
  parse,
  posix,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";
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
    !posix.isAbsolute(path) &&
    !win32.isAbsolute(path) &&
    !path.includes("\\") &&
    !path.split(/[\\/]/).includes("..")
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

const claimMatchingStopWords = new Set([
  "a",
  "an",
  "and",
  "between",
  "for",
  "from",
  "in",
  "of",
  "on",
  "the",
  "to",
  "with",
]);

function materialWords(value) {
  return new Set(
    normalizeProse(value)
      .match(/[a-z0-9]+/g)
      ?.filter(
        (word) => word.length > 2 && !claimMatchingStopWords.has(word),
      ) ?? [],
  );
}

function readmePresentsClaim(readme, summary) {
  const normalizedSummary = normalizeProse(summary);
  if (!normalizedSummary || !presentCapability(summary)) return false;
  if (normalizeProse(readme).includes(normalizedSummary)) return true;

  const summaryWords = materialWords(summary);
  if (summaryWords.size < 3) return false;
  return readme.split(/(?<=[.!?])\s+|\r?\n+/).some((sentence) => {
    if (!presentCapability(sentence)) return false;
    const sentenceWords = materialWords(sentence);
    const shared = [...summaryWords].filter((word) =>
      sentenceWords.has(word),
    ).length;
    return shared >= 3 && shared / summaryWords.size >= 0.6;
  });
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

function shellSegments(line) {
  const segments = [];
  let current = "";
  let quote;
  let escaped = false;
  const flush = () => {
    if (current.trim()) segments.push(current.trim());
    current = "";
  };
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      current += character;
      escaped = true;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (character === "#" && (index === 0 || /\s/.test(line[index - 1]))) {
      break;
    }
    if (character === ";" || character === "|" || character === "&") {
      flush();
      if (line[index + 1] === character) index += 1;
      continue;
    }
    current += character;
  }
  flush();
  return segments;
}

function shellWords(command) {
  const words = [];
  let current = "";
  let quote;
  let escaped = false;
  const flush = () => {
    if (current) words.push(current);
    current = "";
  };
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === ">" && (index === 0 || /\s/.test(command[index - 1])))
      break;
    if (/\s/.test(character)) {
      flush();
      continue;
    }
    current += character;
  }
  flush();
  return words;
}

/** Extract documented Loadout invocations only from shell code fences. */
export function documentedLoadoutCommands(readme) {
  const commands = [];
  for (const fence of readme.matchAll(
    /```(?:bash|sh|shell)?[ \t]*\r?\n([\s\S]*?)```/gi,
  )) {
    for (const line of logicalShellLines(fence[1])) {
      for (const segment of shellSegments(line)) {
        const invocation = segment.replace(/^\$\s+/, "");
        if (/^loadout(?:\s|$)/.test(invocation)) commands.push(invocation);
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

function helpOptions(help) {
  const lines = help.split(/\r?\n/);
  const start = lines.findIndex((line) => line === "Options:");
  const options = new Map();
  if (start === -1) return options;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    if (!/^ {2}-/.test(line)) continue;
    const specification = line.trim().split(/\s{2,}/, 1)[0];
    const takesValue = /(?:<[^>]+>|\[[^\]]+\])/.test(specification);
    for (const name of specification.match(/--?[A-Za-z0-9-]+/g) ?? [])
      options.set(name, { takesValue });
  }
  return options;
}

function helpArguments(help) {
  const usage = help.split(/\r?\n/, 1)[0] ?? "";
  const specifications = [
    ...usage.replace("[options]", "").matchAll(/<([^>]+)>|\[([^\]]+)\]/g),
  ].map((match) => ({
    required: Boolean(match[1]),
    variadic: (match[1] ?? match[2] ?? "").endsWith("..."),
  }));
  return {
    minimum: specifications.filter((item) => item.required).length,
    maximum: specifications.some((item) => item.variadic)
      ? Number.POSITIVE_INFINITY
      : specifications.length,
  };
}

function helpDescribesCommand(help, prefix) {
  const usage = help.split(/\r?\n/, 1)[0] ?? "";
  const words = usage.replace(/^Usage:\s+/, "").split(/\s+/);
  const expected = ["loadout", ...prefix];
  return expected.every((token, index) =>
    (words[index] ?? "").split("|").includes(token),
  );
}

function isoTimestamp(value) {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function isolatedHelpEnvironment(directory) {
  const userHome = join(directory, "user-home");
  const loadoutState = join(directory, "loadout-home");
  const windowsHome = parse(userHome);
  return {
    userHome,
    loadoutState,
    env: {
      ...process.env,
      LOADOUT_HOME: loadoutState,
      LOADOUT_USER_HOME: userHome,
      HOME: userHome,
      USERPROFILE: userHome,
      APPDATA: join(userHome, "AppData", "Roaming"),
      LOCALAPPDATA: join(userHome, "AppData", "Local"),
      XDG_CONFIG_HOME: join(userHome, ".config"),
      XDG_DATA_HOME: join(userHome, ".local", "share"),
      XDG_STATE_HOME: join(userHome, ".local", "state"),
      XDG_CACHE_HOME: join(userHome, ".cache"),
      HOMEDRIVE: windowsHome.root.replace(/[\\/]$/, "") || "C:",
      HOMEPATH: userHome.slice(windowsHome.root.length - 1),
      NO_COLOR: "1",
    },
  };
}

/** Validate command paths by executing the compiled Commander's help tree. */
export async function auditDocumentedCommands({ readme, cliPath }) {
  const failures = [];
  const helpCache = new Map();
  const directory = await mkdtemp(join(tmpdir(), "loadout-readme-help-"));
  const isolated = isolatedHelpEnvironment(directory);
  await Promise.all([
    mkdir(isolated.userHome, { recursive: true }),
    mkdir(isolated.loadoutState, { recursive: true }),
  ]);
  const loadHelp = (prefix) => {
    const key = prefix.join("\u0000");
    if (helpCache.has(key)) return helpCache.get(key);
    const result = spawnSync(process.execPath, [cliPath, ...prefix, "--help"], {
      encoding: "utf8",
      env: isolated.env,
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

  try {
    for (const command of documentedLoadoutCommands(readme)) {
      const tokens = shellWords(command).slice(1);
      let prefix = [];
      let index = 0;
      let commandFailed = false;
      while (index <= tokens.length && !commandFailed) {
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
        const options = helpOptions(loaded.help);
        const positionals = [];
        let descended = false;
        while (index < tokens.length) {
          const token = tokens[index];
          if (token.startsWith("-")) {
            const [name, inlineValue] = token.split("=", 2);
            const option = options.get(name);
            if (!option) {
              failures.push(
                failure(
                  "product.scope",
                  `Documented option '${name}' in '${command}' is absent from built CLI help at 'loadout ${prefix.join(" ") || "<root>"}'.`,
                  `${cliPath} ${prefix.join(" ")} --help`.replace(/\s+/g, " "),
                  "Correct the README option or register it in the compiled Commander command.",
                ),
              );
              commandFailed = true;
              break;
            }
            index += 1;
            if (option.takesValue && inlineValue === undefined) {
              if (index >= tokens.length) {
                failures.push(
                  failure(
                    "product.scope",
                    `Documented option '${name}' in '${command}' has no value.`,
                    `${cliPath} ${prefix.join(" ")} --help`.replace(
                      /\s+/g,
                      " ",
                    ),
                    "Add the documented option value or remove the option.",
                  ),
                );
                commandFailed = true;
                break;
              }
              index += 1;
            }
            continue;
          }
          if (children.size) {
            if (!children.has(token)) {
              const hiddenChild = loadHelp([...prefix, token]);
              if (
                !hiddenChild.ok ||
                !helpDescribesCommand(hiddenChild.help, [...prefix, token])
              ) {
                failures.push(
                  failure(
                    "product.scope",
                    `Documented command '${command}' is absent from built CLI help at 'loadout ${prefix.join(" ") || "<root>"}'.`,
                    `${cliPath} ${prefix.join(" ")} --help`.replace(
                      /\s+/g,
                      " ",
                    ),
                    "Correct the README command or register the command in the compiled Commander tree.",
                  ),
                );
                commandFailed = true;
                break;
              }
            }
            prefix = [...prefix, token];
            index += 1;
            descended = true;
            break;
          }
          positionals.push(token);
          index += 1;
        }
        if (commandFailed || descended) continue;
        const expected = helpArguments(loaded.help);
        if (
          positionals.length < expected.minimum ||
          positionals.length > expected.maximum
        )
          failures.push(
            failure(
              "product.scope",
              `Documented command '${command}' has ${positionals.length} positional argument(s), outside built CLI usage '${loaded.help.split(/\r?\n/, 1)[0]}'.`,
              `${cliPath} ${prefix.join(" ")} --help`.replace(/\s+/g, " "),
              "Correct the README arguments to match the compiled Commander usage.",
            ),
          );
        break;
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  return failures;
}

function containedPath(root, target) {
  const fromRoot = relative(root, target);
  return (
    fromRoot === "" || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== "..")
  );
}

async function validateEvidenceFile({ root, rootRealPath, reference }) {
  if (!portablePath(reference))
    return {
      error: `Evidence path '${reference}' is not a safe repository-relative path.`,
      source: "docs/evidence/readme-claims.json",
      remediation:
        "Use a portable path to a regular file inside the repository.",
    };
  const target = resolve(root, reference);
  if (!containedPath(root, target))
    return {
      error: `Evidence path '${reference}' escapes the repository root.`,
      source: "docs/evidence/readme-claims.json",
      remediation: "Use a repository-owned regular evidence file.",
    };
  let current = root;
  try {
    for (const component of reference.split("/")) {
      current = resolve(current, component);
      const information = await lstat(current);
      if (information.isSymbolicLink())
        return {
          error: `Evidence path '${reference}' traverses a symlink at '${relative(root, current)}'.`,
          source: reference,
          remediation:
            "Reference a checked-in regular file without symlink components.",
        };
    }
  } catch {
    return {
      error: `Authoritative evidence path is absent: '${reference}'.`,
      source: reference,
      remediation: "Restore the evidence artifact or narrow/remove the claim.",
    };
  }
  const information = await lstat(target);
  if (!information.isFile())
    return {
      error: `Evidence path '${reference}' is not a regular file.`,
      source: reference,
      remediation: "Reference a checked-in regular evidence file.",
    };
  const targetRealPath = await realpath(target);
  if (!containedPath(rootRealPath, targetRealPath))
    return {
      error: `Evidence real path '${targetRealPath}' escapes repository real path '${rootRealPath}'.`,
      source: reference,
      remediation:
        "Reference a non-symlinked regular file contained by the repository real path.",
    };
  return { path: reference };
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
          evidenceValue.summary.protocolConformant === true &&
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

async function hasStructuredHumanReview(root, evidence, claim) {
  const requiredKeys = [
    "attestation",
    "claimId",
    "decision",
    "findings",
    "reviewedAt",
    "reviewedSourceCommit",
    "reviewer",
    "schemaVersion",
    "scope",
  ];
  const supportiveDecisions = new Set(["approved", "approved-with-boundaries"]);
  for (const path of evidence.filter((value) => /\.json$/i.test(value))) {
    let review;
    try {
      review = JSON.parse(await readFile(resolve(root, path), "utf8"));
    } catch {
      continue;
    }
    if (
      review &&
      typeof review === "object" &&
      !Array.isArray(review) &&
      Object.keys(review).sort().join("\u0000") ===
        [...requiredKeys].sort().join("\u0000") &&
      review?.schemaVersion === 1 &&
      review.attestation === "human-reviewed" &&
      review.claimId === claim.id &&
      typeof review.reviewer === "string" &&
      review.reviewer === review.reviewer.trim() &&
      review.reviewer.length > 0 &&
      isoTimestamp(review.reviewedAt) &&
      typeof review.reviewedSourceCommit === "string" &&
      /^(?!([a-f0-9])\1{39}$)[a-f0-9]{40}$/i.test(
        review.reviewedSourceCommit,
      ) &&
      // A review binds to current source when its exact commit is present and
      // reachable from HEAD. Equality is allowed; an ancestor represents a
      // review of an earlier snapshot retained in the current history.
      spawnSync(
        "git",
        [
          "-C",
          root,
          "merge-base",
          "--is-ancestor",
          review.reviewedSourceCommit,
          "HEAD",
        ],
        { stdio: "ignore", timeout: 5_000 },
      ).status === 0 &&
      typeof review.scope === "string" &&
      review.scope === review.scope.trim() &&
      review.scope.length > 0 &&
      Array.isArray(review.findings) &&
      review.findings.length > 0 &&
      review.findings.every(
        (finding) => typeof finding === "string" && finding.trim().length > 0,
      ) &&
      supportiveDecisions.has(review.decision) &&
      claim.status === "bounded"
    )
      return true;
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
  const rootRealPath = await realpath(root);
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
    const verifiedEvidence = [];
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
      const validation = await validateEvidenceFile({
        root,
        rootRealPath,
        reference,
      });
      if (validation.error)
        failures.push(
          failure(
            claim.id,
            validation.error,
            validation.source,
            validation.remediation,
          ),
        );
      else verifiedEvidence.push(validation.path);
    }

    if (
      claim.status === "unfulfilled" &&
      readmePresentsClaim(readme, claim.summary ?? "")
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
      !(await hasStructuredHumanReview(root, verifiedEvidence, claim))
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
      !(await hasSignedBenchmarkRun(root, verifiedEvidence))
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
        claim.externalPrerequisites.length > 0 &&
        claim.externalPrerequisites.every(
          (item) => typeof item === "string" && item.trim().length > 0,
        );
      if (!boundedWithPrerequisites)
        failures.push(
          failure(
            claim.id,
            "Live-verified README claims must remain bounded with explicit external prerequisites; arbitrary self-signed artifacts cannot establish current live state offline.",
            "docs/evidence/readme-claims.json#status,externalPrerequisites",
            "Mark the claim bounded and list each external prerequisite; use a future claim-bound trusted-signer/freshness design before promoting it.",
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
  failures.push(...(await auditDocumentedCommands({ readme, cliPath })));
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

export function runVerifierSubprocess({
  script = scriptPath,
  argumentsList = [],
  timeoutMs = 120_000,
  stdio = "inherit",
} = {}) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", script, ...argumentsList],
    {
      env: { ...process.env, LOADOUT_README_CLAIMS_TSX: "1" },
      stdio,
      timeout: timeoutMs,
    },
  );
  if (result.error?.code === "ETIMEDOUT")
    return {
      status: 1,
      failure: failure(
        "verifier.runtime",
        `Verifier subprocess exceeded its ${timeoutMs} ms timeout.`,
        script,
        "Inspect the verifier for a stuck subprocess or raise the bounded timeout only with reviewed evidence.",
      ),
    };
  if (result.error)
    return {
      status: 1,
      failure: failure(
        "verifier.runtime",
        `Verifier subprocess could not start: ${result.error.message}`,
        script,
        "Restore the Node/tsx runtime and rerun the offline verifier.",
      ),
    };
  return { status: result.status ?? 1 };
}

if (isEntrypoint()) {
  if (!process.env.LOADOUT_README_CLAIMS_TSX) {
    const result = runVerifierSubprocess({
      argumentsList: process.argv.slice(2),
    });
    if (result.failure)
      process.stderr.write(`${formatReadmeClaimFailures([result.failure])}\n`);
    process.exitCode = result.status;
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
