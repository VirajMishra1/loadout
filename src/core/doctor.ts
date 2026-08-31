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

export function formatDoctorReport(
  report: DoctorReport,
  options: { verbose?: boolean } = {},
): string {
  const installed = report.agents.filter((a) => a.agent.installed);
  const notInstalled = report.agents.filter((a) => !a.agent.installed);
  const allIssues = [
    ...report.issues,
    ...installed.flatMap((a) => a.issues),
  ];
  const grade =
    allIssues.length === 0 && installed.length > 0
      ? "HEALTHY"
      : allIssues.length <= 2
        ? "OK"
        : "NEEDS ATTENTION";

  const lines: string[] = [
    `loadout doctor — ${grade}`,
    "",
    `Platform:   ${report.platform}`,
    `State:      ${report.loadoutHome} ${report.loadoutHomeExists ? "✓" : "⚠ not created"} ${report.loadoutHomeWritable ? "writable" : "⚠ not writable"}`,
    `Agents:     ${installed.length} detected, ${notInstalled.length} available`,
    "",
  ];

  // --- Detected agents: compact summary ---
  if (installed.length) {
    lines.push("DETECTED AGENTS");
    for (const entry of installed) {
      const skillCount = entry.inventory.components
        .filter((c) => c.scanned && c.directoryExists)
        .reduce((sum, c) => sum + c.entries.length, 0);
      const supported = entry.inventory.components
        .filter((c) => c.compatibility === "native" || c.compatibility === "adapted")
        .map((c) => c.type);
      lines.push(
        `  ✓ ${entry.agent.displayName}`,
        `    ${entry.agent.skillsDirectory}`,
        `    ${skillCount} items | supports: ${supported.join(", ")}`,
      );
      if (entry.issues.length) {
        for (const issue of entry.issues) lines.push(`    ⚠ ${issue}`);
      }
      if (options.verbose) {
        for (const component of entry.inventory.components) {
          if (component.compatibility === "unsupported") continue;
          const detail = component.scanned
            ? component.directoryExists
              ? `${component.entries.length} items`
              : "not created"
            : (component.note ?? "—");
          lines.push(`    ${component.type}: ${detail}`);
        }
      }
    }
    lines.push("");
  }

  // --- Not installed: one-liner ---
  if (notInstalled.length) {
    lines.push(
      `NOT DETECTED: ${notInstalled.map((a) => a.agent.displayName).join(", ")}`,
      "",
    );
  }

  // --- Issues ---
  if (allIssues.length) {
    lines.push("ISSUES");
    for (const issue of allIssues) lines.push(`  ⚠ ${issue}`);
    lines.push("");
  }

  // --- Next steps ---
  lines.push("NEXT STEPS");
  if (allIssues.length) {
    lines.push("  Fix the issues above, then run `loadout doctor` again.");
  } else if (installed.length === 0) {
    lines.push(
      "  Install an AI coding agent (Claude Code, Codex, Cursor, etc.),",
      "  then run `loadout doctor` again.",
    );
  } else {
    lines.push(
      "  loadout status        see what's managed",
      "  loadout setup         install a curated skill set",
      "  loadout route         find the right model for your task",
      "  loadout health        check for updates",
    );
  }

  return lines.join("\n");
}

/**
 * Legacy-compatible verbose format. Used when --verbose is passed.
 */
export function formatDoctorReportVerbose(report: DoctorReport): string {
  return formatDoctorReport(report, { verbose: true });
}
