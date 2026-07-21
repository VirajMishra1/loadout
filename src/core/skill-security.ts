import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";

export type SkillSecuritySeverity = "critical" | "high" | "medium" | "info";

export type SkillSecurityCategory =
  | "specification"
  | "size"
  | "symlink"
  | "executable"
  | "dependency"
  | "remote-instruction"
  | "domain"
  | "environment"
  | "unicode-control"
  | "prompt-injection"
  | "exfiltration"
  | "capability";

export interface SkillSecurityFinding {
  id: string;
  scanner: "deterministic" | "assisted";
  severity: SkillSecuritySeverity;
  category: SkillSecurityCategory;
  message: string;
  paths: string[];
  /** Names only. Credential values and file contents are never returned. */
  names?: string[];
}

export interface SkillInventoryFile {
  path: string;
  bytes: number;
  sha256: string;
  kind: "instruction" | "script" | "dependency-manifest" | "asset";
  executable: boolean;
}

export interface SkillCapabilityInventory {
  declaredTools: string[];
  executableFiles: string[];
  dependencyManifests: string[];
  dependencyNames: string[];
  domains: string[];
  environmentNames: string[];
}

export interface SkillScannerDisagreement {
  key: string;
  kind: "deterministic-only" | "assisted-only" | "severity-mismatch";
  deterministicSeverity?: SkillSecuritySeverity;
  assistedSeverity?: SkillSecuritySeverity;
}

export interface SkillSecurityReport {
  schemaVersion: 1;
  policy: "agent-skills-security-v1";
  rootName: string;
  specification: {
    name?: string;
    descriptionPresent: boolean;
    lineCount: number;
    progressiveDisclosureRecommended: boolean;
  };
  inventory: {
    files: SkillInventoryFile[];
    totalFiles: number;
    totalBytes: number;
    treeHash: string;
  };
  capabilities: SkillCapabilityInventory;
  deterministicFindings: SkillSecurityFinding[];
  assistedFindings: SkillSecurityFinding[];
  disagreements: SkillScannerDisagreement[];
  verdict: "pass" | "review-required" | "blocked";
  limitations: string[];
}

export interface SkillSecurityScanOptions {
  /** Optional model-assisted annotations supplied by a caller. They never override deterministic findings. */
  assistedFindings?: Omit<SkillSecurityFinding, "scanner">[];
  maxFiles?: number;
  maxTotalBytes?: number;
  maxFileBytes?: number;
}

const DEFAULT_MAX_FILES = 500;
const DEFAULT_MAX_TOTAL_BYTES = 10_000_000;
const DEFAULT_MAX_FILE_BYTES = 2_000_000;
const SCRIPT_EXTENSIONS = new Set([
  ".bat",
  ".cmd",
  ".fish",
  ".js",
  ".mjs",
  ".cjs",
  ".pl",
  ".ps1",
  ".py",
  ".rb",
  ".sh",
  ".ts",
  ".zsh",
]);
const DEPENDENCY_MANIFESTS = new Set([
  "cargo.toml",
  "composer.json",
  "gemfile",
  "go.mod",
  "package.json",
  "pipfile",
  "pyproject.toml",
  "requirements.txt",
]);
const UNICODE_CONTROL_PATTERN =
  /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u;
const DOMAIN_PATTERN = /\bhttps?:\/\/([^\s/:'"`<>)}\]]+)/giu;
const ENV_PATTERNS = [
  /process\.env\.([A-Z_][A-Z0-9_]*)/g,
  /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
  /\$\{([A-Z_][A-Z0-9_]*)\}|\$([A-Z_][A-Z0-9_]*)/g,
  /\b(?:environment|env(?:ironment)? variable)\s+([A-Z_][A-Z0-9_]*)/gi,
];
const REMOTE_INSTRUCTION_PATTERN =
  /(?:curl|wget|invoke-webrequest)\s+[^\n]*(?:\||>|-o\b)|(?:read|fetch|load|follow)\s+(?:the\s+)?instructions?\s+(?:at|from)\s+https?:\/\//i;
const INJECTION_PATTERN =
  /\b(?:ignore|disregard|override)\b.{0,60}\b(?:previous|prior|system|developer|security|safety)\b.{0,30}\binstructions?\b/gi;
const EXFILTRATION_PATTERN =
  /\b(?:send|post|upload|exfiltrate|transmit)\b.{0,100}\b(?:credentials?|secrets?|tokens?|api[_ -]?keys?|private keys?|\.ssh|\.aws|environment variables?)\b/gi;

function digest(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function normalizedPath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/") || ".";
}

function finding(
  id: string,
  severity: SkillSecuritySeverity,
  category: SkillSecurityCategory,
  message: string,
  paths: string[],
  names?: string[],
): SkillSecurityFinding {
  return {
    id,
    scanner: "deterministic",
    severity,
    category,
    message,
    paths: [...new Set(paths)].sort(),
    ...(names?.length ? { names: [...new Set(names)].sort() } : {}),
  };
}

function parseFrontmatter(content: string): {
  values: Map<string, string>;
  body: string;
  valid: boolean;
} {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n"))
    return { values: new Map(), body: normalized, valid: false };
  const close = normalized.indexOf("\n---\n", 4);
  if (close < 0) return { values: new Map(), body: "", valid: false };
  const values = new Map<string, string>();
  for (const line of normalized.slice(4, close).split("\n")) {
    const match = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*?)\s*$/);
    if (match)
      values.set(match[1].toLowerCase(), match[2].replace(/^['"]|['"]$/g, ""));
  }
  return { values, body: normalized.slice(close + 5), valid: true };
}

function dependencyNames(path: string, content: string): string[] {
  const name = basename(path).toLowerCase();
  if (name === "package.json" || name === "composer.json") {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const sections = [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "require",
      ];
      return sections.flatMap((section) => {
        const value = parsed[section];
        return value && typeof value === "object" && !Array.isArray(value)
          ? Object.keys(value as Record<string, unknown>)
          : [];
      });
    } catch {
      return [];
    }
  }
  if (name === "requirements.txt")
    return content
      .split(/\r?\n/)
      .map((line) => line.trim().match(/^([A-Za-z0-9_.-]+)/)?.[1])
      .filter((value): value is string => Boolean(value));
  return [];
}

function disagreementKey(
  item: Pick<SkillSecurityFinding, "category" | "paths">,
): string {
  return `${item.category}:${[...item.paths].sort().join(",")}`;
}

function compareFindings(
  deterministic: SkillSecurityFinding[],
  assisted: SkillSecurityFinding[],
): SkillScannerDisagreement[] {
  const left = new Map(
    deterministic.map((item) => [disagreementKey(item), item]),
  );
  const right = new Map(assisted.map((item) => [disagreementKey(item), item]));
  const result: SkillScannerDisagreement[] = [];
  for (const [key, item] of left) {
    const other = right.get(key);
    if (!other)
      result.push({
        key,
        kind: "deterministic-only",
        deterministicSeverity: item.severity,
      });
    else if (item.severity !== other.severity)
      result.push({
        key,
        kind: "severity-mismatch",
        deterministicSeverity: item.severity,
        assistedSeverity: other.severity,
      });
  }
  for (const [key, item] of right)
    if (!left.has(key))
      result.push({
        key,
        kind: "assisted-only",
        assistedSeverity: item.severity,
      });
  return result.sort((a, b) => a.key.localeCompare(b.key));
}

function hasUnnegatedMatch(content: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  for (const match of content.matchAll(pattern)) {
    const before = content.slice(
      Math.max(0, (match.index ?? 0) - 32),
      match.index,
    );
    if (
      !/(?:\bnever|\bdo not|\bdon't|\bmust not|\bshould not)\s*$/i.test(before)
    )
      return true;
  }
  return false;
}

/**
 * Inspect an Agent Skill without executing it. Output contains hashes, paths and
 * capability names only; instruction text and credential values never leave the scanner.
 */
export async function scanSkillSecurity(
  skillRoot: string,
  options: SkillSecurityScanOptions = {},
): Promise<SkillSecurityReport> {
  const root = resolve(skillRoot);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error(`Skill path must be a real directory: ${skillRoot}`);

  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const inventory: SkillInventoryFile[] = [];
  const contents = new Map<string, string>();
  const findings: SkillSecurityFinding[] = [];
  let totalBytes = 0;
  const ignoredDirectories = new Set([".git", ".cache", "node_modules"]);

  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 12) {
      findings.push(
        finding(
          "tree-depth",
          "high",
          "size",
          "Skill tree exceeds the bounded inspection depth.",
          [normalizedPath(root, directory)],
        ),
      );
      return;
    }
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const absolute = join(directory, entry.name);
      const path = normalizedPath(root, absolute);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) {
        findings.push(
          finding(
            "symlink",
            "critical",
            "symlink",
            "Symlinks are not permitted inside a reviewed skill.",
            [path],
          ),
        );
        continue;
      }
      if (info.isDirectory()) {
        await visit(absolute, depth + 1);
        continue;
      }
      if (!info.isFile()) continue;
      if (inventory.length >= maxFiles)
        throw new Error(`Skill exceeds inspection file limit (${maxFiles})`);
      if (info.size > maxFileBytes)
        throw new Error(`Skill file exceeds inspection byte limit: ${path}`);
      totalBytes += info.size;
      if (totalBytes > maxTotalBytes)
        throw new Error(
          `Skill exceeds inspection byte limit (${maxTotalBytes})`,
        );
      const content = await readFile(absolute);
      const text = content.toString("utf8");
      const lowerName = entry.name.toLowerCase();
      const manifest = DEPENDENCY_MANIFESTS.has(lowerName);
      const script =
        SCRIPT_EXTENSIONS.has(extname(entry.name).toLowerCase()) ||
        path.startsWith("scripts/") ||
        text.startsWith("#!");
      const executable = (info.mode & 0o111) !== 0 || text.startsWith("#!");
      inventory.push({
        path,
        bytes: info.size,
        sha256: digest(content),
        kind:
          path === "SKILL.md"
            ? "instruction"
            : manifest
              ? "dependency-manifest"
              : script
                ? "script"
                : "asset",
        executable,
      });
      contents.set(path, text);
    }
  }
  await visit(root, 0);

  const skillText = contents.get("SKILL.md");
  if (skillText === undefined)
    findings.push(
      finding(
        "skill-file",
        "critical",
        "specification",
        "SKILL.md is required.",
        ["SKILL.md"],
      ),
    );
  const parsed = parseFrontmatter(skillText ?? "");
  const name = parsed.values.get("name");
  const description = parsed.values.get("description") ?? "";
  const compatibility = parsed.values.get("compatibility") ?? "";
  if (!parsed.valid)
    findings.push(
      finding(
        "frontmatter",
        "critical",
        "specification",
        "SKILL.md must contain closed YAML frontmatter.",
        ["SKILL.md"],
      ),
    );
  if (!name || name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
    findings.push(
      finding(
        "name",
        "critical",
        "specification",
        "Skill name must be 1-64 lowercase letters, numbers, or single hyphens.",
        ["SKILL.md"],
      ),
    );
  if (name && name !== basename(root))
    findings.push(
      finding(
        "directory-name",
        "medium",
        "specification",
        "Skill name does not match its parent directory.",
        ["SKILL.md"],
      ),
    );
  if (!description || description.length > 1024)
    findings.push(
      finding(
        "description",
        "critical",
        "specification",
        "Skill description must contain 1-1024 characters.",
        ["SKILL.md"],
      ),
    );
  if (compatibility.length > 500)
    findings.push(
      finding(
        "compatibility",
        "high",
        "specification",
        "Compatibility metadata exceeds 500 characters.",
        ["SKILL.md"],
      ),
    );

  const lineCount = (skillText ?? "").split(/\r?\n/).length;
  if (lineCount > 500)
    findings.push(
      finding(
        "progressive-disclosure",
        "medium",
        "size",
        "SKILL.md exceeds the recommended 500-line progressive-disclosure boundary.",
        ["SKILL.md"],
      ),
    );

  const domains = new Set<string>();
  const envNames = new Set<string>();
  const executableFiles: string[] = [];
  const dependencyManifests: string[] = [];
  const dependencies = new Set<string>();
  for (const item of inventory) {
    const text = contents.get(item.path) ?? "";
    DOMAIN_PATTERN.lastIndex = 0;
    for (const match of text.matchAll(DOMAIN_PATTERN))
      if (match[1]) domains.add(match[1].toLowerCase());
    for (const pattern of ENV_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const envName = (match[1] ?? match[2] ?? "").toUpperCase();
        if (envName) envNames.add(envName);
      }
    }
    if (item.kind === "script" || item.executable)
      executableFiles.push(item.path);
    if (item.kind === "dependency-manifest") {
      dependencyManifests.push(item.path);
      for (const dependency of dependencyNames(item.path, text))
        dependencies.add(dependency);
    }
    if (UNICODE_CONTROL_PATTERN.test(text))
      findings.push(
        finding(
          `unicode:${item.path}`,
          "critical",
          "unicode-control",
          "File contains invisible or bidirectional Unicode controls.",
          [item.path],
        ),
      );
    if (REMOTE_INSTRUCTION_PATTERN.test(text))
      findings.push(
        finding(
          `remote:${item.path}`,
          "high",
          "remote-instruction",
          "Instructions load or execute mutable remote content.",
          [item.path],
        ),
      );
    if (hasUnnegatedMatch(text, INJECTION_PATTERN))
      findings.push(
        finding(
          `injection:${item.path}`,
          "critical",
          "prompt-injection",
          "Instructions attempt to override higher-priority or safety instructions.",
          [item.path],
        ),
      );
    if (hasUnnegatedMatch(text, EXFILTRATION_PATTERN))
      findings.push(
        finding(
          `exfiltration:${item.path}`,
          "critical",
          "exfiltration",
          "Instructions appear to transmit credential or secret material.",
          [item.path],
        ),
      );
  }
  if (executableFiles.length)
    findings.push(
      finding(
        "executables",
        "high",
        "executable",
        "Skill contains executable or script content that requires explicit review.",
        executableFiles,
      ),
    );
  if (dependencyManifests.length)
    findings.push(
      finding(
        "dependencies",
        "high",
        "dependency",
        "Skill declares external dependencies that require provenance review.",
        dependencyManifests,
        [...dependencies],
      ),
    );
  if (domains.size)
    findings.push(
      finding(
        "domains",
        "high",
        "domain",
        "Skill references network domains that require explicit approval.",
        inventory
          .filter((item) =>
            [...domains].some((domain) =>
              (contents.get(item.path) ?? "").toLowerCase().includes(domain),
            ),
          )
          .map((item) => item.path),
        [...domains],
      ),
    );
  if (envNames.size)
    findings.push(
      finding(
        "environment",
        "high",
        "environment",
        "Skill references environment-variable names; values were not read.",
        inventory
          .filter((item) =>
            [...envNames].some((envName) =>
              (contents.get(item.path) ?? "").includes(envName),
            ),
          )
          .map((item) => item.path),
        [...envNames],
      ),
    );

  const declaredTools = (parsed.values.get("allowed-tools") ?? "")
    .split(/\s+/)
    .filter(Boolean);
  if (
    (executableFiles.length || domains.size || envNames.size) &&
    declaredTools.length === 0 &&
    !compatibility
  )
    findings.push(
      finding(
        "capability-declaration",
        "medium",
        "capability",
        "Executable, network, or environment capabilities are not declared in frontmatter.",
        ["SKILL.md"],
      ),
    );

  const deterministicFindings = findings.sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const assistedFindings = (options.assistedFindings ?? []).map((item) => ({
    ...item,
    scanner: "assisted" as const,
  }));
  const filesSorted = inventory.sort((a, b) => a.path.localeCompare(b.path));
  const treeHash = digest(
    filesSorted
      .map((item) => `${item.path}\0${item.bytes}\0${item.sha256}`)
      .join("\n"),
  );
  const verdict = deterministicFindings.some(
    (item) => item.severity === "critical",
  )
    ? "blocked"
    : deterministicFindings.some(
          (item) => item.severity === "high" || item.severity === "medium",
        ) || assistedFindings.length
      ? "review-required"
      : "pass";
  return {
    schemaVersion: 1,
    policy: "agent-skills-security-v1",
    rootName: basename(root),
    specification: {
      ...(name ? { name } : {}),
      descriptionPresent: Boolean(description),
      lineCount,
      progressiveDisclosureRecommended: lineCount <= 500,
    },
    inventory: {
      files: filesSorted,
      totalFiles: filesSorted.length,
      totalBytes,
      treeHash,
    },
    capabilities: {
      declaredTools,
      executableFiles: executableFiles.sort(),
      dependencyManifests: dependencyManifests.sort(),
      dependencyNames: [...dependencies].sort(),
      domains: [...domains].sort(),
      environmentNames: [...envNames].sort(),
    },
    deterministicFindings,
    assistedFindings,
    disagreements: compareFindings(deterministicFindings, assistedFindings),
    verdict,
    limitations: [
      "Static inspection cannot prove runtime safety or task quality.",
      "Assisted findings are annotations and cannot clear a deterministic critical finding.",
      "Dependency names are inventory evidence, not license or vulnerability approval.",
    ],
  };
}

export function assertSkillSecurity(report: SkillSecurityReport): void {
  const critical = report.deterministicFindings.filter(
    (item) => item.severity === "critical",
  );
  if (critical.length)
    throw new Error(
      `Skill security validation failed: ${critical.map((item) => item.id).join(", ")}`,
    );
}
