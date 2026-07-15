import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { LoadoutLockfile, LoadoutManifest } from "../shared/types.js";
import { readManifest } from "./manifest.js";
import { readInstallState } from "./state.js";

export interface AuditFinding {
  level: "error" | "warning" | "ok";
  code: string;
  message: string;
}

export interface AuditReport {
  valid: boolean;
  manifest: string;
  lockfile: string;
  findings: AuditFinding[];
}

export function parseLockfile(value: unknown): LoadoutLockfile {
  if (!value || typeof value !== "object")
    throw new Error("Lockfile must be an object");
  const item = value as Partial<LoadoutLockfile>;
  if (
    item.schemaVersion !== 1 ||
    typeof item.manifestName !== "string" ||
    !Array.isArray(item.packages)
  )
    throw new Error("Lockfile schema is invalid");
  return item as LoadoutLockfile;
}

export async function readLockfile(
  path = "loadout.lock",
): Promise<LoadoutLockfile> {
  try {
    return parseLockfile(JSON.parse(await readFile(resolve(path), "utf8")));
  } catch (error) {
    throw new Error(
      `Invalid Loadout lockfile at ${resolve(path)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function expectedPackages(manifest: LoadoutManifest): string[] {
  return manifest.packages
    .filter((pkg) => pkg.enabled !== false)
    .map((pkg) => pkg.id)
    .sort();
}

export async function auditLoadout(
  manifestPath = "loadout.json",
  lockPath = "loadout.lock",
): Promise<AuditReport> {
  const [manifest, lockfile, state] = await Promise.all([
    readManifest(manifestPath),
    readLockfile(lockPath),
    readInstallState(),
  ]);
  const findings: AuditFinding[] = [];
  if (lockfile.manifestName !== manifest.name)
    findings.push({
      level: "error",
      code: "manifest-name",
      message: `Lockfile belongs to '${lockfile.manifestName}', not '${manifest.name}'.`,
    });
  const expected = expectedPackages(manifest);
  const locked = lockfile.packages.map((pkg) => pkg.id).sort();
  for (const id of expected.filter((id) => !locked.includes(id)))
    findings.push({
      level: "error",
      code: "missing-lock",
      message: `Package '${id}' is enabled but missing from the lockfile.`,
    });
  for (const id of locked.filter((id) => !expected.includes(id)))
    findings.push({
      level: "error",
      code: "extra-lock",
      message: `Lockfile contains package '${id}' that is not enabled in the manifest.`,
    });
  const stateById = new Map(
    state.installs.map((entry) => [entry.packageId, entry]),
  );
  for (const lockedPackage of lockfile.packages) {
    const manifestPackage = manifest.packages.find(
      (pkg) => pkg.id === lockedPackage.id,
    );
    if (
      manifestPackage &&
      JSON.stringify(manifestPackage.source) !==
        JSON.stringify(lockedPackage.source)
    )
      findings.push({
        level: "error",
        code: "source-mismatch",
        message: `Package '${lockedPackage.id}' source differs between manifest and lockfile.`,
      });
    const installed = stateById.get(lockedPackage.id);
    if (!installed) {
      findings.push({
        level: "warning",
        code: "not-installed",
        message: `Package '${lockedPackage.id}' is locked but not installed on this machine.`,
      });
      continue;
    }
    if (
      (lockedPackage.resolvedCommit ?? "") !== (installed.resolvedCommit ?? "")
    )
      findings.push({
        level: "error",
        code: "commit-mismatch",
        message: `Package '${lockedPackage.id}' installed revision differs from the lockfile.`,
      });
    const lockedFiles = new Map(
      lockedPackage.files.map((file) => [file.path, file.sha256]),
    );
    const installedFiles = new Set(installed.files.map((file) => file.path));
    for (const path of lockedFiles.keys())
      if (!installedFiles.has(path))
        findings.push({
          level: "error",
          code: "missing-state-file",
          message: `Lockfile-managed path is missing from installed state: ${path}`,
        });
    for (const file of installed.files) {
      if (lockedFiles.get(file.path) !== file.sha256)
        findings.push({
          level: "error",
          code: "state-lock-mismatch",
          message: `Managed file record differs from lockfile: ${file.path}`,
        });
      try {
        const digest = createHash("sha256")
          .update(await readFile(file.path))
          .digest("hex");
        if (digest !== file.sha256)
          findings.push({
            level: "error",
            code: "file-drift",
            message: `Managed file changed or is corrupt: ${file.path}`,
          });
      } catch {
        findings.push({
          level: "error",
          code: "file-missing",
          message: `Managed file is missing: ${file.path}`,
        });
      }
    }
  }
  const stateMcp = state.mcpInstalls ?? [];
  for (const lockedMcp of lockfile.mcpServers ?? []) {
    const installed = stateMcp.find(
      (entry) =>
        entry.packageId === lockedMcp.packageId &&
        entry.configPath === lockedMcp.configPath &&
        entry.serverName === lockedMcp.serverName,
    );
    if (!installed) {
      findings.push({
        level: "error",
        code: "missing-mcp-state",
        message: `MCP server '${lockedMcp.serverName}' for '${lockedMcp.packageId}' is missing from installed state.`,
      });
      continue;
    }
    if (installed.fingerprint !== lockedMcp.fingerprint)
      findings.push({
        level: "error",
        code: "mcp-lock-mismatch",
        message: `MCP server '${lockedMcp.serverName}' state differs from the lockfile.`,
      });
    try {
      const config = JSON.parse(
        await readFile(lockedMcp.configPath, "utf8"),
      ) as { mcpServers?: Record<string, unknown> };
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify(config.mcpServers?.[lockedMcp.serverName] ?? null),
        )
        .digest("hex");
      if (fingerprint !== lockedMcp.fingerprint)
        findings.push({
          level: "error",
          code: "mcp-drift",
          message: `MCP server '${lockedMcp.serverName}' changed or is missing in ${lockedMcp.configPath}.`,
        });
    } catch {
      findings.push({
        level: "error",
        code: "mcp-config-missing",
        message: `MCP configuration is missing or invalid: ${lockedMcp.configPath}`,
      });
    }
  }
  if (!findings.length)
    findings.push({
      level: "ok",
      code: "reproducible",
      message:
        "Manifest, lockfile, installed state, and managed file hashes agree.",
    });
  return {
    valid: !findings.some((finding) => finding.level === "error"),
    manifest: resolve(manifestPath),
    lockfile: resolve(lockPath),
    findings,
  };
}

export function formatAuditReport(report: AuditReport): string {
  return [
    `Loadout audit: ${report.valid ? "PASS" : "FAIL"}`,
    ...report.findings.map(
      (finding) =>
        `${finding.level === "ok" ? "✓" : finding.level === "warning" ? "!" : "✗"} ${finding.message}`,
    ),
  ].join("\n");
}
