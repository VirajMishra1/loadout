/**
 * Auto-contract detection — scans for cross-boundary exports and suggests
 * contracts when shared interfaces change.
 *
 * Uses regex-based scanning (no TS compiler dependency) to find exported
 * symbols and cross-ownership imports. Runs as a pre-handoff check or
 * standalone via `loadout coord detect`.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, posix } from "node:path";
import {
  getOwnership,
  getContracts,
  type ActiveContract,
} from "./coordinator.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface ExportedSymbol {
  /** The exported name (e.g. "UserResponse", "fetchData"). */
  name: string;
  /** What kind of export: type, interface, function, const, class, enum, re-export. */
  kind: string;
  /** Source file relative to project root. */
  file: string;
  /** 1-indexed line number. */
  line: number;
  /** Exact, safely reusable declaration when it fits on one line. */
  declaration?: string;
}

export interface CrossBoundaryImport {
  /** The file doing the import (relative to project root). */
  importer: string;
  /** Agent that owns the importing file. */
  importerAgent: string;
  /** The file being imported (relative to project root). */
  source: string;
  /** Agent that owns the source file. */
  sourceAgent: string;
  /** Imported symbol names. */
  symbols: string[];
}

export interface ContractCandidate {
  /** Suggested contract name (derived from source file). */
  name: string;
  /** The source file whose exports cross a boundary. */
  sourceFile: string;
  /** Agent that owns the source. */
  sourceAgent: string;
  /** Agents that import from this file. */
  consumers: string[];
  /** Exported symbols that are consumed cross-boundary. */
  sharedSymbols: ExportedSymbol[];
  /** Whether a contract already covers this file. */
  existingContract?: ActiveContract;
  /** Suggested contract body (TypeScript export declarations). */
  suggestedBody: string;
  /** Hash of the exact declaration block used to detect stale contracts. */
  sourceHash: string;
  /** False when at least one consumed export needs a human-written contract. */
  publishable: boolean;
  coverageState: "uncovered" | "current" | "stale";
}

export interface DetectionResult {
  /** All cross-boundary imports found. */
  crossBoundaryImports: CrossBoundaryImport[];
  /** Contract candidates — files whose exports should be contracts. */
  candidates: ContractCandidate[];
  /** Files scanned. */
  filesScanned: number;
}

// ── Export scanning ────────────────────────────────────────────────────

const EXPORT_PATTERNS: { pattern: RegExp; kind: string }[] = [
  {
    pattern: /^export\s+(?:declare\s+)?interface\s+(\w+)/,
    kind: "interface",
  },
  {
    pattern: /^export\s+(?:declare\s+)?type\s+(\w+)/,
    kind: "type",
  },
  {
    pattern: /^export\s+(?:declare\s+)?(?:async\s+)?function\s+(\w+)/,
    kind: "function",
  },
  {
    pattern: /^export\s+(?:declare\s+)?const\s+(\w+)/,
    kind: "const",
  },
  {
    pattern: /^export\s+(?:declare\s+)?let\s+(\w+)/,
    kind: "const",
  },
  {
    pattern: /^export\s+(?:declare\s+)?class\s+(\w+)/,
    kind: "class",
  },
  {
    pattern: /^export\s+(?:declare\s+)?enum\s+(\w+)/,
    kind: "enum",
  },
  {
    pattern: /^export\s+(?:declare\s+)?abstract\s+class\s+(\w+)/,
    kind: "class",
  },
];

// Matches `export { Foo, Bar } from "./module"` and `export { Foo, Bar }`
const RE_EXPORT = /^export\s*\{([^}]+)\}(?:\s*from\s*["']([^"']+)["'])?/;

function scanExports(content: string, filePath: string): ExportedSymbol[] {
  const symbols: ExportedSymbol[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimStart();
    if (!line.startsWith("export")) continue;

    // Named export patterns
    for (const { pattern, kind } of EXPORT_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        const declaration = exactDeclaration(line.trim(), kind);
        symbols.push({
          name: match[1],
          kind,
          file: filePath,
          line: i + 1,
          ...(declaration ? { declaration } : {}),
        });
        break;
      }
    }

    // Re-exports: export { X, Y } from "..."
    const reMatch = line.match(RE_EXPORT);
    if (reMatch) {
      const names = reMatch[1]
        .split(",")
        .map((s) =>
          s
            .trim()
            .split(/\s+as\s+/)
            .pop()!
            .trim(),
        )
        .filter(Boolean);
      for (const name of names) {
        symbols.push({
          name,
          kind: "re-export",
          file: filePath,
          line: i + 1,
          declaration: line.trim(),
        });
      }
    }
  }

  return symbols;
}

function exactDeclaration(line: string, kind: string): string | undefined {
  if (kind === "function") {
    const close = line.lastIndexOf(")");
    const body = close >= 0 ? line.indexOf("{", close) : -1;
    if (body > close) return `${line.slice(0, body).trimEnd()};`;
    return line.endsWith(";") ? line : undefined;
  }
  if (kind === "interface" || kind === "class" || kind === "enum") {
    return line.includes("{") && line.includes("}") ? line : undefined;
  }
  if (kind === "type" || kind === "const") {
    if (!line.includes("=")) return undefined;
    // Reject incomplete multi-line declarations (opens a block without closing it).
    const afterEq = line.slice(line.indexOf("=") + 1).trim();
    if (afterEq.includes("{") && !afterEq.includes("}")) return undefined;
    if (afterEq.includes("(") && !afterEq.includes(")")) return undefined;
    if (afterEq.includes("[") && !afterEq.includes("]")) return undefined;
    return line;
  }
  return undefined;
}

// ── Import scanning ────────────────────────────────────────────────────

// Matches: import { X, Y } from "./path"
//          import type { X } from "./path"
//          import X from "./path"
const IMPORT_PATTERNS = [
  // Named imports: import { A, B } from "..."
  /import\s+(?:type\s+)?\{([^}]+)\}\s*from\s*["']([^"']+)["']/g,
  // Default import: import X from "..."
  /import\s+(\w+)\s+from\s*["']([^"']+)["']/g,
  // Side-effect import is excluded (no symbols)
];

interface ImportInfo {
  symbols: string[];
  source: string;
}

function scanImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const symbolPart = match[1];
      const source = match[2];

      // Skip node_modules / bare specifiers
      if (!source.startsWith(".") && !source.startsWith("/")) continue;

      const symbols =
        symbolPart.includes(",") || symbolPart.includes("{")
          ? symbolPart
              .split(",")
              .map((s) =>
                s
                  .trim()
                  .replace(/^type\s+/, "")
                  .split(/\s+as\s+/)[0]
                  .trim(),
              )
              .filter(Boolean)
          : [symbolPart.trim()];

      imports.push({ symbols, source });
    }
  }

  return imports;
}

// ── File walking ───────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".handoff",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  "__pycache__",
]);

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const JS_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs"]);
const ALL_EXTENSIONS = new Set([...TS_EXTENSIONS, ...JS_EXTENSIONS]);

async function walkFiles(
  dir: string,
  rootDir: string,
  maxFiles: number,
): Promise<string[]> {
  const files: string[] = [];

  async function walk(current: string): Promise<void> {
    if (files.length >= maxFiles) return;
    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      if (SKIP_DIRS.has(entry.name)) continue;

      const fullPath = join(current, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = entry.name.slice(entry.name.lastIndexOf("."));
        if (ALL_EXTENSIONS.has(ext)) {
          files.push(normalizeProjectPath(relative(rootDir, fullPath)));
        }
      }
    }
  }

  await walk(dir);
  return files;
}

// ── Ownership resolution ───────────────────────────────────────────────

type OwnershipMap = Map<string, { agent: string; paths: string[] }>;

export function normalizeProjectPath(value: string): string {
  const normalized = posix.normalize(value.replaceAll("\\", "/"));
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

function findOwner(
  filePath: string,
  ownership: OwnershipMap,
): string | undefined {
  // Find the most specific (longest) owned path that covers this file
  let bestMatch = "";
  let bestAgent: string | undefined;

  const normalizedFile = normalizeProjectPath(filePath);
  for (const [, claim] of ownership) {
    for (const ownedPath of claim.paths) {
      const claimPath = normalizeProjectPath(ownedPath);
      const normalized = claimPath.endsWith("/")
        ? claimPath.slice(0, -1)
        : claimPath;
      if (
        (normalizedFile === normalized ||
          normalizedFile.startsWith(normalized + "/") ||
          normalized === ".") &&
        normalized.length > bestMatch.length
      ) {
        bestMatch = normalized;
        bestAgent = claim.agent;
      }
    }
  }

  return bestAgent;
}

// ── Import resolution ──────────────────────────────────────────────────

function resolveImportPath(importSource: string, importerFile: string): string {
  const importerDir = posix.dirname(normalizeProjectPath(importerFile));
  let resolved = posix.normalize(
    posix.join(importerDir, normalizeProjectPath(importSource)),
  );
  if (resolved === ".." || resolved.startsWith("../")) return "";
  // Strip .js extension (TS files import as .js)
  resolved = resolved.replace(/\.js$/, "");
  return resolved;
}

function matchSourceFile(
  resolvedImport: string,
  allFiles: string[],
): string | undefined {
  // Try exact match, then with extensions
  for (const ext of ["", ".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"]) {
    const candidate = resolvedImport + ext;
    if (allFiles.includes(candidate)) return candidate;
  }
  // Try index file
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    const candidate = resolvedImport + "/index" + ext;
    if (allFiles.includes(candidate)) return candidate;
  }
  return undefined;
}

// ── Main detection ─────────────────────────────────────────────────────

/** Max files to scan to keep detection fast. */
const MAX_FILES = 5_000;

export async function detectContracts(
  projectRoot: string,
  options: {
    /** Only scan files within these directories. */
    scope?: string[];
    /** Max files to scan. */
    maxFiles?: number;
  } = {},
): Promise<DetectionResult> {
  const ownership = await getOwnership(projectRoot);
  const existingContracts = await getContracts(projectRoot);

  // If no ownership is set up, can't detect cross-boundary imports
  if (ownership.size === 0) {
    return { crossBoundaryImports: [], candidates: [], filesScanned: 0 };
  }

  const maxFiles = options.maxFiles ?? MAX_FILES;

  // Walk project files
  const walkedFiles = options.scope
    ? (
        await Promise.all(
          options.scope.map((dir) => {
            const scope = normalizeProjectPath(dir);
            if (
              !scope ||
              posix.isAbsolute(scope) ||
              scope === ".." ||
              scope.startsWith("../")
            )
              throw new Error(`Scope must stay inside the project: ${dir}`);
            return walkFiles(
              join(projectRoot, ...scope.split("/")),
              projectRoot,
              maxFiles,
            );
          }),
        )
      ).flat()
    : await walkFiles(projectRoot, projectRoot, maxFiles);
  const allFiles = [...new Set(walkedFiles)].slice(0, maxFiles);

  // Scan exports for every file
  const exportsByFile = new Map<string, ExportedSymbol[]>();
  for (const file of allFiles) {
    try {
      const content = await readFile(join(projectRoot, file), "utf8");
      const exports = scanExports(content, file);
      if (exports.length > 0) {
        exportsByFile.set(file, exports);
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Scan imports and find cross-boundary references
  const crossBoundaryImports: CrossBoundaryImport[] = [];

  for (const file of allFiles) {
    const importerAgent = findOwner(file, ownership);
    if (!importerAgent) continue;

    let content: string;
    try {
      content = await readFile(join(projectRoot, file), "utf8");
    } catch {
      continue;
    }

    const imports = scanImports(content);
    for (const imp of imports) {
      const resolved = resolveImportPath(imp.source, file);
      const sourceFile = matchSourceFile(resolved, allFiles);
      if (!sourceFile) continue;

      const sourceAgent = findOwner(sourceFile, ownership);
      if (!sourceAgent || sourceAgent === importerAgent) continue;

      crossBoundaryImports.push({
        importer: file,
        importerAgent,
        source: sourceFile,
        sourceAgent,
        symbols: imp.symbols,
      });
    }
  }

  // Group by source file → contract candidate
  const candidateMap = new Map<
    string,
    {
      sourceAgent: string;
      consumers: Set<string>;
      symbols: Set<string>;
    }
  >();

  for (const xbi of crossBoundaryImports) {
    const existing = candidateMap.get(xbi.source);
    if (existing) {
      existing.consumers.add(xbi.importerAgent);
      for (const s of xbi.symbols) existing.symbols.add(s);
    } else {
      candidateMap.set(xbi.source, {
        sourceAgent: xbi.sourceAgent,
        consumers: new Set([xbi.importerAgent]),
        symbols: new Set(xbi.symbols),
      });
    }
  }

  // Build candidates
  const candidates: ContractCandidate[] = [];
  for (const [sourceFile, info] of candidateMap) {
    const allExports = exportsByFile.get(sourceFile) ?? [];
    const sharedSymbols = allExports.filter((e) => info.symbols.has(e.name));

    // Generate contract name from file path
    const name = contractNameFromPath(sourceFile);

    // Check if contract already exists
    const existingContract = existingContracts.get(name);

    // Build suggested body from shared exports
    const generated = buildContractBody(sourceFile, sharedSymbols);
    const coverageState = !existingContract
      ? "uncovered"
      : existingContract.body === generated.body
        ? "current"
        : "stale";

    candidates.push({
      name,
      sourceFile,
      sourceAgent: info.sourceAgent,
      consumers: [...info.consumers],
      sharedSymbols,
      existingContract,
      suggestedBody: generated.body,
      sourceHash: generated.sourceHash,
      publishable: generated.publishable,
      coverageState,
    });
  }

  // Sort: uncovered (no existing contract) first, then by consumer count
  candidates.sort((a, b) => {
    if (!a.existingContract && b.existingContract) return -1;
    if (a.existingContract && !b.existingContract) return 1;
    return b.consumers.length - a.consumers.length;
  });

  return {
    crossBoundaryImports,
    candidates,
    filesScanned: allFiles.length,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function contractNameFromPath(filePath: string): string {
  // src/api/types.ts → api-types
  // src/core/coordination/events.ts → coordination-events
  return filePath
    .replace(/^src\//, "")
    .replace(/\.(ts|tsx|js|jsx|mts|mjs|cts|cjs)$/, "")
    .replace(/\/index$/, "")
    .replace(/\//g, "-");
}

function buildContractBody(
  sourceFile: string,
  symbols: ExportedSymbol[],
): { body: string; sourceHash: string; publishable: boolean } {
  if (symbols.length === 0) {
    const manual = `// MANUAL: no exact typed exports detected for ${sourceFile}`;
    return {
      body: manual,
      sourceHash: createHash("sha256").update("").digest("hex"),
      publishable: false,
    };
  }

  const declarations = symbols.map(
    (symbol) =>
      symbol.declaration ??
      `// MANUAL: copy the complete ${symbol.kind} declaration for ${symbol.name}`,
  );
  const declarationBlock = declarations.join("\n");
  const sourceHash = createHash("sha256")
    .update(declarationBlock)
    .digest("hex");

  const lines: string[] = [
    `// Auto-detected contract for ${sourceFile}`,
    "// Snapshot only — the canonical source module remains authoritative.",
    `// ${symbols.length} shared export(s)`,
    `// loadout-source-sha256: sha256-${sourceHash}`,
    "",
    ...declarations,
  ];
  return {
    body: lines.join("\n"),
    sourceHash,
    publishable: symbols.every((symbol) => !!symbol.declaration),
  };
}

// ── Terminal formatting ────────────────────────────────────────────────

export function formatDetectionResult(result: DetectionResult): string {
  const lines: string[] = [];

  if (result.candidates.length === 0) {
    lines.push("No cross-boundary exports detected.");
    lines.push(`Scanned ${result.filesScanned} file(s).`);
    if (result.crossBoundaryImports.length === 0) {
      lines.push(
        "\x1b[90mEither no ownership is set, or all imports stay within owned boundaries.\x1b[0m",
      );
    }
    return lines.join("\n");
  }

  lines.push(
    `\x1b[1mAuto-detected ${result.candidates.length} contract candidate(s)\x1b[0m`,
  );
  lines.push(
    `\x1b[90m${result.filesScanned} files scanned · ${result.crossBoundaryImports.length} cross-boundary import(s)\x1b[0m`,
  );
  lines.push("");

  for (const c of result.candidates) {
    const status =
      c.coverageState === "current"
        ? `\x1b[32m✓ current at rev${c.existingContract!.revision}\x1b[0m`
        : c.coverageState === "stale"
          ? `\x1b[33m⚠ stale at rev${c.existingContract!.revision}\x1b[0m`
          : "\x1b[33m⚠ no contract\x1b[0m";

    lines.push(`  \x1b[1m${c.name}\x1b[0m  ${status}`);
    lines.push(
      `    Source: \x1b[36m${c.sourceFile}\x1b[0m (owned by ${c.sourceAgent})`,
    );
    lines.push(`    Consumers: ${c.consumers.join(", ")}`);
    lines.push(
      `    Shared: ${c.sharedSymbols.map((s) => s.name).join(", ") || "(barrel/re-exports)"}`,
    );
    if (!c.publishable)
      lines.push(
        "    \x1b[31mManual declaration required before publishing.\x1b[0m",
      );
    lines.push("");
  }

  const uncovered = result.candidates.filter(
    (c) => c.coverageState !== "current",
  );
  if (uncovered.length > 0) {
    lines.push(
      `\x1b[33m${uncovered.length} uncovered boundary(ies).\x1b[0m Publish with:`,
    );
    for (const c of uncovered) {
      lines.push(
        `  loadout coord contract ${c.name} --agent ${c.sourceAgent} --body "..." --format typescript`,
      );
    }
  }

  return lines.join("\n");
}
