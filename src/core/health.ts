import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { HealthFinding, HealthReport, InstallRecord } from "../shared/types.js";
import { detectAgents } from "./paths.js";
import { readInstallState } from "./state.js";
import { buildUpdatePlan, type UpdatePlan } from "./update.js";

async function drift(record: InstallRecord): Promise<string[]> {
  const changed: string[] = [];
  for (const file of record.files) {
    try {
      const digest = createHash("sha256").update(await readFile(file.path)).digest("hex");
      if (digest !== file.sha256) changed.push(file.path);
    } catch { changed.push(file.path); }
  }
  return changed;
}

async function mcpDrift(configPath: string, serverName: string, expected: string): Promise<boolean> {
  try {
    const config = JSON.parse(await readFile(configPath, "utf8")) as { mcpServers?: Record<string, unknown> };
    return createHash("sha256").update(JSON.stringify(config.mcpServers?.[serverName] ?? null)).digest("hex") !== expected;
  } catch { return true; }
}

export async function buildHealthReport(options: { updates?: () => Promise<UpdatePlan[]> } = {}): Promise<HealthReport> {
  const [agents, state, updates] = await Promise.all([detectAgents(), readInstallState(), (options.updates ?? buildUpdatePlan)()]);
  const drifted = (await Promise.all(state.installs.map(drift))).flat();
  const driftedMcpServers = (await Promise.all((state.mcpInstalls ?? []).map((entry) => mcpDrift(entry.configPath, entry.serverName, entry.fingerprint)))).filter(Boolean).length;
  const findings: HealthFinding[] = [];
  if (!agents.some((agent) => agent.installed)) findings.push({ level: "error", code: "no-agents", message: "No supported AI coding agent was detected.", fix: "Install an agent or make its command available on PATH." });
  for (const agent of agents.filter((item) => item.installed)) findings.push({ level: "ok", code: `agent-${agent.id}`, message: `${agent.displayName} is detected.` });
  if (state.installs.length === 0) findings.push({ level: "info", code: "no-packages", message: "No Loadout-managed packages are installed yet.", fix: "Choose a profile or install a package." });
  if (drifted.length) findings.push({ level: "warning", code: "managed-file-drift", message: `${drifted.length} managed file(s) changed or disappeared outside Loadout.`, fix: "Review the files, then reinstall or remove the owning package." });
  if (driftedMcpServers) findings.push({ level: "warning", code: "managed-mcp-drift", message: `${driftedMcpServers} managed MCP server entry or entries changed or disappeared outside Loadout.`, fix: "Review the MCP config, then synchronize or remove the owning package." });
  const available = updates.filter((update) => update.status === "update-available");
  if (available.length) findings.push({ level: available.some((update) => update.approvalRequired) ? "warning" : "info", code: "updates-available", message: `${available.length} package update(s) are available.`, fix: "Run loadout update and review the safety findings." });
  const errors = updates.filter((update) => update.status === "error");
  if (errors.length) findings.push({ level: "warning", code: "update-check-failed", message: `${errors.length} update check(s) could not be completed.`, fix: "Check connectivity and retry." });
  const status = findings.some((finding) => finding.level === "error") ? "unhealthy" : findings.some((finding) => finding.level === "warning") ? "attention" : "healthy";
  return { status, generatedAt: new Date().toISOString(), agents, installedPackages: state.installs.length, updatesAvailable: available.length, driftedFiles: drifted.length, driftedMcpServers, findings };
}

export function formatHealthReport(report: HealthReport): string {
  const icon = report.status === "healthy" ? "✓" : report.status === "attention" ? "!" : "✗";
  const lines = [`${icon} Loadout health: ${report.status}`, `Packages: ${report.installedPackages} installed, ${report.updatesAvailable} update(s), ${report.driftedFiles} drifted file(s), ${report.driftedMcpServers} drifted MCP server(s)`];
  for (const finding of report.findings) lines.push(`${finding.level === "ok" ? "✓" : finding.level === "error" ? "✗" : finding.level === "warning" ? "!" : "•"} ${finding.message}${finding.fix ? ` ${finding.fix}` : ""}`);
  return lines.join("\n");
}
