import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { PackageSource } from "../shared/types.js";

const MAX_SOURCE_BYTES = 1_000_000;
const MAX_LINES = 10_000;
const MAX_DEPTH = 30;
const MAX_NODES = 50_000;
const GIT_SHA = /^[0-9a-f]{40}$/i;
const HASH_ENVELOPE =
  /^(?:sha256:[0-9a-f]{64}|sha384:[0-9a-f]{96}|sha512:[0-9a-f]{128}|[0-9a-f]{64})$/i;

type JsonObject = Record<string, unknown>;

export type EcosystemImportFormat = "openapm-v0.1" | "openpackage-current";
export type EcosystemArtifactKind = "manifest" | "lock-evidence";
export type ImportDisposition =
  "ready-for-loadout-review" | "requires-resolution" | "manual-review-only";

export interface PreservedImportSource {
  filename: string;
  text: string;
  bytes: number;
  sha256: string;
}

export interface ImportLossEntry {
  path: string;
  reason: string;
  value: unknown;
}

export interface ImportTrustAssessment {
  level: "unverified" | "integrity-evidence-present";
  evidence: string[];
  uncertainties: string[];
}

export interface ImportCandidate {
  id: string;
  dependencyKind: "package" | "mcp";
  development: boolean;
  declared: unknown;
  source?: PackageSource;
  resolvedCommit?: string;
  integrity?: string;
  disposition: ImportDisposition;
  warnings: string[];
}

export interface EcosystemImportPlan {
  schemaVersion: 1;
  format: EcosystemImportFormat;
  artifact: EcosystemArtifactKind;
  source: PreservedImportSource;
  packageName?: string;
  packageVersion?: string;
  candidates: ImportCandidate[];
  preservedPaths: string[];
  unsupported: ImportLossEntry[];
  trust: ImportTrustAssessment;
  warnings: string[];
  executionBoundary: {
    readOnly: true;
    externalCommandsRun: false;
    networkRequestsMade: false;
    filesWritten: false;
    installReady: false;
    statement: string;
  };
}

export interface EcosystemImportFiles {
  manifest: EcosystemImportPlan;
  lockEvidence?: EcosystemImportPlan;
}

interface YamlToken {
  indent: number;
  content: string;
  line: number;
}

interface ParseState {
  tokens: YamlToken[];
  nodes: number;
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be a mapping`);
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a sequence`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return string(value, label);
}

function ownEntries(value: JsonObject): Array<[string, unknown]> {
  return Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );
}

function sourceRecord(filename: string, text: string): PreservedImportSource {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_SOURCE_BYTES)
    throw new Error(
      `Import source exceeds the ${MAX_SOURCE_BYTES}-byte read-only limit`,
    );
  return {
    filename,
    text,
    bytes,
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}

function stripYamlComment(value: string): string {
  let single = false;
  let double = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (double && character === "\\") {
      escaped = true;
      continue;
    }
    if (!double && character === "'") {
      if (single && value[index + 1] === "'") index += 1;
      else single = !single;
      continue;
    }
    if (!single && character === '"') {
      double = !double;
      continue;
    }
    if (
      !single &&
      !double &&
      character === "#" &&
      (index === 0 || /\s/.test(value[index - 1]))
    )
      return value.slice(0, index).trimEnd();
  }
  if (single || double) throw new Error("Unterminated YAML quoted scalar");
  return value.trimEnd();
}

function tokenizeYaml(text: string): YamlToken[] {
  if (text.includes("\0")) throw new Error("YAML contains a NUL byte");
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.length > MAX_LINES)
    throw new Error(`YAML exceeds the ${MAX_LINES}-line read-only limit`);
  const tokens: YamlToken[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.includes("\t"))
      throw new Error(`YAML line ${index + 1} contains a tab`);
    const indent = line.length - line.trimStart().length;
    const content = stripYamlComment(line.slice(indent)).trimEnd();
    if (!content) continue;
    if (content === "---" || content === "...")
      throw new Error(
        `YAML document markers are outside the supported subset (line ${index + 1})`,
      );
    if (/^(?:!|&|\*)/.test(content) || /:\s*(?:!|&|\*)/.test(content))
      throw new Error(
        `YAML tags, anchors, and aliases are not allowed (line ${index + 1})`,
      );
    if (/^<<\s*:/.test(content))
      throw new Error(`YAML merge keys are not allowed (line ${index + 1})`);
    tokens.push({ indent, content, line: index + 1 });
  }
  const normalized: YamlToken[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.content.startsWith("? ")) {
      if (token.content === "?")
        throw new Error(
          `Complex YAML mapping keys are outside the supported subset (line ${token.line})`,
        );
      normalized.push(token);
      continue;
    }
    const value = tokens[index + 1];
    if (
      !value ||
      value.indent !== token.indent ||
      !(value.content === ":" || value.content.startsWith(": "))
    )
      throw new Error(
        `YAML explicit key at line ${token.line} must have one scalar value line`,
      );
    const key = token.content.slice(2).trim();
    if (!key)
      throw new Error(`YAML explicit key at line ${token.line} is empty`);
    normalized.push({
      indent: token.indent,
      content: `${JSON.stringify(key)}:${value.content.slice(1)}`,
      line: token.line,
    });
    index += 1;
  }
  if (normalized.length === 0) throw new Error("YAML document is empty");
  if (normalized[0].indent !== 0)
    throw new Error("YAML root must begin at indentation zero");
  return normalized;
}

function splitMapping(value: string, line: number): [string, string] {
  let single = false;
  let double = false;
  let square = 0;
  let curly = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (!double && character === "'") {
      if (single && value[index + 1] === "'") index += 1;
      else single = !single;
    } else if (!single && character === '"') {
      let slashes = 0;
      for (
        let cursor = index - 1;
        cursor >= 0 && value[cursor] === "\\";
        cursor -= 1
      )
        slashes += 1;
      if (slashes % 2 === 0) double = !double;
    } else if (!single && !double) {
      if (character === "[") square += 1;
      else if (character === "]") square -= 1;
      else if (character === "{") curly += 1;
      else if (character === "}") curly -= 1;
      else if (
        character === ":" &&
        square === 0 &&
        curly === 0 &&
        (index === value.length - 1 || /\s/.test(value[index + 1]))
      ) {
        const key = value.slice(0, index).trim();
        if (!key) throw new Error(`YAML line ${line} has an empty key`);
        return [key, value.slice(index + 1).trim()];
      }
    }
  }
  throw new Error(`YAML line ${line} is not a supported mapping entry`);
}

function splitFlow(value: string): string[] {
  const result: string[] = [];
  let start = 0;
  let single = false;
  let double = false;
  let square = 0;
  let curly = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (!double && character === "'") {
      if (single && value[index + 1] === "'") index += 1;
      else single = !single;
    } else if (!single && character === '"') {
      let slashes = 0;
      for (
        let cursor = index - 1;
        cursor >= 0 && value[cursor] === "\\";
        cursor -= 1
      )
        slashes += 1;
      if (slashes % 2 === 0) double = !double;
    } else if (!single && !double) {
      if (character === "[") square += 1;
      else if (character === "]") square -= 1;
      else if (character === "{") curly += 1;
      else if (character === "}") curly -= 1;
      else if (character === "," && square === 0 && curly === 0) {
        result.push(value.slice(start, index).trim());
        start = index + 1;
      }
    }
  }
  result.push(value.slice(start).trim());
  return result;
}

function parseYamlScalar(value: string, line: number): unknown {
  if (value === "" || value === "~" || value === "null" || value === "Null")
    return null;
  if (value === "true" || value === "True") return true;
  if (value === "false" || value === "False") return false;
  if (/^-?(?:0|[1-9][0-9]*)$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== "string") throw new Error("not a string");
      return parsed;
    } catch {
      throw new Error(`YAML line ${line} has an invalid double-quoted scalar`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2)
      throw new Error(`YAML line ${line} has an invalid single-quoted scalar`);
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value === "[]") return [];
  if (value === "{}") return {};
  if (value.startsWith("[") && value.endsWith("]"))
    return splitFlow(value.slice(1, -1))
      .filter(Boolean)
      .map((entry) => parseYamlScalar(entry, line));
  if (value.startsWith("{") || value.endsWith("}") || /^[|>]/.test(value))
    throw new Error(
      `YAML line ${line} uses a flow mapping or block scalar outside the supported subset`,
    );
  return value;
}

function yamlKey(value: string, line: number): string {
  const parsed = parseYamlScalar(value, line);
  if (typeof parsed !== "string" || !parsed)
    throw new Error(`YAML line ${line} has a non-string or empty key`);
  if (parsed === "<<")
    throw new Error(`YAML merge keys are not allowed (line ${line})`);
  return parsed;
}

function addNode(state: ParseState, depth: number): void {
  state.nodes += 1;
  if (state.nodes > MAX_NODES)
    throw new Error(`YAML exceeds the ${MAX_NODES}-node read-only limit`);
  if (depth > MAX_DEPTH)
    throw new Error(`YAML exceeds the ${MAX_DEPTH}-level nesting limit`);
}

function parseYamlBlock(
  state: ParseState,
  start: number,
  indent: number,
  depth: number,
): { value: unknown; next: number } {
  addNode(state, depth);
  const first = state.tokens[start];
  if (!first || first.indent !== indent)
    throw new Error("Invalid YAML indentation state");
  if (first.content === "-" || first.content.startsWith("- "))
    return parseYamlSequence(state, start, indent, depth);
  return parseYamlMapping(state, start, indent, depth);
}

function parseYamlMapping(
  state: ParseState,
  start: number,
  indent: number,
  depth: number,
): { value: JsonObject; next: number } {
  const result: JsonObject = {};
  let index = start;
  while (index < state.tokens.length) {
    const token = state.tokens[index];
    if (token.indent < indent) break;
    if (token.indent > indent)
      throw new Error(`Unexpected YAML indentation at line ${token.line}`);
    if (token.content === "-" || token.content.startsWith("- ")) break;
    const [rawKey, rawValue] = splitMapping(token.content, token.line);
    const key = yamlKey(rawKey, token.line);
    if (Object.hasOwn(result, key))
      throw new Error(`Duplicate YAML key '${key}' at line ${token.line}`);
    addNode(state, depth + 1);
    index += 1;
    if (rawValue) result[key] = parseYamlScalar(rawValue, token.line);
    else if (
      index < state.tokens.length &&
      (state.tokens[index].indent > indent ||
        (state.tokens[index].indent === indent &&
          (state.tokens[index].content === "-" ||
            state.tokens[index].content.startsWith("- "))))
    ) {
      const child = parseYamlBlock(
        state,
        index,
        state.tokens[index].indent,
        depth + 1,
      );
      result[key] = child.value;
      index = child.next;
    } else result[key] = null;
  }
  return { value: result, next: index };
}

function parseYamlSequence(
  state: ParseState,
  start: number,
  indent: number,
  depth: number,
): { value: unknown[]; next: number } {
  const result: unknown[] = [];
  let index = start;
  while (index < state.tokens.length) {
    const token = state.tokens[index];
    if (token.indent < indent) break;
    if (token.indent !== indent)
      throw new Error(`Unexpected YAML indentation at line ${token.line}`);
    if (!(token.content === "-" || token.content.startsWith("- "))) break;
    const rest = token.content.slice(1).trim();
    addNode(state, depth + 1);
    index += 1;
    if (!rest) {
      if (index >= state.tokens.length || state.tokens[index].indent <= indent)
        result.push(null);
      else {
        const child = parseYamlBlock(
          state,
          index,
          state.tokens[index].indent,
          depth + 1,
        );
        result.push(child.value);
        index = child.next;
      }
      continue;
    }
    let pair: [string, string] | undefined;
    try {
      pair = splitMapping(rest, token.line);
    } catch {
      pair = undefined;
    }
    if (!pair) {
      result.push(parseYamlScalar(rest, token.line));
      continue;
    }
    const item: JsonObject = {};
    const key = yamlKey(pair[0], token.line);
    if (pair[1]) item[key] = parseYamlScalar(pair[1], token.line);
    else if (
      index < state.tokens.length &&
      state.tokens[index].indent > indent
    ) {
      const childIndent = state.tokens[index].indent;
      const child = parseYamlBlock(state, index, childIndent, depth + 2);
      item[key] = child.value;
      index = child.next;
    } else item[key] = null;
    if (index < state.tokens.length && state.tokens[index].indent > indent) {
      const continuationIndent = state.tokens[index].indent;
      const continuation = parseYamlMapping(
        state,
        index,
        continuationIndent,
        depth + 1,
      );
      for (const [continuationKey, value] of Object.entries(
        continuation.value,
      )) {
        if (Object.hasOwn(item, continuationKey))
          throw new Error(
            `Duplicate YAML key '${continuationKey}' in sequence mapping`,
          );
        item[continuationKey] = value;
      }
      index = continuation.next;
    }
    result.push(item);
  }
  return { value: result, next: index };
}

/**
 * Parse only Loadout's audited YAML subset. This is not a general YAML parser
 * and deliberately rejects executable/ambiguous YAML features.
 */
export function parseBoundedYaml(text: string): unknown {
  const source = sourceRecord("input.yml", text);
  const tokens = tokenizeYaml(source.text);
  const state: ParseState = { tokens, nodes: 0 };
  const parsed = parseYamlBlock(state, 0, 0, 0);
  if (parsed.next !== tokens.length)
    throw new Error(
      `Unsupported YAML structure at line ${tokens[parsed.next].line}`,
    );
  return parsed.value;
}

function executionBoundary(): EcosystemImportPlan["executionBoundary"] {
  return {
    readOnly: true,
    externalCommandsRun: false,
    networkRequestsMade: false,
    filesWritten: false,
    installReady: false,
    statement:
      "This parser only inventories declarative evidence. It does not resolve, fetch, execute, install, or write any dependency.",
  };
}

function countHashMap(value: unknown, path: string): number {
  if (value === undefined) return 0;
  const hashes = object(value, path);
  for (const [file, hash] of Object.entries(hashes))
    if (typeof hash !== "string" || !HASH_ENVELOPE.test(hash))
      throw new Error(`${path}.${file} has an invalid integrity envelope`);
  return Object.keys(hashes).length;
}

function githubSource(
  repository: string,
  ref?: string,
  path?: string,
): PackageSource {
  return {
    type: "github",
    repository,
    ...(ref ? { ref } : {}),
    ...(path ? { path } : {}),
  };
}

function gitSource(url: string, ref?: string, path?: string): PackageSource {
  return {
    type: "git",
    url,
    ...(ref ? { ref } : {}),
    ...(path ? { path } : {}),
  };
}

function parseGitHubUrl(
  value: string,
): { repository: string; ref?: string } | undefined {
  const match = value.match(
    /^(?:https?:\/\/github\.com\/|git@github\.com:)([^/#]+\/[^/#]+?)(?:\.git)?(?:#(.+))?$/,
  );
  if (!match) return undefined;
  return { repository: match[1], ...(match[2] ? { ref: match[2] } : {}) };
}

function uniqueId(value: string, index: number): string {
  const normalized = value
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/[^a-zA-Z0-9._/-]+/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "")
    .replace(/\//g, "-")
    .toLowerCase();
  return normalized || `imported-${index + 1}`;
}

function apmStringCandidate(
  declaration: string,
  index: number,
  kind: "package" | "mcp",
  development: boolean,
  defaultHost: string,
): ImportCandidate {
  const warnings: string[] = [];
  if (kind === "mcp") {
    return {
      id: uniqueId(declaration, index),
      dependencyKind: kind,
      development,
      declared: declaration,
      disposition: "manual-review-only",
      warnings: [
        "MCP identifiers do not contain enough runtime, transport, or credential evidence for safe conversion.",
      ],
    };
  }
  if (/^(?:\.{1,2}\/|\/|~\/)/.test(declaration)) {
    return {
      id: uniqueId(basename(declaration), index),
      dependencyKind: kind,
      development,
      declared: declaration,
      source: { type: "local", path: declaration },
      disposition: "ready-for-loadout-review",
      warnings: [
        "Local paths are machine-relative and have no remote provenance.",
      ],
    };
  }
  const url = parseGitHubUrl(declaration);
  if (url) {
    return {
      id: uniqueId(url.repository, index),
      dependencyKind: kind,
      development,
      declared: declaration,
      source: githubSource(url.repository, url.ref),
      disposition: "ready-for-loadout-review",
      warnings,
    };
  }
  const hash = declaration.lastIndexOf("#");
  const base = hash === -1 ? declaration : declaration.slice(0, hash);
  const ref = hash === -1 ? undefined : declaration.slice(hash + 1);
  const segments = base.split("/");
  if (defaultHost === "github.com" && segments.length >= 2) {
    const repository = `${segments[0]}/${segments[1]}`;
    const path = segments.length > 2 ? segments.slice(2).join("/") : undefined;
    return {
      id: uniqueId(base, index),
      dependencyKind: kind,
      development,
      declared: declaration,
      source: githubSource(repository, ref, path),
      disposition: "ready-for-loadout-review",
      warnings,
    };
  }
  return {
    id: uniqueId(base, index),
    dependencyKind: kind,
    development,
    declared: declaration,
    source: gitSource(`https://${defaultHost}/${base}.git`, ref),
    disposition: "ready-for-loadout-review",
    warnings: [
      "The APM default host was preserved as an HTTPS Git assumption for review.",
    ],
  };
}

function apmObjectCandidate(
  declaration: JsonObject,
  index: number,
  kind: "package" | "mcp",
  development: boolean,
): ImportCandidate {
  const identity =
    optionalString(declaration.id, `dependency[${index}].id`) ??
    optionalString(declaration.git, `dependency[${index}].git`) ??
    optionalString(declaration.path, `dependency[${index}].path`) ??
    optionalString(declaration.registry, `dependency[${index}].registry`) ??
    `imported-${index + 1}`;
  if (kind === "mcp")
    return {
      id: uniqueId(identity, index),
      dependencyKind: kind,
      development,
      declared: declaration,
      disposition: "manual-review-only",
      warnings: [
        "MCP declarations are preserved for manual runtime and credential review; no server is executed.",
      ],
    };
  const ref = optionalString(declaration.ref, `dependency[${index}].ref`);
  const path = optionalString(declaration.path, `dependency[${index}].path`);
  const git = optionalString(declaration.git, `dependency[${index}].git`);
  if (git) {
    const github = parseGitHubUrl(git);
    return {
      id: uniqueId(identity, index),
      dependencyKind: kind,
      development,
      declared: declaration,
      source: github
        ? githubSource(github.repository, ref ?? github.ref, path)
        : gitSource(git, ref, path),
      disposition: "ready-for-loadout-review",
      warnings: [],
    };
  }
  if (path)
    return {
      id: uniqueId(identity, index),
      dependencyKind: kind,
      development,
      declared: declaration,
      source: { type: "local", path },
      disposition: "ready-for-loadout-review",
      warnings: [
        "Local paths are machine-relative and have no remote provenance.",
      ],
    };
  const registry = optionalString(
    declaration.registry,
    `dependency[${index}].registry`,
  );
  const id = optionalString(declaration.id, `dependency[${index}].id`);
  if (registry)
    return {
      id: uniqueId(id ?? identity, index),
      dependencyKind: kind,
      development,
      declared: declaration,
      ...(id && typeof declaration.version === "string"
        ? {
            source: {
              type: "remote-registry" as const,
              registry,
              name: id,
              version: declaration.version,
            },
          }
        : {}),
      disposition: "requires-resolution",
      warnings: [
        "Registry identity or version constraint requires immutable resolution before Loadout review.",
      ],
    };
  if (id) return apmStringCandidate(id, index, kind, development, "github.com");
  return {
    id: uniqueId(identity, index),
    dependencyKind: kind,
    development,
    declared: declaration,
    disposition: "requires-resolution",
    warnings: [
      "Registry identity requires explicit registry and immutable resolution.",
    ],
  };
}

function apmCandidates(
  manifest: JsonObject,
  unsupported: ImportLossEntry[],
  preservedPaths: string[],
): ImportCandidate[] {
  const dependencies =
    manifest.dependencies === undefined
      ? {}
      : object(manifest.dependencies, "dependencies");
  const devDependencies =
    manifest.devDependencies === undefined
      ? {}
      : object(manifest.devDependencies, "devDependencies");
  const defaultHost =
    optionalString(manifest.default_host, "default_host") ?? "github.com";
  const result: ImportCandidate[] = [];
  for (const [block, development] of [
    [dependencies, false],
    [devDependencies, true],
  ] as const) {
    for (const kind of ["apm", "mcp"] as const) {
      const entries = block[kind] === undefined ? [] : array(block[kind], kind);
      entries.forEach((entry, index) => {
        const path = `${development ? "devDependencies" : "dependencies"}.${kind}[${index}]`;
        preservedPaths.push(path);
        result.push(
          typeof entry === "string"
            ? apmStringCandidate(
                string(entry, path),
                result.length,
                kind === "apm" ? "package" : "mcp",
                development,
                defaultHost,
              )
            : apmObjectCandidate(
                object(entry, path),
                result.length,
                kind === "apm" ? "package" : "mcp",
                development,
              ),
        );
      });
    }
    for (const [field, value] of ownEntries(block))
      if (!new Set(["apm", "mcp", "conflict_resolution"]).has(field))
        unsupported.push({
          path: `${development ? "devDependencies" : "dependencies"}.${field}`,
          value,
          reason:
            "Dependency block field is preserved but has no Loadout import semantic.",
        });
  }
  return result;
}

const APM_MANIFEST_FIELDS = new Set([
  "name",
  "version",
  "description",
  "author",
  "license",
  "default_host",
  "target",
  "type",
  "scripts",
  "includes",
  "registries",
  "dependencies",
  "devDependencies",
  "compilation",
  "policy",
  "marketplace",
]);

export function planApmManifestImport(
  text: string,
  filename = "apm.yml",
): EcosystemImportPlan {
  const source = sourceRecord(filename, text);
  const manifest = object(parseBoundedYaml(text), "APM manifest");
  const packageName = string(manifest.name, "APM manifest name");
  const packageVersion = string(manifest.version, "APM manifest version");
  const unsupported: ImportLossEntry[] = [];
  const preservedPaths = ["name", "version"];
  for (const [field, value] of ownEntries(manifest)) {
    if (field.startsWith("x-")) {
      unsupported.push({
        path: field,
        value,
        reason:
          "OpenAPM vendor extension is byte-preserved but not interpreted.",
      });
    } else if (!APM_MANIFEST_FIELDS.has(field))
      unsupported.push({
        path: field,
        value,
        reason: "Unknown OpenAPM field is byte-preserved but not interpreted.",
      });
    else if (
      !new Set(["name", "version", "dependencies", "devDependencies"]).has(
        field,
      )
    )
      unsupported.push({
        path: field,
        value,
        reason:
          "Manifest metadata/runtime field is preserved but not converted to a Loadout package.",
      });
  }
  const candidates = apmCandidates(manifest, unsupported, preservedPaths);
  const hasScripts =
    manifest.scripts !== undefined &&
    Object.keys(object(manifest.scripts, "scripts")).length > 0;
  return {
    schemaVersion: 1,
    format: "openapm-v0.1",
    artifact: "manifest",
    source,
    packageName,
    packageVersion,
    candidates,
    preservedPaths,
    unsupported,
    trust: {
      level: "unverified",
      evidence: ["Exact source bytes and SHA-256 preserved locally."],
      uncertainties: [
        "Manifest declarations are intent, not proof of resolved content or publisher identity.",
        "OpenAPM v0.1 is a working draft and Loadout does not claim Consumer conformance.",
      ],
    },
    warnings: [
      ...(hasScripts
        ? [
            "APM scripts were preserved as unsupported metadata and were not executed.",
          ]
        : []),
      "Targets, registries, compilation, policy, marketplace, and MCP runtime semantics require manual review.",
    ],
    executionBoundary: executionBoundary(),
  };
}

const APM_LOCK_FIELDS = new Set([
  "lockfile_version",
  "generated_at",
  "apm_version",
  "dependencies",
  "mcp_servers",
  "mcp_configs",
  "local_deployed_files",
  "local_deployed_file_hashes",
  "attestations",
]);

export function planApmLockEvidenceImport(
  text: string,
  filename = "apm.lock.yaml",
): EcosystemImportPlan {
  const source = sourceRecord(filename, text);
  const lock = object(parseBoundedYaml(text), "APM lockfile");
  const version = String(lock.lockfile_version ?? "");
  if (version !== "1" && version !== "2")
    throw new Error("APM lockfile lockfile_version must be 1 or 2");
  const dependencies = array(lock.dependencies, "APM lockfile dependencies");
  const candidates: ImportCandidate[] = [];
  const preservedPaths = ["lockfile_version"];
  const unsupported: ImportLossEntry[] = [];
  let integrityCount = 0;
  dependencies.forEach((entry, index) => {
    const dependency = object(entry, `dependencies[${index}]`);
    const name =
      optionalString(dependency.name, `dependencies[${index}].name`) ??
      optionalString(dependency.repo_url, `dependencies[${index}].repo_url`) ??
      `locked-${index + 1}`;
    const resolvedCommit = optionalString(
      dependency.resolved_commit,
      `dependencies[${index}].resolved_commit`,
    );
    if (resolvedCommit && !GIT_SHA.test(resolvedCommit))
      throw new Error(
        `dependencies[${index}].resolved_commit is not a 40-hex Git SHA`,
      );
    const integrity =
      optionalString(
        dependency.tree_sha256,
        `dependencies[${index}].tree_sha256`,
      ) ??
      optionalString(
        dependency.resolved_hash,
        `dependencies[${index}].resolved_hash`,
      ) ??
      optionalString(
        dependency.content_hash,
        `dependencies[${index}].content_hash`,
      );
    if (integrity && !HASH_ENVELOPE.test(integrity))
      throw new Error(
        `dependencies[${index}] has an invalid integrity envelope`,
      );
    if (integrity) integrityCount += 1;
    integrityCount += countHashMap(
      dependency.deployed_file_hashes,
      `dependencies[${index}].deployed_file_hashes`,
    );
    const repoUrl =
      optionalString(
        dependency.resolved_url,
        `dependencies[${index}].resolved_url`,
      ) ??
      optionalString(dependency.repo_url, `dependencies[${index}].repo_url`);
    const localPath = optionalString(
      dependency.local_path,
      `dependencies[${index}].local_path`,
    );
    const virtualPath = optionalString(
      dependency.virtual_path,
      `dependencies[${index}].virtual_path`,
    );
    let candidateSource: PackageSource | undefined;
    if (localPath) candidateSource = { type: "local", path: localPath };
    else if (repoUrl && !repoUrl.startsWith("_local/")) {
      const github = parseGitHubUrl(repoUrl);
      candidateSource = github
        ? githubSource(
            github.repository,
            resolvedCommit ??
              optionalString(dependency.resolved_ref, "resolved_ref") ??
              github.ref,
            virtualPath,
          )
        : gitSource(
            repoUrl,
            resolvedCommit ??
              optionalString(dependency.resolved_ref, "resolved_ref"),
            virtualPath,
          );
    }
    candidates.push({
      id: uniqueId(name, index),
      dependencyKind: "package",
      development: dependency.is_dev === true,
      declared: dependency,
      ...(candidateSource ? { source: candidateSource } : {}),
      ...(resolvedCommit ? { resolvedCommit } : {}),
      ...(integrity ? { integrity } : {}),
      disposition: candidateSource
        ? "ready-for-loadout-review"
        : "manual-review-only",
      warnings: [
        ...(localPath
          ? ["Local lock evidence has no remote publisher provenance."]
          : []),
        ...(!candidateSource
          ? ["Lock entry has no safely convertible source pointer."]
          : []),
      ],
    });
    preservedPaths.push(`dependencies[${index}]`);
  });
  integrityCount += countHashMap(
    lock.local_deployed_file_hashes,
    "local_deployed_file_hashes",
  );
  for (const [field, value] of ownEntries(lock))
    if (!new Set(["lockfile_version", "dependencies"]).has(field))
      unsupported.push({
        path: field,
        value,
        reason: APM_LOCK_FIELDS.has(field)
          ? "OpenAPM lock evidence is preserved but not converted into an executable Loadout action."
          : "Unknown lockfile field is byte-preserved but not interpreted.",
      });
  return {
    schemaVersion: 1,
    format: "openapm-v0.1",
    artifact: "lock-evidence",
    source,
    candidates,
    preservedPaths,
    unsupported,
    trust: {
      level: integrityCount > 0 ? "integrity-evidence-present" : "unverified",
      evidence: [
        "Exact lockfile bytes and SHA-256 preserved locally.",
        ...(integrityCount > 0
          ? [
              `${integrityCount} declared content or file integrity digest or digests were observed.`,
            ]
          : []),
      ],
      uncertainties: [
        "Declared hashes are imported as evidence only; Loadout has not fetched or re-hashed the referenced content.",
        "A lockfile does not establish publisher identity, signature validity, or current safety.",
      ],
    },
    warnings: [
      "MCP configs, deployments, attestations, and deployed-file maps remain preserved evidence only.",
    ],
    executionBoundary: executionBoundary(),
  };
}

function openPackageCandidate(
  value: unknown,
  index: number,
  development: boolean,
): ImportCandidate {
  const declaration = object(value, `dependency[${index}]`);
  const name = string(declaration.name, `dependency[${index}].name`);
  const version = optionalString(
    declaration.version,
    `dependency[${index}].version`,
  );
  const base = optionalString(declaration.base, `dependency[${index}].base`);
  const partialPath = optionalString(
    declaration.path,
    `dependency[${index}].path`,
  );
  const url =
    optionalString(declaration.url, `dependency[${index}].url`) ??
    optionalString(declaration.git, `dependency[${index}].git`);
  const legacyRef = optionalString(declaration.ref, `dependency[${index}].ref`);
  const legacySubdirectory = optionalString(
    declaration.subdirectory,
    `dependency[${index}].subdirectory`,
  );
  const warnings: string[] = [];
  if (
    declaration.git !== undefined ||
    declaration.ref !== undefined ||
    declaration.subdirectory !== undefined
  )
    warnings.push(
      "Deprecated OpenPackage source fields were preserved and normalized for review.",
    );
  if (partialPath)
    warnings.push(
      "OpenPackage partial resource selection has no exact Loadout equivalent; the path is preserved for manual review.",
    );
  if (url) {
    const hash = url.lastIndexOf("#");
    const rawUrl = hash === -1 ? url : url.slice(0, hash);
    const embeddedRef = hash === -1 ? undefined : url.slice(hash + 1);
    const github = parseGitHubUrl(url);
    const sourcePath = base ?? legacySubdirectory;
    return {
      id: uniqueId(name, index),
      dependencyKind: "package",
      development,
      declared: declaration,
      source: github
        ? githubSource(github.repository, legacyRef ?? github.ref, sourcePath)
        : gitSource(rawUrl, legacyRef ?? embeddedRef, sourcePath),
      disposition: partialPath
        ? "manual-review-only"
        : "ready-for-loadout-review",
      warnings,
    };
  }
  if (base)
    return {
      id: uniqueId(name, index),
      dependencyKind: "package",
      development,
      declared: declaration,
      source: { type: "local", path: base },
      disposition: partialPath
        ? "manual-review-only"
        : "ready-for-loadout-review",
      warnings: [
        ...warnings,
        "Local paths have no remote publisher provenance.",
      ],
    };
  return {
    id: uniqueId(name, index),
    dependencyKind: "package",
    development,
    declared: declaration,
    ...(version
      ? {
          source: {
            type: "remote-registry" as const,
            registry: "https://openpackage.dev",
            name,
            version,
          },
        }
      : {}),
    disposition: "requires-resolution",
    warnings: [
      ...warnings,
      "Registry versions and ranges are declarations, not immutable resolutions; registry access is intentionally not performed.",
    ],
  };
}

const OPENPACKAGE_MANIFEST_FIELDS = new Set([
  "name",
  "version",
  "private",
  "partial",
  "platforms",
  "description",
  "keywords",
  "author",
  "license",
  "homepage",
  "repository",
  "dependencies",
  "dev-dependencies",
  "packages",
  "dev-packages",
]);

export function planOpenPackageManifestImport(
  text: string,
  filename = "openpackage.yml",
): EcosystemImportPlan {
  const source = sourceRecord(filename, text);
  const manifest = object(parseBoundedYaml(text), "OpenPackage manifest");
  const packageName = string(manifest.name, "OpenPackage manifest name");
  const packageVersion = optionalString(
    manifest.version,
    "OpenPackage manifest version",
  );
  const candidates: ImportCandidate[] = [];
  const preservedPaths = ["name"];
  const unsupported: ImportLossEntry[] = [];
  for (const [field, development] of [
    ["dependencies", false],
    ["dev-dependencies", true],
    ["packages", false],
    ["dev-packages", true],
  ] as const) {
    const values =
      manifest[field] === undefined ? [] : array(manifest[field], field);
    values.forEach((value, index) => {
      candidates.push(
        openPackageCandidate(value, candidates.length, development),
      );
      preservedPaths.push(`${field}[${index}]`);
    });
    if ((field === "packages" || field === "dev-packages") && values.length > 0)
      unsupported.push({
        path: field,
        value: values,
        reason:
          "Deprecated OpenPackage dependency field was preserved and interpreted with a migration warning.",
      });
  }
  for (const [field, value] of ownEntries(manifest))
    if (!OPENPACKAGE_MANIFEST_FIELDS.has(field))
      unsupported.push({
        path: field,
        value,
        reason:
          "Unknown OpenPackage field is byte-preserved but not interpreted.",
      });
    else if (
      !new Set([
        "name",
        "version",
        "dependencies",
        "dev-dependencies",
        "packages",
        "dev-packages",
      ]).has(field)
    )
      unsupported.push({
        path: field,
        value,
        reason:
          "OpenPackage metadata is preserved but not converted to a Loadout package field.",
      });
  return {
    schemaVersion: 1,
    format: "openpackage-current",
    artifact: "manifest",
    source,
    packageName,
    ...(packageVersion ? { packageVersion } : {}),
    candidates,
    preservedPaths,
    unsupported,
    trust: {
      level: "unverified",
      evidence: ["Exact source bytes and SHA-256 preserved locally."],
      uncertainties: [
        "Manifest version ranges are intent and were not resolved against OpenPackage registries.",
        "OpenPackage does not expose a stable normative manifest schema in its public docs; this parser targets its current documented types.",
      ],
    },
    warnings: [
      "Platforms, resource subsets, package contents, conversions, and MCP runtime files require manual review.",
    ],
    executionBoundary: executionBoundary(),
  };
}

export function planOpenPackageIndexEvidenceImport(
  text: string,
  filename = "openpackage.index.yml",
): EcosystemImportPlan {
  const source = sourceRecord(filename, text);
  const index = object(parseBoundedYaml(text), "OpenPackage index");
  const packages = object(index.packages, "OpenPackage index packages");
  const candidates: ImportCandidate[] = [];
  const preservedPaths: string[] = [];
  const unsupported: ImportLossEntry[] = [];
  let hashCount = 0;
  for (const [name, rawPackage] of ownEntries(packages)) {
    const pkg = object(rawPackage, `packages.${name}`);
    const path = string(pkg.path, `packages.${name}.path`);
    const files = object(pkg.files, `packages.${name}.files`);
    for (const mappings of Object.values(files)) {
      for (const mapping of array(mappings, `packages.${name}.files mapping`)) {
        if (mapping && typeof mapping === "object" && !Array.isArray(mapping)) {
          const item = mapping as JsonObject;
          if (typeof item.hash === "string") hashCount += 1;
          if (typeof item.sourceHash === "string") hashCount += 1;
        }
      }
    }
    candidates.push({
      id: uniqueId(name, candidates.length),
      dependencyKind: "package",
      development: false,
      declared: pkg,
      source: { type: "local", path },
      disposition: "manual-review-only",
      warnings: [
        "Workspace index paths describe installed local state, not portable package provenance.",
      ],
    });
    preservedPaths.push(`packages.${name}`);
  }
  for (const [field, value] of ownEntries(index))
    if (field !== "packages")
      unsupported.push({
        path: field,
        value,
        reason:
          "Unknown OpenPackage index field is byte-preserved but not interpreted.",
      });
  return {
    schemaVersion: 1,
    format: "openpackage-current",
    artifact: "lock-evidence",
    source,
    candidates,
    preservedPaths,
    unsupported,
    trust: {
      level: hashCount > 0 ? "integrity-evidence-present" : "unverified",
      evidence: [
        "Exact index bytes and SHA-256 preserved locally.",
        ...(hashCount > 0
          ? [
              `${hashCount} workspace mapping hash value or values were observed.`,
            ]
          : []),
      ],
      uncertainties: [
        "OpenPackage index hashes use implementation-specific workspace evidence and were not revalidated.",
        "The index is not a portable dependency lockfile and does not prove registry or publisher identity.",
      ],
    },
    warnings: [
      "File mappings, platforms, namespaces, marketplace metadata, and merge keys remain evidence only.",
    ],
    executionBoundary: executionBoundary(),
  };
}

async function readBoundedFile(
  path: string,
): Promise<{ path: string; text: string }> {
  const absolute = resolve(path);
  const text = await readFile(absolute, "utf8");
  sourceRecord(absolute, text);
  return { path: absolute, text };
}

export async function planApmImportFiles(
  manifestPath: string,
  lockPath?: string,
): Promise<EcosystemImportFiles> {
  const manifest = await readBoundedFile(manifestPath);
  const lock = lockPath ? await readBoundedFile(lockPath) : undefined;
  return {
    manifest: planApmManifestImport(manifest.text, manifest.path),
    ...(lock
      ? { lockEvidence: planApmLockEvidenceImport(lock.text, lock.path) }
      : {}),
  };
}

export async function planOpenPackageImportFiles(
  manifestPath: string,
  indexPath?: string,
): Promise<EcosystemImportFiles> {
  const manifest = await readBoundedFile(manifestPath);
  const index = indexPath ? await readBoundedFile(indexPath) : undefined;
  return {
    manifest: planOpenPackageManifestImport(manifest.text, manifest.path),
    ...(index
      ? {
          lockEvidence: planOpenPackageIndexEvidenceImport(
            index.text,
            index.path,
          ),
        }
      : {}),
  };
}
