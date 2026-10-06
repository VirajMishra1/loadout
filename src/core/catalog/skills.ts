import { cp, lstat, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type {
  ConflictDiagnostic,
  InstallPlan,
  PlannedFile,
} from "../../shared/types.js";
import { ensureDirectory } from "../agents/paths.js";
import { assertSkillSecurity, scanSkillSecurity } from "./skill-security.js";

export interface DiscoveredSkill {
  path: string;
  name?: string;
  targetName: string;
}

export interface DiscoverSkillOptions {
  include?: (skill: DiscoveredSkill) => boolean;
  /** Read-only update analysis may locate units before validating the new revision. */
  validate?: boolean;
  /** Maximum Library may retain safe siblings while recording rejected units. */
  continueOnRejected?: boolean;
  onRejected?: (skill: DiscoveredSkill & { reason: string }) => void;
}

export async function discoverSkillDirectories(
  root: string,
  options: DiscoverSkillOptions = {},
): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 4) return;
    let entries: string[];
    try {
      const directoryStat = await lstat(directory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
        if (directoryStat.isSymbolicLink())
          throw new Error(
            `Refusing symlink or non-directory package path: ${directory}`,
          );
        return;
      }
      entries = await readdir(directory);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Refusing symlink")
      )
        throw error;
      return;
    }
    if (entries.includes("SKILL.md")) {
      const skillPath = join(directory, "SKILL.md");
      const targetName = directory.split(sep).at(-1) ?? "skill";
      let name: string | undefined;
      try {
        const skillStat = await lstat(skillPath);
        if (skillStat.isFile() && !skillStat.isSymbolicLink()) {
          const frontmatter = await readFile(skillPath, "utf8");
          name = frontmatter.match(/^name:\s*(\S+)/m)?.[1];
        }
      } catch {
        // Selected invalid skills are rejected by validateSkillDirectory below.
      }
      const discovered = {
        path: directory,
        ...(name ? { name } : {}),
        targetName,
      };
      if (options.include && !options.include(discovered)) return;
      try {
        if (options.validate !== false) await validateSkillDirectory(directory);
      } catch (error) {
        if (!options.continueOnRejected) throw error;
        options.onRejected?.({
          ...discovered,
          reason: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      result.push(directory);
      // A SKILL.md directory is one atomic skill package. Resources beneath it
      // are validated as content, not recursively treated as additional skills.
      return;
    }
    // This loop only runs for directories that are NOT a skill root (a SKILL.md
    // directory returns above). Symlinks encountered while walking the repository
    // tree toward skill roots are skipped. Symlinks *inside* a skill package are
    // rejected by validateSkillDirectory -> scanSkillSecurity at the return above,
    // which fails closed on any nested symlink before the package is copied.
    for (const entry of entries) {
      if (entry === ".git" || entry === "node_modules") continue;
      const child = join(directory, entry);
      const childStat = await lstat(child);
      if (childStat.isSymbolicLink()) continue;
      // Files such as a root-level SKILL.md are not directories to recurse into.
      if (childStat.isDirectory()) await visit(child, depth + 1);
    }
  }
  await visit(root, 0);
  return result;
}

// A link such as `references/security-checklist.md`, not a deeper path like
// `docs/references/x.md`, which the lookbehind leaves to its own directory.
const SHARED_REFERENCE = /(?<![\w./-])references\/([A-Za-z0-9][\w.-]*\.md)\b/g;

async function isRegularFile(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isFile() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Some repositories keep shared checklists in a root `references/` folder that
 * their skills link to relatively. A skill copied on its own would point at
 * nothing, so plan from a staged copy that carries those files beside it.
 */
async function withSharedReferences(
  skill: string,
  packageRoot: string,
): Promise<string> {
  if (skill === packageRoot) return skill;
  const text = await readFile(join(skill, "SKILL.md"), "utf8");
  const names = new Set([...text.matchAll(SHARED_REFERENCE)].map((m) => m[1]));
  const sharedRoot = join(packageRoot, "references");
  // lstat checks only the last path segment, so a symlinked folder would let a
  // package copy files from anywhere on disk into the skill.
  const rootInfo = await lstat(sharedRoot).catch(() => undefined);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) return skill;
  const shared: string[] = [];
  for (const name of names) {
    if (!name || (await isRegularFile(join(skill, "references", name))))
      continue;
    const candidate = join(sharedRoot, name);
    if (await isRegularFile(candidate)) shared.push(candidate);
  }
  if (!shared.length) return skill;
  // ponytail: staged copies stay in the OS temp dir until it is cleaned; track and remove them if installs become frequent
  const staged = join(
    await mkdtemp(join(tmpdir(), "loadout-skill-")),
    basename(skill),
  );
  await cp(skill, staged, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await ensureDirectory(join(staged, "references"));
  for (const file of shared)
    await cp(file, join(staged, "references", basename(file)), {
      errorOnExist: true,
      force: false,
    });
  await validateSkillDirectory(staged);
  return staged;
}

function safeTarget(root: string, target: string): string {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(`${resolvedRoot}${sep}`)
  ) {
    throw new Error(`Refusing path outside target directory: ${target}`);
  }
  return resolvedTarget;
}

export async function planSkillInstall(
  sourceRoot: string,
  targetDirectories: string[],
  packageId: string,
  options: Parameters<typeof discoverSkillDirectories>[1] = {},
): Promise<InstallPlan> {
  const skills = await discoverSkillDirectories(sourceRoot, options);
  if (skills.length === 0)
    throw new Error(`No SKILL.md found under ${sourceRoot}`);
  const sources = new Map<string, string>();
  for (const skill of skills)
    sources.set(skill, await withSharedReferences(skill, sourceRoot));
  const files: PlannedFile[] = [];
  for (const targetRoot of targetDirectories) {
    try {
      const targetStat = await lstat(targetRoot);
      if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
        throw new Error(`Refusing unsafe target directory: ${targetRoot}`);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Refusing unsafe target")
      )
        throw error;
      // A not-yet-created agent directory is safe; applySkillPlan creates it.
    }
    for (const skill of skills) {
      const name =
        skill === sourceRoot
          ? packageId
          : (skill.split(sep).at(-1) ?? packageId);
      const target = safeTarget(targetRoot, join(targetRoot, name));
      const frontmatter = await readFile(join(skill, "SKILL.md"), "utf8");
      const skillName = frontmatter.match(/^name:\s*(\S+)/m)?.[1];
      files.push({ source: sources.get(skill) ?? skill, target, skillName });
    }
  }
  const conflicts = detectInstallConflicts([
    { packageId, files, targetAgents: [], warnings: [] },
  ]);
  return {
    packageId,
    files,
    targetAgents: [],
    warnings: conflicts
      .filter((item) => item.severity === "warning")
      .map((item) => item.message),
    conflicts,
  };
}

/** Compare one or more plans before any filesystem mutation occurs. */
export function detectInstallConflicts(
  plans: InstallPlan[],
): ConflictDiagnostic[] {
  const diagnostics: ConflictDiagnostic[] = [];
  const byTarget = new Map<
    string,
    Array<{ packageId: string; target: string }>
  >();
  const byName = new Map<
    string,
    Array<{ packageId: string; target: string }>
  >();
  for (const plan of plans) {
    for (const file of plan.files) {
      const target = resolve(file.target);
      const targetItems = byTarget.get(target) ?? [];
      targetItems.push({ packageId: plan.packageId, target });
      byTarget.set(target, targetItems);
      if (file.skillName) {
        const nameItems = byName.get(file.skillName.toLowerCase()) ?? [];
        nameItems.push({ packageId: plan.packageId, target });
        byName.set(file.skillName.toLowerCase(), nameItems);
      }
    }
  }
  for (const [target, items] of byTarget) {
    const packages = [...new Set(items.map((item) => item.packageId))];
    if (items.length > 1)
      diagnostics.push({
        severity: "blocking",
        code: "target-collision",
        message: `Multiple packages target the same skill directory: ${target}`,
        packageIds: packages,
        targets: [target],
      });
  }
  for (const [name, items] of byName) {
    const packages = [...new Set(items.map((item) => item.packageId))];
    const targets = [...new Set(items.map((item) => item.target))];
    if (packages.length > 1 && targets.length > 1)
      diagnostics.push({
        severity: "warning",
        code: "duplicate-skill-name",
        message: `Skill name '${name}' appears in multiple packages with different targets`,
        packageIds: packages,
        targets,
      });
  }
  return diagnostics;
}

export async function applySkillPlan(plan: InstallPlan): Promise<void> {
  for (const file of plan.files) {
    const info = await lstat(file.source);
    if (info.isSymbolicLink())
      throw new Error(`Refusing symlinked planned source: ${file.source}`);
    if (info.isDirectory()) await ensureDirectory(file.target);
    else await ensureDirectory(dirname(file.target));
    await cp(file.source, file.target, {
      recursive: info.isDirectory(),
      errorOnExist: false,
      force: true,
    });
  }
}

export async function removeSkillDirectories(plan: InstallPlan): Promise<void> {
  for (const file of plan.files)
    await rm(file.target, { recursive: true, force: true });
}

export async function validateSkillDirectory(path: string): Promise<void> {
  const directoryStat = await lstat(path);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error(`Skill path must be a real directory: ${path}`);
  }
  const skillPath = join(path, "SKILL.md");
  const skillStat = await lstat(skillPath);
  if (!skillStat.isFile() || skillStat.isSymbolicLink()) {
    throw new Error(`SKILL.md must be a regular file: ${skillPath}`);
  }
  const content = await readFile(skillPath, "utf8");
  // Repositories authored on Windows commonly use CRLF. The parser is
  // deliberately line-ending agnostic and copying preserves the original bytes.
  if (
    !/^---\s*\r?\n/.test(content) ||
    !/^name:\s*\S+/m.test(content) ||
    !/^description:\s*\S+/m.test(content)
  ) {
    throw new Error(
      `SKILL.md is missing required name/description frontmatter: ${relative(process.cwd(), path)}`,
    );
  }
  // Deeper validation stays read-only. Only deterministic critical findings fail
  // closed here; scripts, domains and dependencies continue through the explicit
  // risk-approval flow rather than being silently treated as safe.
  assertSkillSecurity(await scanSkillSecurity(path));
}
