import { lstat, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  DetectedAgent,
  InstallPlan,
  PlannedFile,
  ResourceSummary,
} from "../shared/types.js";
import { buildSkillPlan } from "./install.js";
import { adapterCapabilities, agentComponentDirectory } from "./adapters.js";

const RESOURCE_DIRECTORIES = new Map<string, ResourceSummary["type"]>([
  ["rules", "rule"],
  ["commands", "command"],
  ["agents", "agent"],
]);

const RESOURCE_FILE = /\.(?:md|json|ya?ml)$/i;

/** Discover conventional resource directories without following symlinks. */
export async function discoverResources(
  root: string,
): Promise<ResourceSummary[]> {
  const base = resolve(root);
  const resources: ResourceSummary[] = [];
  async function visit(
    directory: string,
    depth: number,
    insideSkill: boolean,
  ): Promise<void> {
    if (depth > 5) return;
    const entries = await readdir(directory, { withFileTypes: true });
    const skill =
      insideSkill ||
      entries.some((entry) => entry.name === "SKILL.md" && entry.isFile());
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        if (RESOURCE_DIRECTORIES.has(entry.name))
          throw new Error(`Refusing symlinked resource directory: ${absolute}`);
        continue;
      }
      if (!entry.isDirectory()) continue;
      const type = !skill ? RESOURCE_DIRECTORIES.get(entry.name) : undefined;
      if (type) {
        for (const child of await readdir(absolute, { withFileTypes: true })) {
          if (child.isSymbolicLink())
            throw new Error(
              `Refusing symlinked package resource: ${join(absolute, child.name)}`,
            );
          // Conventional agent resources are files. Treating arbitrary child
          // directories as agents creates dangerous false positives such as
          // `skills/agents/references`, which is supporting material for a
          // runtime tool rather than an installable agent declaration.
          if (!child.isFile() || !RESOURCE_FILE.test(child.name)) continue;
          resources.push({
            type,
            name: child.name.replace(/\.(md|json|ya?ml)$/i, ""),
            path: relative(base, join(absolute, child.name))
              .split(sep)
              .join("/"),
          });
        }
        continue;
      }
      await visit(absolute, depth + 1, skill);
    }
  }
  await visit(base, 0, false);
  return resources.sort(
    (a, b) => a.type.localeCompare(b.type) || a.path.localeCompare(b.path),
  );
}

function safeSource(root: string, path: string): string {
  const base = resolve(root);
  const source = resolve(base, path);
  if (source !== base && !source.startsWith(`${base}${sep}`))
    throw new Error(`Resource escapes package root: ${path}`);
  return source;
}

export async function buildUniversalPackagePlan(
  root: string,
  packageId: string,
  agents: DetectedAgent[],
): Promise<InstallPlan> {
  const files: PlannedFile[] = [];
  const warnings: string[] = [];
  try {
    const skills = await buildSkillPlan(root, packageId, agents);
    files.push(
      ...skills.files.map((file) => ({
        ...file,
        componentType: "skill" as const,
        compatibility: "native" as const,
      })),
    );
    warnings.push(...skills.warnings);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.startsWith("No SKILL.md found")
    )
      throw error;
  }
  const resources = await discoverResources(root);
  for (const resource of resources) {
    for (const agent of agents) {
      const directory = agentComponentDirectory(agent, resource.type);
      const compatibility = adapterCapabilities(agent.id).components[
        resource.type
      ];
      if (!directory) {
        warnings.push(
          `${agent.displayName}: ${resource.type} '${resource.name}' is unsupported and will not be installed.`,
        );
        continue;
      }
      files.push({
        source: safeSource(root, resource.path),
        target: join(directory, packageId, resource.path.split("/").at(-1)!),
        targetAgent: agent.id,
        componentType: resource.type,
        compatibility,
      });
      if (compatibility === "adapted")
        warnings.push(
          `${agent.displayName}: ${resource.type} '${resource.name}' will be installed using an adapted layout.`,
        );
    }
  }
  if (!files.length)
    throw new Error(
      `No supported skills, rules, commands, or agents found under ${root}`,
    );
  return {
    packageId,
    files,
    targetAgents: agents.map((agent) => agent.id),
    warnings: [...new Set(warnings)],
  };
}

export async function addRootFileExports(
  plan: InstallPlan,
  packageRoot: string,
  targetRoot: string,
  exports: Array<{ source: string; target: string }>,
): Promise<void> {
  const sourceRoot = resolve(packageRoot);
  const destinationRoot = resolve(targetRoot);
  for (const item of exports) {
    if (
      !item.source ||
      !item.target ||
      isAbsolute(item.source) ||
      isAbsolute(item.target)
    )
      throw new Error(
        `Root-file exports must use non-empty relative paths: ${item.source} -> ${item.target}`,
      );
    const source = resolve(sourceRoot, item.source);
    const target = resolve(destinationRoot, item.target);
    if (source !== sourceRoot && !source.startsWith(`${sourceRoot}${sep}`))
      throw new Error(`Root-file source escapes package: ${item.source}`);
    if (
      target !== destinationRoot &&
      !target.startsWith(`${destinationRoot}${sep}`)
    )
      throw new Error(`Root-file target escapes allowed scope: ${item.target}`);
    const info = await lstat(source);
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
      throw new Error(
        `Root-file source must be a real file or directory: ${item.source}`,
      );
    plan.files.push({
      source,
      target,
      componentType: "root",
      compatibility: "native",
    });
  }
}
