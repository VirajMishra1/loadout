import { resolve, sep } from "node:path";
import type { AgentId, LoadoutManifest, ManifestPackage } from "../shared/types.js";
import { loadEffectiveCatalog } from "./catalog.js";
import { applySkillInstallBatch, installedAgents, type InstallBatchEntry } from "./install.js";
import { orderManifestPackages, readManifest, writeLockfile } from "./manifest.js";
import { detectAgents } from "./paths.js";
import { fetchGitSnapshot, fetchRepositorySnapshot } from "./source.js";
import { buildUniversalPackagePlan } from "./components.js";
import { analyzeInstallPlanSafety, type UpdateSafetyAnalysis } from "./safety.js";
import { resolveRegistryPackage } from "./registry.js";

export interface SyncPlan {
  manifest: string;
  packages: Array<InstallBatchEntry & { safety: UpdateSafetyAnalysis }>;
  skipped: Array<{ packageId: string; reason: string }>;
  policyViolations: string[];
}

function policyViolations(manifest: LoadoutManifest, packages: SyncPlan["packages"]): string[] {
  const violations: string[] = [];
  const blockedDomains = new Set((manifest.policy?.blockedDomains ?? []).map((domain) => domain.toLowerCase()));
  const blockedCommands = new Set((manifest.policy?.blockedCommands ?? []).map((command) => command.toLowerCase()));
  for (const entry of packages) {
    for (const finding of entry.safety.findings) {
      if (finding.category === "domain") for (const domain of finding.names ?? []) if (blockedDomains.has(domain.toLowerCase())) violations.push(`${entry.plan.packageId} references blocked domain '${domain}'`);
    }
    for (const file of entry.plan.files) {
      const name = file.source.split(/[\\/]/).at(-1)?.replace(/\.[^.]+$/, "").toLowerCase();
      if (name && blockedCommands.has(name)) violations.push(`${entry.plan.packageId} contains blocked command '${name}'`);
    }
  }
  return [...new Set(violations)];
}

async function resolvePackage(pkg: ManifestPackage): Promise<{ path: string; repository?: string; commit?: string }> {
  if (pkg.source.type === "local") return { path: resolve(pkg.source.path) };
  if (pkg.source.type === "github") {
    const fetched = await fetchRepositorySnapshot(pkg.source.repository, { ref: pkg.source.ref });
    const selected = pkg.source.path ? resolve(fetched.path, pkg.source.path) : fetched.path;
    if (selected !== fetched.path && !selected.startsWith(`${fetched.path}${sep}`)) throw new Error(`Package subpath escapes fetched repository: ${pkg.source.path}`);
    return { path: selected, repository: fetched.repository, commit: fetched.commit };
  }
  if (pkg.source.type === "git") {
    const fetched = await fetchGitSnapshot(pkg.source.url, { ref: pkg.source.ref });
    const selected = pkg.source.path ? resolve(fetched.path, pkg.source.path) : fetched.path;
    if (selected !== fetched.path && !selected.startsWith(`${fetched.path}${sep}`)) throw new Error(`Package subpath escapes fetched Git repository: ${pkg.source.path}`);
    return { path: selected, commit: fetched.commit };
  }
  if (pkg.source.type === "registry") {
    const resolved = await resolveRegistryPackage(pkg.source.name, pkg.source.version);
    return { path: resolved.path, commit: resolved.digest };
  }
  const catalogId = pkg.source.id;
  const catalog = await loadEffectiveCatalog();
  const found = catalog.find((item) => item.id === catalogId);
  if (!found) throw new Error(`Unknown catalog package '${catalogId}'`);
  const fetched = await fetchRepositorySnapshot(found.repository);
  return { path: fetched.path, repository: fetched.repository, commit: fetched.commit };
}

export async function buildSyncPlan(manifestPath = "loadout.json"): Promise<SyncPlan> {
  const manifest = await readManifest(manifestPath);
  const disabled = new Set(manifest.packages.filter((pkg) => pkg.enabled === false).map((pkg) => pkg.id));
  for (const pkg of manifest.packages.filter((item) => item.enabled !== false)) {
    const unavailable = (pkg.dependsOn ?? []).filter((id) => disabled.has(id));
    if (unavailable.length) throw new Error(`Enabled package '${pkg.id}' depends on disabled package(s): ${unavailable.join(", ")}`);
  }
  const detected = await detectAgents();
  const packages: SyncPlan["packages"] = [];
  const skipped: SyncPlan["skipped"] = [];
  for (const pkg of orderManifestPackages(manifest.packages).filter((item) => item.enabled !== false)) {
    const requested = pkg.agents ?? manifest.agents;
    const agents = installedAgents(detected, requested as AgentId[]);
    const source = await resolvePackage(pkg);
    try {
      const plan = await buildUniversalPackagePlan(source.path, pkg.id, agents);
      packages.push({ plan, metadata: { repository: source.repository, resolvedCommit: source.commit }, safety: await analyzeInstallPlanSafety(plan) });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("No supported")) skipped.push({ packageId: pkg.id, reason: "No supported skill, rule, command, or agent component was found; inspect MCP components separately." });
      else throw error;
    }
  }
  return { manifest: manifestPath, packages, skipped, policyViolations: policyViolations(manifest, packages) };
}

export async function applySyncPlan(plan: SyncPlan, lockPath = "loadout.lock", options: { approveRisk?: boolean } = {}): Promise<{ snapshotId?: string; lockfile: string }> {
  if (plan.policyViolations.length) throw new Error(`Synchronization violates manifest policy: ${plan.policyViolations.join("; ")}`);
  const blocked = plan.packages.filter((entry) => entry.safety.approvalRequired);
  if (blocked.length && !options.approveRisk) throw new Error(`Synchronization requires explicit risk approval for: ${blocked.map((entry) => entry.plan.packageId).join(", ")}`);
  const snapshotId = plan.packages.length ? await applySkillInstallBatch(plan.packages) : undefined;
  const manifest: LoadoutManifest = await readManifest(plan.manifest);
  await writeLockfile(manifest, lockPath);
  return { snapshotId, lockfile: lockPath };
}
