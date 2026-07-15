import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  AgentId,
  LoadoutLockfile,
  LoadoutManifest,
  ManifestPackage,
  PackageSource,
} from "../shared/types.js";
import { readInstallState } from "./state.js";
import { writeFileAtomically } from "./atomic-file.js";

const AGENTS = new Set<AgentId>([
  "claude-code",
  "codex",
  "cursor",
  "gemini-cli",
  "opencode",
  "hermes",
]);

function source(value: unknown, label: string): PackageSource {
  if (!value || typeof value !== "object")
    throw new Error(`${label}.source must be an object`);
  const item = value as Record<string, unknown>;
  if (item.type === "catalog" && typeof item.id === "string" && item.id)
    return { type: "catalog", id: item.id };
  if (
    item.type === "github" &&
    typeof item.repository === "string" &&
    item.repository
  ) {
    return {
      type: "github",
      repository: item.repository,
      ...(typeof item.ref === "string" ? { ref: item.ref } : {}),
      ...(typeof item.path === "string" ? { path: item.path } : {}),
    };
  }
  if (item.type === "git" && typeof item.url === "string" && item.url) {
    return {
      type: "git",
      url: item.url,
      ...(typeof item.ref === "string" ? { ref: item.ref } : {}),
      ...(typeof item.path === "string" ? { path: item.path } : {}),
    };
  }
  if (
    item.type === "registry" &&
    typeof item.name === "string" &&
    item.name &&
    typeof item.version === "string" &&
    item.version
  )
    return { type: "registry", name: item.name, version: item.version };
  if (
    item.type === "remote-registry" &&
    typeof item.registry === "string" &&
    item.registry &&
    typeof item.name === "string" &&
    item.name &&
    typeof item.version === "string" &&
    item.version
  )
    return {
      type: "remote-registry",
      registry: item.registry,
      name: item.name,
      version: item.version,
    };
  if (item.type === "local" && typeof item.path === "string" && item.path)
    return { type: "local", path: item.path };
  throw new Error(
    `${label}.source is not a supported catalog, github, git, registry, remote-registry, or local source`,
  );
}

function agents(value: unknown, label: string): AgentId[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const result = value.map((agent) => {
    if (typeof agent !== "string" || !AGENTS.has(agent as AgentId))
      throw new Error(`${label} contains unsupported agent '${String(agent)}'`);
    return agent as AgentId;
  });
  if (new Set(result).size !== result.length)
    throw new Error(`${label} contains duplicates`);
  return result;
}

export function parseManifest(value: unknown): LoadoutManifest {
  if (!value || typeof value !== "object")
    throw new Error("Manifest must be an object");
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1)
    throw new Error("Manifest schemaVersion must be 1");
  if (typeof item.name !== "string" || !item.name.trim())
    throw new Error("Manifest name is required");
  if (item.scope !== "project" && item.scope !== "global")
    throw new Error("Manifest scope must be project or global");
  if (!Array.isArray(item.packages))
    throw new Error("Manifest packages must be an array");
  const parsedPackages: ManifestPackage[] = item.packages.map(
    (entry, index) => {
      if (!entry || typeof entry !== "object")
        throw new Error(`packages[${index}] must be an object`);
      const pkg = entry as Record<string, unknown>;
      if (typeof pkg.id !== "string" || !pkg.id.trim())
        throw new Error(`packages[${index}].id is required`);
      const dependsOn =
        pkg.dependsOn === undefined
          ? undefined
          : (() => {
              if (
                !Array.isArray(pkg.dependsOn) ||
                pkg.dependsOn.some((id) => typeof id !== "string" || !id)
              )
                throw new Error(
                  `packages[${index}].dependsOn must contain package ids`,
                );
              if (new Set(pkg.dependsOn).size !== pkg.dependsOn.length)
                throw new Error(
                  `packages[${index}].dependsOn contains duplicates`,
                );
              return pkg.dependsOn as string[];
            })();
      const mcp =
        pkg.mcp === undefined
          ? undefined
          : (() => {
              if (
                !pkg.mcp ||
                typeof pkg.mcp !== "object" ||
                Array.isArray(pkg.mcp)
              )
                throw new Error(`packages[${index}].mcp must be an object`);
              const value = pkg.mcp as Record<string, unknown>;
              if (typeof value.config !== "string" || !value.config)
                throw new Error(`packages[${index}].mcp.config is required`);
              if (
                value.servers !== undefined &&
                (!Array.isArray(value.servers) ||
                  value.servers.some(
                    (name) => typeof name !== "string" || !name,
                  ))
              )
                throw new Error(
                  `packages[${index}].mcp.servers must contain server names`,
                );
              return {
                config: value.config,
                ...(value.servers
                  ? { servers: value.servers as string[] }
                  : {}),
              };
            })();
      const rootFiles =
        pkg.rootFiles === undefined
          ? undefined
          : (() => {
              if (
                !Array.isArray(pkg.rootFiles) ||
                pkg.rootFiles.some(
                  (entry) =>
                    !entry ||
                    typeof entry !== "object" ||
                    typeof (entry as Record<string, unknown>).source !==
                      "string" ||
                    typeof (entry as Record<string, unknown>).target !==
                      "string",
                )
              )
                throw new Error(
                  `packages[${index}].rootFiles must contain source and target paths`,
                );
              return pkg.rootFiles as Array<{ source: string; target: string }>;
            })();
      return {
        id: pkg.id,
        source: source(pkg.source, `packages[${index}]`),
        ...(pkg.agents === undefined
          ? {}
          : { agents: agents(pkg.agents, `packages[${index}].agents`) }),
        ...(dependsOn ? { dependsOn } : {}),
        ...(typeof pkg.includeDevDependencies === "boolean"
          ? { includeDevDependencies: pkg.includeDevDependencies }
          : {}),
        ...(mcp ? { mcp } : {}),
        ...(rootFiles ? { rootFiles } : {}),
        ...(typeof pkg.enabled === "boolean" ? { enabled: pkg.enabled } : {}),
      };
    },
  );
  const ids = parsedPackages.map((pkg) => pkg.id);
  if (new Set(ids).size !== ids.length)
    throw new Error("Manifest package ids must be unique");
  const known = new Set(ids);
  for (const pkg of parsedPackages)
    for (const dependency of pkg.dependsOn ?? [])
      if (!known.has(dependency))
        throw new Error(
          `Package '${pkg.id}' depends on missing package '${dependency}'`,
        );
  orderManifestPackages(parsedPackages);
  return {
    schemaVersion: 1,
    name: item.name.trim(),
    scope: item.scope,
    agents: agents(item.agents, "agents"),
    ...(typeof item.profile === "string" ? { profile: item.profile } : {}),
    packages: parsedPackages,
    ...(item.policy && typeof item.policy === "object"
      ? { policy: item.policy as LoadoutManifest["policy"] }
      : {}),
  };
}

export function orderManifestPackages(
  packages: ManifestPackage[],
): ManifestPackage[] {
  const byId = new Map(packages.map((pkg) => [pkg.id, pkg]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const result: ManifestPackage[] = [];
  function visit(id: string, chain: string[]): void {
    if (visited.has(id)) return;
    if (visiting.has(id))
      throw new Error(
        `Manifest dependency cycle: ${[...chain, id].join(" -> ")}`,
      );
    const pkg = byId.get(id);
    if (!pkg) throw new Error(`Missing manifest dependency '${id}'`);
    visiting.add(id);
    for (const dependency of pkg.dependsOn ?? [])
      visit(dependency, [...chain, id]);
    visiting.delete(id);
    visited.add(id);
    result.push(pkg);
  }
  for (const pkg of packages) visit(pkg.id, []);
  return result;
}

export async function readManifest(
  path = "loadout.json",
): Promise<LoadoutManifest> {
  try {
    return parseManifest(JSON.parse(await readFile(resolve(path), "utf8")));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    )
      throw new Error(`Loadout manifest not found: ${resolve(path)}`);
    throw new Error(
      `Invalid Loadout manifest at ${resolve(path)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function initManifest(
  path = "loadout.json",
  options: {
    name?: string;
    agents?: AgentId[];
    scope?: "project" | "global";
  } = {},
): Promise<LoadoutManifest> {
  const manifest: LoadoutManifest = {
    schemaVersion: 1,
    name: options.name ?? "my-loadout",
    scope: options.scope ?? "project",
    agents: options.agents ?? ["codex", "claude-code"],
    profile: "stable",
    packages: [],
  };
  await writeFile(resolve(path), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
  });
  return manifest;
}

async function writeManifest(
  manifest: LoadoutManifest,
  path: string,
): Promise<void> {
  await writeFileAtomically(
    resolve(path),
    `${JSON.stringify(manifest, null, 2)}\n`,
    0o644,
  );
}

export async function addManifestPackage(
  path: string,
  pkg: ManifestPackage,
): Promise<LoadoutManifest> {
  const manifest = await readManifest(path);
  if (manifest.packages.some((item) => item.id === pkg.id))
    throw new Error(`Manifest already contains package '${pkg.id}'`);
  const updated = parseManifest({
    ...manifest,
    packages: [...manifest.packages, pkg],
  });
  await writeManifest(updated, path);
  return updated;
}

export async function removeManifestPackage(
  path: string,
  packageId: string,
): Promise<LoadoutManifest> {
  const manifest = await readManifest(path);
  const packages = manifest.packages.filter((item) => item.id !== packageId);
  if (packages.length === manifest.packages.length)
    throw new Error(`Manifest does not contain package '${packageId}'`);
  const updated = parseManifest({ ...manifest, packages });
  await writeManifest(updated, path);
  return updated;
}

export async function applyProfileToManifest(
  path: string,
  profile: string,
  packages: Array<{ id: string; repository: string }>,
): Promise<LoadoutManifest> {
  const manifest = await readManifest(path);
  const existing = new Set(manifest.packages.map((pkg) => pkg.id));
  const additions: ManifestPackage[] = packages
    .filter((pkg) => !existing.has(pkg.id))
    .map((pkg) => ({
      id: pkg.id,
      source: { type: "github", repository: pkg.repository },
    }));
  const updated = parseManifest({
    ...manifest,
    profile,
    packages: [...manifest.packages, ...additions],
  });
  await writeManifest(updated, path);
  return updated;
}

export async function writeLockfile(
  manifest: LoadoutManifest,
  path = "loadout.lock",
): Promise<LoadoutLockfile> {
  const state = await readInstallState();
  const sourceById = new Map(
    manifest.packages.map((pkg) => [pkg.id, pkg.source]),
  );
  const lockfile: LoadoutLockfile = {
    schemaVersion: 1,
    manifestName: manifest.name,
    generatedAt: new Date().toISOString(),
    packages: state.installs
      .filter((entry) => sourceById.has(entry.packageId))
      .map((entry) => ({
        id: entry.packageId,
        source: sourceById.get(entry.packageId)!,
        repository: entry.repository,
        resolvedCommit: entry.resolvedCommit,
        targetAgents: entry.targetAgents,
        files: entry.files,
        installedAt: entry.installedAt,
        ...(manifest.packages.find((pkg) => pkg.id === entry.packageId)
          ?.dependsOn?.length
          ? {
              dependencies: manifest.packages.find(
                (pkg) => pkg.id === entry.packageId,
              )!.dependsOn,
            }
          : {}),
      })),
    mcpServers: (state.mcpInstalls ?? [])
      .filter((entry) => sourceById.has(entry.packageId))
      .map(({ packageId, configPath, serverName, fingerprint }) => ({
        packageId,
        configPath,
        serverName,
        fingerprint,
      })),
  };
  await writeFileAtomically(
    resolve(path),
    `${JSON.stringify(lockfile, null, 2)}\n`,
    0o600,
  );
  return lockfile;
}
