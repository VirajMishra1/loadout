import { cp, lstat, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type {
  ConflictDiagnostic,
  InstallPlan,
  PlannedFile,
} from "../shared/types.js";
import { ensureDirectory } from "./paths.js";

export async function discoverSkillDirectories(
  root: string,
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
      await validateSkillDirectory(directory);
      result.push(directory);
    }
    for (const entry of entries) {
      if (entry === ".git" || entry === "node_modules") continue;
      const child = join(directory, entry);
      const childStat = await lstat(child);
      // Repositories may contain unrelated symlinked documentation or metadata.
      // Ignore those while walking, but validate and reject symlinks inside an
      // actual skill directory before it is copied.
      if (childStat.isSymbolicLink()) {
        if (entries.includes("SKILL.md"))
          throw new Error(`Refusing symlink in skill package: ${child}`);
        continue;
      }
      // Files such as a root-level SKILL.md are not directories to recurse into.
      if (childStat.isDirectory()) await visit(child, depth + 1);
    }
  }
  await visit(root, 0);
  return result;
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
): Promise<InstallPlan> {
  const skills = await discoverSkillDirectories(sourceRoot);
  if (skills.length === 0)
    throw new Error(`No SKILL.md found under ${sourceRoot}`);
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
      files.push({ source: skill, target, skillName });
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
}
