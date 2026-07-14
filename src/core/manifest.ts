import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AgentId, LoadoutLockfile, LoadoutManifest, ManifestPackage, PackageSource } from "../shared/types.js";
import { readInstallState } from "./state.js";

const AGENTS = new Set<AgentId>(["claude-code", "codex", "cursor", "gemini-cli", "opencode", "hermes"]);

function source(value: unknown, label: string): PackageSource {
  if (!value || typeof value !== "object") throw new Error(`${label}.source must be an object`);
  const item = value as Record<string, unknown>;
  if (item.type === "catalog" && typeof item.id === "string" && item.id) return { type: "catalog", id: item.id };
  if (item.type === "github" && typeof item.repository === "string" && item.repository) {
    return { type: "github", repository: item.repository, ...(typeof item.ref === "string" ? { ref: item.ref } : {}), ...(typeof item.path === "string" ? { path: item.path } : {}) };
  }
  if (item.type === "local" && typeof item.path === "string" && item.path) return { type: "local", path: item.path };
  throw new Error(`${label}.source is not a supported catalog, github, or local source`);
}

function agents(value: unknown, label: string): AgentId[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const result = value.map((agent) => {
    if (typeof agent !== "string" || !AGENTS.has(agent as AgentId)) throw new Error(`${label} contains unsupported agent '${String(agent)}'`);
    return agent as AgentId;
  });
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates`);
  return result;
}

export function parseManifest(value: unknown): LoadoutManifest {
  if (!value || typeof value !== "object") throw new Error("Manifest must be an object");
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1) throw new Error("Manifest schemaVersion must be 1");
  if (typeof item.name !== "string" || !item.name.trim()) throw new Error("Manifest name is required");
  if (item.scope !== "project" && item.scope !== "global") throw new Error("Manifest scope must be project or global");
  if (!Array.isArray(item.packages)) throw new Error("Manifest packages must be an array");
  const parsedPackages: ManifestPackage[] = item.packages.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`packages[${index}] must be an object`);
    const pkg = entry as Record<string, unknown>;
    if (typeof pkg.id !== "string" || !pkg.id.trim()) throw new Error(`packages[${index}].id is required`);
    return { id: pkg.id, source: source(pkg.source, `packages[${index}]`), ...(pkg.agents === undefined ? {} : { agents: agents(pkg.agents, `packages[${index}].agents`) }), ...(typeof pkg.enabled === "boolean" ? { enabled: pkg.enabled } : {}) };
  });
  const ids = parsedPackages.map((pkg) => pkg.id);
  if (new Set(ids).size !== ids.length) throw new Error("Manifest package ids must be unique");
  return {
    schemaVersion: 1,
    name: item.name.trim(),
    scope: item.scope,
    agents: agents(item.agents, "agents"),
    ...(typeof item.profile === "string" ? { profile: item.profile } : {}),
    packages: parsedPackages,
    ...(item.policy && typeof item.policy === "object" ? { policy: item.policy as LoadoutManifest["policy"] } : {}),
  };
}

export async function readManifest(path = "loadout.json"): Promise<LoadoutManifest> {
  try { return parseManifest(JSON.parse(await readFile(resolve(path), "utf8"))); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") throw new Error(`Loadout manifest not found: ${resolve(path)}`);
    throw new Error(`Invalid Loadout manifest at ${resolve(path)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function initManifest(path = "loadout.json", options: { name?: string; agents?: AgentId[]; scope?: "project" | "global" } = {}): Promise<LoadoutManifest> {
  const manifest: LoadoutManifest = { schemaVersion: 1, name: options.name ?? "my-loadout", scope: options.scope ?? "project", agents: options.agents ?? ["codex", "claude-code"], profile: "stable", packages: [] };
  await writeFile(resolve(path), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return manifest;
}

async function writeManifest(manifest: LoadoutManifest, path: string): Promise<void> {
  await writeFile(resolve(path), `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function addManifestPackage(path: string, pkg: ManifestPackage): Promise<LoadoutManifest> {
  const manifest = await readManifest(path);
  if (manifest.packages.some((item) => item.id === pkg.id)) throw new Error(`Manifest already contains package '${pkg.id}'`);
  const updated = parseManifest({ ...manifest, packages: [...manifest.packages, pkg] });
  await writeManifest(updated, path);
  return updated;
}

export async function removeManifestPackage(path: string, packageId: string): Promise<LoadoutManifest> {
  const manifest = await readManifest(path);
  const packages = manifest.packages.filter((item) => item.id !== packageId);
  if (packages.length === manifest.packages.length) throw new Error(`Manifest does not contain package '${packageId}'`);
  const updated = parseManifest({ ...manifest, packages });
  await writeManifest(updated, path);
  return updated;
}

export async function applyProfileToManifest(path: string, profile: string, packages: Array<{ id: string; repository: string }>): Promise<LoadoutManifest> {
  const manifest = await readManifest(path);
  const existing = new Set(manifest.packages.map((pkg) => pkg.id));
  const additions: ManifestPackage[] = packages.filter((pkg) => !existing.has(pkg.id)).map((pkg) => ({ id: pkg.id, source: { type: "github", repository: pkg.repository } }));
  const updated = parseManifest({ ...manifest, profile, packages: [...manifest.packages, ...additions] });
  await writeManifest(updated, path);
  return updated;
}

export async function writeLockfile(manifest: LoadoutManifest, path = "loadout.lock"): Promise<LoadoutLockfile> {
  const state = await readInstallState();
  const sourceById = new Map(manifest.packages.map((pkg) => [pkg.id, pkg.source]));
  const lockfile: LoadoutLockfile = {
    schemaVersion: 1,
    manifestName: manifest.name,
    generatedAt: new Date().toISOString(),
    packages: state.installs.filter((entry) => sourceById.has(entry.packageId)).map((entry) => ({
      id: entry.packageId,
      source: sourceById.get(entry.packageId)!,
      repository: entry.repository,
      resolvedCommit: entry.resolvedCommit,
      targetAgents: entry.targetAgents,
      files: entry.files,
      installedAt: entry.installedAt,
    })),
  };
  await writeFile(resolve(path), `${JSON.stringify(lockfile, null, 2)}\n`);
  return lockfile;
}
