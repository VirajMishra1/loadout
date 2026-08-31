import { cp, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectAgents } from "../agents/paths.js";
import type { AgentId, DetectedAgent } from "../../shared/types.js";

/**
 * Skills Loadout ships itself, as opposed to the third-party packages in the
 * catalog. These make Loadout usable from inside an agent conversation rather
 * than only from a terminal.
 */
export interface FirstPartySkill {
  id: string;
  displayName: string;
  summary: string;
}

export const FIRST_PARTY_SKILLS: FirstPartySkill[] = [
  {
    id: "loadout-router",
    displayName: "Loadout Router",
    summary:
      "Lets an agent pick the right model tier for a task and hand work to another agent",
  },
  {
    id: "loadout-curator",
    displayName: "Loadout Curator",
    summary:
      "Lets an agent decide which skills and MCP servers should be active for the current repository",
  },
];

/**
 * Locate the bundled `skills/` directory. Resolution walks upward so it works
 * both from `src/` under tsx and from `dist/src/` in the published package.
 */
export async function bundledSkillsRoot(): Promise<string> {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = join(dir, "skills");
    try {
      if ((await stat(candidate)).isDirectory()) return candidate;
    } catch {
      // Keep walking toward the package root.
    }
    dir = dirname(dir);
  }
  throw new Error(
    "Bundled skills directory not found; this build may be incomplete.",
  );
}

export function findFirstPartySkill(id: string): FirstPartySkill {
  const skill = FIRST_PARTY_SKILLS.find((item) => item.id === id);
  if (!skill)
    throw new Error(
      `Unknown Loadout skill '${id}'. Available: ${FIRST_PARTY_SKILLS.map((s) => s.id).join(", ")}`,
    );
  return skill;
}

export interface SkillInstallTarget {
  agent: AgentId;
  displayName: string;
  /** Destination directory for this skill under the agent's skills root. */
  destination: string;
  /** True when a directory already exists there and would be replaced. */
  replacing: boolean;
}

export interface FirstPartySkillPlan {
  skill: FirstPartySkill;
  source: string;
  targets: SkillInstallTarget[];
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Build a preview of where one first-party skill would be installed. Nothing is
 * written; the caller decides whether to apply.
 */
export async function planFirstPartySkill(
  id: string,
  options: { agents?: AgentId[]; detected?: DetectedAgent[] } = {},
): Promise<FirstPartySkillPlan> {
  const skill = findFirstPartySkill(id);
  const source = join(await bundledSkillsRoot(), skill.id);
  if (!(await directoryExists(source)))
    throw new Error(`Bundled skill '${skill.id}' is missing from this build.`);

  const detected = options.detected ?? (await detectAgents());
  const installed = detected.filter((agent) => agent.installed);
  const requested = options.agents?.length
    ? installed.filter((agent) => options.agents!.includes(agent.id))
    : installed;

  const targets: SkillInstallTarget[] = [];
  for (const agent of requested) {
    const destination = join(agent.skillsDirectory, skill.id);
    targets.push({
      agent: agent.id,
      displayName: agent.displayName,
      destination,
      replacing: await directoryExists(destination),
    });
  }

  return { skill, source, targets };
}

export async function applyFirstPartySkill(
  plan: FirstPartySkillPlan,
): Promise<void> {
  for (const target of plan.targets) {
    // Replace wholesale so a reinstall cannot leave files from an older
    // version of the skill behind.
    if (target.replacing) await rm(target.destination, { recursive: true });
    await cp(plan.source, target.destination, { recursive: true });
  }
}

export async function removeFirstPartySkill(
  plan: FirstPartySkillPlan,
): Promise<void> {
  for (const target of plan.targets)
    if (target.replacing) await rm(target.destination, { recursive: true });
}

export function formatFirstPartySkillList(
  installedIds: Set<string> = new Set(),
): string {
  const lines = ["Skills that ship with Loadout:", ""];
  for (const skill of FIRST_PARTY_SKILLS) {
    const marker = installedIds.has(skill.id) ? "✓" : "○";
    lines.push(`  ${marker} ${skill.id} — ${skill.summary}`);
  }
  lines.push(
    "",
    "Install with: loadout skills install <id> --yes",
    "These teach your agents to use Loadout from inside a conversation.",
  );
  return lines.join("\n");
}

export function formatFirstPartySkillPlan(plan: FirstPartySkillPlan): string {
  if (!plan.targets.length)
    return `No installed agents detected, so '${plan.skill.id}' has nowhere to go. Install an agent first.`;
  const lines = [`${plan.skill.displayName} (${plan.skill.id})`, ""];
  for (const target of plan.targets)
    lines.push(
      `  ${target.replacing ? "replace" : "install"} → ${target.destination}  [${target.displayName}]`,
    );
  return lines.join("\n");
}

/** Which first-party skills are already present for at least one agent. */
export async function installedFirstPartySkills(
  detected?: DetectedAgent[],
): Promise<Set<string>> {
  const agents = (detected ?? (await detectAgents())).filter(
    (agent) => agent.installed,
  );
  const found = new Set<string>();
  for (const skill of FIRST_PARTY_SKILLS)
    for (const agent of agents)
      if (await directoryExists(join(agent.skillsDirectory, skill.id))) {
        found.add(skill.id);
        break;
      }
  return found;
}
