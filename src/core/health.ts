import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  HealthFinding,
  HealthReport,
  InstallRecord,
  ManagedActivationRecord,
} from "../shared/types.js";
import { managedFileReadPath } from "./active-set.js";
import { detectAgents } from "./paths.js";
import { readInstallState } from "./state.js";
import { buildUpdatePlan, type UpdatePlan } from "./update.js";
import { codexMcpServerFingerprint } from "./codex-mcp.js";

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
  } = {},
): Promise<HealthReport> {
  const [agents, state, updates] = await Promise.all([
    detectAgents(),
    readInstallState(),
    options.updates
      ? options.updates()
      : options.checkUpdates
        ? buildUpdatePlan()
        : Promise.resolve([]),
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
  const available = updates.filter(
    (update) => update.status === "update-available",
  );
  if (available.length)
    findings.push({
      level: available.some((update) => update.approvalRequired)
        ? "warning"
        : "info",
      code: "updates-available",
      message: `${available.length} package update(s) are available.`,
      fix: "Run loadout update and review the safety findings.",
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
    state.installs.length > 0 || (state.mcpInstalls ?? []).length > 0;
  const activeSkills = (state.activations ?? []).filter(
    (entry) =>
      entry.installationState === "installed" &&
      entry.activationState === "active",
  ).length;
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
        : activeSkills === 0 && disabledSkills > 0
          ? "library-only"
          : "healthy";
  return {
    status,
    generatedAt: new Date().toISOString(),
    agents,
    installedPackages: state.installs.length,
    activeSkills,
    disabledSkills,
    updatesChecked: Boolean(options.updates || options.checkUpdates),
    updatesAvailable: available.length,
    driftedFiles: drifted.length,
    driftedMcpServers,
    findings,
  };
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
    `Packages: ${report.installedPackages} managed; skills: ${report.activeSkills ?? 0} active, ${report.disabledSkills ?? 0} disabled; ${report.updatesChecked ? `${report.updatesAvailable} update(s)` : "updates not checked (use --updates)"}; ${report.driftedFiles} drifted file(s), ${report.driftedMcpServers} drifted MCP server(s)`,
  ];
  for (const finding of report.findings)
    lines.push(
      `${finding.level === "ok" ? "✓" : finding.level === "error" ? "✗" : finding.level === "warning" ? "!" : "•"} ${finding.message}${finding.fix ? ` ${finding.fix}` : ""}`,
    );
  return lines.join("\n");
}
