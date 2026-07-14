import { readFile, readdir, stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import type { InstallPlan } from "../shared/types.js";

export type SafetySeverity = "blocking" | "warning";
export type SafetyCategory = "hook" | "script" | "binary" | "domain" | "environment" | "secret" | "instruction" | "mcp";

export interface SafetyFinding {
  severity: SafetySeverity;
  category: SafetyCategory;
  message: string;
  paths: string[];
  /** Domain or environment names only; never values or credentials. */
  names?: string[];
}

export interface UpdateSafetyAnalysis {
  approvalRequired: boolean;
  findings: SafetyFinding[];
}

const BINARY_EXTENSIONS = /\.(?:exe|dll|so|dylib|bin|msi|dmg|appimage)$/i;
const SCRIPT_EXTENSIONS = /\.(?:sh|bash|zsh|fish|ps1|bat|cmd|py|rb|pl)$/i;
const DOMAIN_PATTERN = /\bhttps?:\/\/([^\s/:'"`<>)}\]]+)/gi;
const ENV_PATTERNS = [
  /process\.env\.([A-Z_][A-Z0-9_]*)/g,
  /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
  /\b(?:env|environment)\s*[:=]\s*["']?([A-Z_][A-Z0-9_]*)/gi,
  /\$\{([A-Z_][A-Z0-9_]*)\}|\$([A-Z_][A-Z0-9_]*)/g,
];
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "GitHub token", pattern: /\bgh[oprsu]_[A-Za-z0-9_]{30,}\b/ },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "generic API key assignment", pattern: /\b(?:api[_-]?key|secret|token)["']?\s*[:=]\s*["'][A-Za-z0-9_./+=-]{20,}["']/i },
];
const SUSPICIOUS_INSTRUCTIONS: Array<{ name: string; pattern: RegExp }> = [
  { name: "instruction override", pattern: /\bignore (?:all |any )?(?:previous|prior|system|developer) instructions?\b/i },
  { name: "credential extraction", pattern: /\b(?:read|print|send|upload|exfiltrate)\b.{0,80}\b(?:credentials?|tokens?|secrets?|\.ssh|\.aws)\b/i },
  { name: "hidden destructive command", pattern: /\b(?:rm\s+-rf|del\s+\/s|format\s+[a-z]:)\b/i },
];

export function detectSecretKinds(content: string): string[] {
  return SECRET_PATTERNS.filter((check) => check.pattern.test(content)).map((check) => check.name);
}

async function files(root: string): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  const base = resolve(root);
  try {
    const rootInfo = await stat(base);
    if (rootInfo.isFile() && rootInfo.size <= 2_000_000) {
      result.set(basename(base), await readFile(base));
      return result;
    }
  } catch { return result; }
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 10) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const absolute = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { await visit(absolute, depth + 1); continue; }
      if (!entry.isFile()) continue;
      try {
        const info = await stat(absolute);
        if (info.size > 2_000_000) continue;
        result.set(relative(base, absolute).split("\\").join("/"), await readFile(absolute));
      } catch { /* repository may change while being inspected */ }
    }
  }
  await visit(base, 0);
  return result;
}

/** Scan only the component sources selected by a plan, never unrelated repository files. */
export async function analyzeInstallPlanSafety(plan: InstallPlan): Promise<UpdateSafetyAnalysis> {
  const roots = [...new Set(plan.files.map((file) => file.source))];
  const analyses = await Promise.all(roots.map((root) => analyzeUpdateSafety(undefined, root)));
  const findings = analyses.flatMap((analysis) => analysis.findings);
  const unique = new Map<string, SafetyFinding>();
  for (const finding of findings) {
    const key = `${finding.severity}:${finding.category}:${finding.message}:${finding.paths.join(",")}:${finding.names?.join(",") ?? ""}`;
    unique.set(key, finding);
  }
  const result = [...unique.values()];
  return { approvalRequired: result.some((finding) => finding.severity === "blocking"), findings: result };
}

function changedPaths(oldFiles: Map<string, Buffer>, newFiles: Map<string, Buffer>): string[] {
  return [...new Set([...oldFiles.keys(), ...newFiles.keys()])].filter((path) => {
    const oldValue = oldFiles.get(path);
    const newValue = newFiles.get(path);
    return !oldValue || !newValue || !oldValue.equals(newValue);
  }).sort();
}

function collectDomains(content: string): string[] {
  return [...content.matchAll(DOMAIN_PATTERN)].map((match) => match[1].toLowerCase()).filter(Boolean);
}

function collectEnvironmentNames(content: string): string[] {
  const names = new Set<string>();
  for (const pattern of ENV_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const name = (match[1] ?? match[2] ?? "").toUpperCase();
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

/** Analyze changed repository files without running package code or revealing secret values. */
export async function analyzeUpdateSafety(oldPath: string | undefined, newPath: string): Promise<UpdateSafetyAnalysis> {
  const oldFiles = oldPath ? await files(oldPath) : new Map<string, Buffer>();
  const newFiles = await files(newPath);
  const changed = changedPaths(oldFiles, newFiles);
  const findings: SafetyFinding[] = [];
  const domains = new Set<string>();
  const envNames = new Set<string>();
  const hookPaths: string[] = [];
  const scriptPaths: string[] = [];
  const binaryPaths: string[] = [];
  const secretPaths: string[] = [];
  const secretKinds = new Set<string>();
  const instructionPaths: string[] = [];
  const instructionKinds = new Set<string>();

  for (const path of changed) {
    const lower = path.toLowerCase();
    const content = newFiles.get(path)?.toString("utf8") ?? "";
    if (BINARY_EXTENSIONS.test(path) || lower.includes("/bin/") || lower.startsWith("bin/")) binaryPaths.push(path);
    if (SCRIPT_EXTENSIONS.test(path) || lower.includes("/scripts/") || lower.startsWith("scripts/")) scriptPaths.push(path);
    if (lower.includes("hook") || lower === "package.json" && /"(?:pre|post)?(?:install|publish|pack|prepare)"\s*:/.test(content)) hookPaths.push(path);
    for (const domain of collectDomains(content)) domains.add(domain);
    for (const name of collectEnvironmentNames(content)) envNames.add(name);
    for (const kind of detectSecretKinds(content)) { secretPaths.push(path); secretKinds.add(kind); }
    for (const check of SUSPICIOUS_INSTRUCTIONS) if (check.pattern.test(content)) { instructionPaths.push(path); instructionKinds.add(check.name); }
  }
  if (binaryPaths.length) findings.push({ severity: "blocking", category: "binary", message: "Update adds or changes executable/binary files.", paths: binaryPaths });
  if (scriptPaths.length) findings.push({ severity: "blocking", category: "script", message: "Update adds or changes scripts that may execute during setup or use.", paths: scriptPaths });
  if (hookPaths.length) findings.push({ severity: "blocking", category: "hook", message: "Update changes hooks or package lifecycle configuration.", paths: hookPaths });
  if (domains.size) findings.push({ severity: "blocking", category: "domain", message: "Update references network domains; verify and explicitly approve the new network surface.", paths: changed.filter((path) => collectDomains(newFiles.get(path)?.toString("utf8") ?? "").length > 0), names: [...domains].sort() });
  if (envNames.size) findings.push({ severity: "blocking", category: "environment", message: "Update references environment-variable names; values are not inspected or displayed, and explicit approval is required.", paths: changed.filter((path) => collectEnvironmentNames(newFiles.get(path)?.toString("utf8") ?? "").length > 0), names: [...envNames].sort() });
  if (secretPaths.length) findings.push({ severity: "blocking", category: "secret", message: "Content appears to contain embedded secret material; secret values are hidden.", paths: [...new Set(secretPaths)].sort(), names: [...secretKinds].sort() });
  if (instructionPaths.length) findings.push({ severity: "blocking", category: "instruction", message: "Content contains suspicious instruction patterns that require human review.", paths: [...new Set(instructionPaths)].sort(), names: [...instructionKinds].sort() });
  return { approvalRequired: findings.some((finding) => finding.severity === "blocking"), findings };
}
