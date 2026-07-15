import { access, constants } from "node:fs/promises";
import { dirname } from "node:path";
import {
  detectAgents,
  directoryExists,
  loadoutHome,
  userHome,
} from "./paths.js";
import type { DetectedAgent } from "../shared/types.js";
import type { AgentInventory } from "../shared/types.js";
import { inspectAgents } from "./agent-inspection.js";

export interface DoctorAgent {
  agent: DetectedAgent;
  inventory: AgentInventory;
  skillsRootExists: boolean;
  writable: boolean;
  issues: string[];
}

export interface DoctorReport {
  platform: NodeJS.Platform;
  userHome: string;
  loadoutHome: string;
  loadoutHomeExists: boolean;
  loadoutHomeWritable: boolean;
  agents: DoctorAgent[];
  issues: string[];
}

async function writable(path: string): Promise<boolean> {
  // A not-yet-created directory is healthy when any existing ancestor is
  // writable; this handles first-run paths such as ~/.agents/skills.
  let candidate = path;
  while (true) {
    try {
      await access(candidate, constants.W_OK);
      return true;
    } catch {
      const parent = dirname(candidate);
      if (parent === candidate) return false;
      candidate = parent;
    }
  }
}

export async function runDoctor(): Promise<DoctorReport> {
  const home = userHome();
  const stateHome = loadoutHome();
  const loadoutHomeExists = await directoryExists(stateHome);
  const loadoutHomeWritable = await writable(stateHome);
  const agents = await detectAgents();
  const inventories = await inspectAgents(agents);
  const diagnosedAgents = await Promise.all(
    agents.map(async (agent, index) => {
      const exists = await directoryExists(agent.skillsDirectory);
      const canWrite = await writable(agent.skillsDirectory);
      const issues: string[] = [];
      if (!agent.installed)
        issues.push(`Install or configure ${agent.displayName} to enable it.`);
      if (!exists)
        issues.push(
          "Skills directory does not exist yet; Loadout will create it during install.",
        );
      if (!canWrite)
        issues.push(
          "Skills directory is not writable; check permissions or choose another home.",
        );
      return {
        agent,
        inventory: inventories[index],
        skillsRootExists: exists,
        writable: canWrite,
        issues,
      };
    }),
  );
  const issues: string[] = [];
  if (!loadoutHomeExists)
    issues.push(
      "Loadout state directory does not exist yet; it will be created on first install.",
    );
  if (!loadoutHomeWritable)
    issues.push(
      "Loadout state directory is not writable; check LOADOUT_HOME permissions.",
    );
  if (!diagnosedAgents.some(({ agent }) => agent.installed)) {
    issues.push("No supported agent executable was detected on PATH.");
  }
  return {
    platform: process.platform,
    userHome: home,
    loadoutHome: stateHome,
    loadoutHomeExists,
    loadoutHomeWritable,
    agents: diagnosedAgents,
    issues,
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    "Loadout doctor",
    `Platform: ${report.platform}`,
    `User home: ${report.userHome}`,
    `State directory: ${report.loadoutHome}`,
  ];
  lines.push(
    `State directory: ${report.loadoutHomeExists ? "present" : "not created"} (${report.loadoutHomeWritable ? "writable" : "not writable"})`,
    "",
    "Agents:",
  );
  for (const entry of report.agents) {
    const status = entry.agent.installed ? "detected" : "not found";
    lines.push(
      `  ${entry.agent.installed ? "✓" : "○"} ${entry.agent.displayName}: ${status}`,
      `    skills: ${entry.agent.skillsDirectory} (${entry.skillsRootExists ? "present" : "will be created"}, ${entry.writable ? "writable" : "not writable"})`,
    );
    for (const component of entry.inventory.components) {
      const detail = component.scanned
        ? `${component.directoryExists ? `${component.entries.length} filesystem item(s)` : "not created"}${component.directory ? ` at ${component.directory}` : ""}`
        : (component.note ?? "not inspected");
      lines.push(
        `    ${component.type}: ${component.compatibility}; ${detail}`,
      );
    }
    for (const warning of entry.inventory.warnings)
      lines.push(`    ! ${warning}`);
    for (const issue of entry.issues) lines.push(`    ! ${issue}`);
  }
  if (report.issues.length) {
    lines.push("", "Recommendations:");
    for (const issue of report.issues) lines.push(`  ! ${issue}`);
  } else lines.push("", "No global blocking issues found.");
  return lines.join("\n");
}
