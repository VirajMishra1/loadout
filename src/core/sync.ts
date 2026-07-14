import { resolve } from "node:path";
import type { AgentId, LoadoutManifest, ManifestPackage } from "../shared/types.js";
import { loadEffectiveCatalog } from "./catalog.js";
import { applySkillInstallBatch, buildSkillPlan, installedAgents, type InstallBatchEntry } from "./install.js";
import { readManifest, writeLockfile } from "./manifest.js";
import { detectAgents } from "./paths.js";
import { fetchRepositorySnapshot } from "./source.js";

export interface SyncPlan {
  manifest: string;
  packages: InstallBatchEntry[];
  skipped: Array<{ packageId: string; reason: string }>;
}

async function resolvePackage(pkg: ManifestPackage): Promise<{ path: string; repository?: string; commit?: string }> {
  if (pkg.source.type === "local") return { path: resolve(pkg.source.path) };
  if (pkg.source.type === "github") {
    const fetched = await fetchRepositorySnapshot(pkg.source.repository, { ref: pkg.source.ref });
    return { path: pkg.source.path ? resolve(fetched.path, pkg.source.path) : fetched.path, repository: fetched.repository, commit: fetched.commit };
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
  const detected = await detectAgents();
  const packages: InstallBatchEntry[] = [];
  const skipped: SyncPlan["skipped"] = [];
  for (const pkg of manifest.packages.filter((item) => item.enabled !== false)) {
    const requested = pkg.agents ?? manifest.agents;
    const agents = installedAgents(detected, requested as AgentId[]);
    const source = await resolvePackage(pkg);
    try {
      packages.push({ plan: await buildSkillPlan(source.path, pkg.id, agents), metadata: { repository: source.repository, resolvedCommit: source.commit } });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("No SKILL.md found")) skipped.push({ packageId: pkg.id, reason: "No installable skill component was found; inspect MCP components separately." });
      else throw error;
    }
  }
  return { manifest: manifestPath, packages, skipped };
}

export async function applySyncPlan(plan: SyncPlan, lockPath = "loadout.lock"): Promise<{ snapshotId?: string; lockfile: string }> {
  const snapshotId = plan.packages.length ? await applySkillInstallBatch(plan.packages) : undefined;
  const manifest: LoadoutManifest = await readManifest(plan.manifest);
  await writeLockfile(manifest, lockPath);
  return { snapshotId, lockfile: lockPath };
}
