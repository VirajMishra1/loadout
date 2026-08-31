import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  HealthFinding,
  HealthReport,
  InstallRecord,
  ManagedActivationRecord,
} from "../../shared/types.js";
import { managedFileReadPath } from "../workspace/active-set.js";
import { detectAgents } from "../agents/paths.js";
import { readInstallState } from "../workspace/state.js";
import { buildUpdatePlan, type UpdatePlan } from "../install/update.js";
import { codexMcpServerFingerprint } from "../agents/codex-mcp.js";
import {
  listInstalledRuntimeToolSkillTargets,
  listInstalledRuntimeTools,
} from "../agents/runtime-tools.js";

async function drift(
  record: InstallRecord,
  activations: ManagedActivationRecord[],
): Promise<string[]> {
  const changed: string[] = [];
  for (const file of record.files) {
    try {
      const digest = createHash("sha256")
        .update(
          await readFile(
            managedFileReadPath(record.packageId, file.path, activations),
          ),
        )
        .digest("hex");
      if (digest !== file.sha256) changed.push(file.path);
    } catch {
      changed.push(file.path);
    }
  }
  return changed;
}

async function mcpDrift(
  configPath: string,
  serverName: string,
  expected: string,
  configFormat: "json" | "codex-toml" = "json",
): Promise<boolean> {
  try {
    if (configFormat === "codex-toml")
      return (
        codexMcpServerFingerprint(
          await readFile(configPath, "utf8"),
          serverName,
        ) !== expected
      );
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };
    return (
      createHash("sha256")
        .update(JSON.stringify(config.mcpServers?.[serverName] ?? null))
        .digest("hex") !== expected
    );
  } catch {
    return true;
  }
}

export async function buildHealthReport(
  options: {
    updates?: () => Promise<UpdatePlan[]>;
    checkUpdates?: boolean;
    agents?: () => ReturnType<typeof detectAgents>;
  } = {},
): Promise<HealthReport> {
  const [agents, state, updates, runtimeTools, runtimeTargets] =
    await Promise.all([
      options.agents ? options.agents() : detectAgents(),
      readInstallState(),
      options.updates
        ? options.updates()
        : options.checkUpdates
          ? buildUpdatePlan()
          : Promise.resolve([]),
      listInstalledRuntimeTools(),
      listInstalledRuntimeToolSkillTargets(),
    ]);
  const drifted = (
    await Promise.all(
      state.installs.map((record) => drift(record, state.activations ?? [])),
    )
  ).flat();
  const driftedMcpServers = (
    await Promise.all(
      (state.mcpInstalls ?? []).map((entry) =>
        mcpDrift(
          entry.configPath,
          entry.serverName,
          entry.fingerprint,
          entry.configFormat,
        ),
      ),
    )
  ).filter(Boolean).length;
  const findings: HealthFinding[] = [];
  const runtimeTargetPresence = await Promise.all(
    runtimeTargets.map(async (target) => {
      try {
        await readFile(join(target.path, "SKILL.md"));
        return true;
      } catch {
        return false;
      }
    }),
  );
  const missingRuntimeTargets = runtimeTargetPresence.filter(
    (present) => !present,
  ).length;
  if (!agents.some((agent) => agent.installed))
    findings.push({
      level: "error",
      code: "no-agents",
      message: "No supported AI coding agent was detected.",
      fix: "Install an agent or make its command available on PATH.",
    });
  for (const agent of agents.filter((item) => item.installed))
    findings.push({
      level: "ok",
      code: `agent-${agent.id}`,
      message: `${agent.displayName} is detected.`,
    });
  if (state.installs.length === 0)
    findings.push({
      level: "info",
      code: "no-packages",
      message: "No Loadout-managed packages are installed yet.",
      fix: "Choose a profile or install a package.",
    });
  if (drifted.length)
    findings.push({
      level: "warning",
      code: "managed-file-drift",
      message: `${drifted.length} managed file(s) changed or disappeared outside Loadout.`,
      fix: "Review the files, then reinstall or remove the owning package.",
    });
  if (driftedMcpServers)
    findings.push({
      level: "warning",
      code: "managed-mcp-drift",
      message: `${driftedMcpServers} managed MCP server entry or entries changed or disappeared outside Loadout.`,
      fix: "Review the MCP config, then synchronize or remove the owning package.",
    });
  if (missingRuntimeTargets)
    findings.push({
      level: "warning",
      code: "managed-runtime-target-drift",
      message: `${missingRuntimeTargets} managed runtime-tool skill target(s) changed or disappeared.`,
      fix: "Review the target, then remove and reinstall the owning runtime tool.",
    });
  const available = updates.filter(
    (update) => update.status === "update-available",
  );
  const disabledAvailable = available.filter((update) =>
    Boolean(update.disabledAgents?.length),
  );
  const activeAvailable = available.filter(
    (update) => !update.disabledAgents?.length,
  );
  if (activeAvailable.length)
    findings.push({
      level: activeAvailable.some((update) => update.approvalRequired)
        ? "warning"
        : "info",
      code: "updates-available",
      message: `${activeAvailable.length} active package update(s) are available.`,
      fix: "Run loadout update and review the safety findings.",
    });
  if (disabledAvailable.length)
    findings.push({
      level: "info",
      code: "disabled-library-updates-available",
      message: `${disabledAvailable.length} disabled-library package(s) have newer upstream commits.`,
      fix: "Nothing active changed; disabled skills stay pinned and are never reactivated automatically.",
    });
  const errors = updates.filter((update) => update.status === "error");
  if (errors.length)
    findings.push({
      level: "warning",
      code: "update-check-failed",
      message: `${errors.length} update check(s) could not be completed.`,
      fix: "Check connectivity and retry.",
    });
  const configured =
    state.installs.length > 0 ||
    (state.mcpInstalls ?? []).length > 0 ||
    runtimeTools.length > 0;
  const activeSkills =
    (state.activations ?? []).filter(
      (entry) =>
        entry.installationState === "installed" &&
        entry.activationState === "active",
    ).length + runtimeTargetPresence.filter(Boolean).length;
  const disabledSkills = (state.activations ?? []).filter(
    (entry) =>
      entry.installationState === "installed" &&
      entry.activationState === "disabled",
  ).length;
  const status = findings.some((finding) => finding.level === "error")
    ? "unhealthy"
    : !configured
      ? "not-configured"
      : findings.some((finding) => finding.level === "warning")
        ? "attention"
        : activeSkills === 0 &&
            disabledSkills > 0 &&
            (state.mcpInstalls ?? []).length === 0 &&
            runtimeTools.length === 0
          ? "library-only"
          : "healthy";
  return {
    status,
    generatedAt: new Date().toISOString(),
    agents,
    installedPackages: state.installs.length,
    activeSkills,
    disabledSkills,
    managedMcpServers: (state.mcpInstalls ?? []).length,
    managedRuntimeTools: runtimeTools.length,
    updatesChecked: Boolean(options.updates || options.checkUpdates),
    updatesAvailable: available.length,
    activeUpdatesAvailable: activeAvailable.length,
    disabledUpdatesAvailable: disabledAvailable.length,
    updateChecksFailed: errors.length,
    driftedFiles: drifted.length,
    driftedMcpServers,
    findings,
  };
}

export interface HealthGrade {
  letter: "A" | "B" | "C" | "D" | "F" | "—";
  headline: string;
  reasons: string[];
  fixes: string[];
}

/**
 * A one-glance grade derived from the same report the health command already
 * builds. Drift (managed files changed outside Loadout) is an integrity
 * violation and dominates; error findings are next; warnings cap at B. This is
 * a legible summary, not a scored policy — the detailed dimensions live behind
 * `loadout health --explain`.
 */
export function gradeHealth(report: HealthReport): HealthGrade {
  const reasons: string[] = [];
  const fixes: string[] = [];
  const drift = report.driftedFiles + report.driftedMcpServers;
  const errors = report.findings.filter((f) => f.level === "error");
  const warnings = report.findings.filter((f) => f.level === "warning");

  if (report.status === "not-configured")
    return {
      letter: "—",
      headline: "Not set up yet",
      reasons: [
        "No Loadout-managed packages, MCP servers, or tools installed.",
      ],
      fixes: [
        "Run `loadout setup --mode stable` (preview first, nothing changes).",
      ],
    };

  let letter: HealthGrade["letter"] = "A";
  if (drift > 0) {
    letter = "F";
    reasons.push(
      `${drift} managed item(s) changed or disappeared outside Loadout.`,
    );
    fixes.push(
      "Run `loadout rollback` to restore the last snapshot, or `loadout reconcile` to re-adopt.",
    );
  }
  for (const error of errors) {
    if (letter !== "F") letter = "D";
    reasons.push(error.message);
    if (error.fix) fixes.push(error.fix);
  }
  if (letter !== "F" && letter !== "D") {
    if (report.status === "library-only") {
      letter = "C";
      reasons.push("Skills are installed but none are active for any agent.");
      fixes.push(
        "Run `loadout optimize --project .` to activate a relevant set.",
      );
    } else if (warnings.length) {
      letter = "B";
      for (const warning of warnings) {
        reasons.push(warning.message);
        if (warning.fix) fixes.push(warning.fix);
      }
    }
  }

  const headline =
    letter === "A"
      ? "Healthy and up to date"
      : letter === "B"
        ? "Healthy, with items to review"
        : letter === "C"
          ? "Ready, but nothing active"
          : letter === "D"
            ? "Needs attention"
            : "Integrity problem — managed files drifted";
  return { letter, headline, reasons, fixes: [...new Set(fixes)] };
}

/** The `loadout status` home screen: a grade, per-agent lines, then fixes. */
export function formatStatusScreen(
  report: HealthReport,
  agentLines: string[],
): string {
  const grade = gradeHealth(report);
  const lines = [
    `Loadout — grade ${grade.letter}: ${grade.headline}`,
    "",
    ...agentLines,
  ];
  if (grade.reasons.length) {
    lines.push("");
    for (const reason of grade.reasons) lines.push(`  • ${reason}`);
  }
  if (grade.fixes.length) {
    lines.push("");
    for (const fix of grade.fixes) lines.push(`  → ${fix}`);
  }
  return lines.join("\n");
}

export function formatHealthReport(report: HealthReport): string {
  const icon =
    report.status === "not-configured" || report.status === "library-only"
      ? "•"
      : report.status === "healthy"
        ? "✓"
        : report.status === "attention"
          ? "!"
          : "✗";
  const lines = [
    `${icon} Loadout health: ${report.status === "not-configured" ? "not configured" : report.status === "library-only" ? "library ready (nothing active)" : report.status}`,
    `Packages: ${report.installedPackages} managed; skills: ${report.activeSkills ?? 0} active, ${report.disabledSkills ?? 0} disabled; MCP servers: ${report.managedMcpServers ?? 0}; runtime tools: ${report.managedRuntimeTools ?? 0}; ${report.updatesChecked ? `${report.activeUpdatesAvailable ?? report.updatesAvailable} active update(s), ${report.disabledUpdatesAvailable ?? 0} disabled-library update(s), ${report.updateChecksFailed ?? 0} check(s) unavailable` : "updates not checked (use --updates)"}; ${report.driftedFiles} drifted file(s), ${report.driftedMcpServers} drifted MCP server(s)`,
  ];
  for (const finding of report.findings)
    lines.push(
      `${finding.level === "ok" ? "✓" : finding.level === "error" ? "✗" : finding.level === "warning" ? "!" : "•"} ${finding.message}${finding.fix ? ` ${finding.fix}` : ""}`,
    );
  return lines.join("\n");
}
