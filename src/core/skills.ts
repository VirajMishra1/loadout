import { cp, lstat, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { InstallPlan, PlannedFile } from "../shared/types.js";
import { ensureDirectory } from "./paths.js";

async function findSkillDirectories(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 4) return;
    let entries: string[];
    try {
      const directoryStat = await lstat(directory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
        if (directoryStat.isSymbolicLink()) throw new Error(`Refusing symlink or non-directory package path: ${directory}`);
        return;
      }
      entries = await readdir(directory);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Refusing symlink")) throw error;
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
      if (childStat.isSymbolicLink()) throw new Error(`Refusing symlink in package source: ${child}`);
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
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Refusing path outside target directory: ${target}`);
  }
  return resolvedTarget;
}

export async function planSkillInstall(sourceRoot: string, targetDirectories: string[], packageId: string): Promise<InstallPlan> {
  const skills = await findSkillDirectories(sourceRoot);
  if (skills.length === 0) throw new Error(`No SKILL.md found under ${sourceRoot}`);
  const files: PlannedFile[] = [];
  for (const targetRoot of targetDirectories) {
    try {
      const targetStat = await lstat(targetRoot);
      if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
        throw new Error(`Refusing unsafe target directory: ${targetRoot}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Refusing unsafe target")) throw error;
      // A not-yet-created agent directory is safe; applySkillPlan creates it.
    }
    for (const skill of skills) {
      const name = skill === sourceRoot ? packageId : skill.split(sep).at(-1) ?? packageId;
      const target = safeTarget(targetRoot, join(targetRoot, name));
      files.push({ source: skill, target });
    }
  }
  return { packageId, files, targetAgents: [], warnings: [] };
}

export async function applySkillPlan(plan: InstallPlan): Promise<void> {
  for (const file of plan.files) {
    await ensureDirectory(file.target);
    await cp(file.source, file.target, { recursive: true, errorOnExist: false, force: true });
  }
}

export async function removeSkillDirectories(plan: InstallPlan): Promise<void> {
  for (const file of plan.files) await rm(file.target, { recursive: true, force: true });
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
  if (!/^---\s*\n/.test(content) || !/^name:\s*\S+/m.test(content) || !/^description:\s*\S+/m.test(content)) {
    throw new Error(`SKILL.md is missing required name/description frontmatter: ${relative(process.cwd(), path)}`);
  }
}
