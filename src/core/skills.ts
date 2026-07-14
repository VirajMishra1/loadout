import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { InstallPlan, PlannedFile } from "../shared/types.js";
import { ensureDirectory } from "./paths.js";

async function findSkillDirectories(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 4) return;
    let entries: string[];
    try { entries = await readdir(directory); } catch { return; }
    if (entries.includes("SKILL.md")) result.push(directory);
    for (const entry of entries) {
      if (entry === ".git" || entry === "node_modules") continue;
      const child = join(directory, entry);
      if (child !== directory) await visit(child, depth + 1);
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
  const content = await readFile(join(path, "SKILL.md"), "utf8");
  if (!/^---\s*\n/.test(content) || !/^name:\s*\S+/m.test(content) || !/^description:\s*\S+/m.test(content)) {
    throw new Error(`SKILL.md is missing required name/description frontmatter: ${relative(process.cwd(), path)}`);
  }
}
