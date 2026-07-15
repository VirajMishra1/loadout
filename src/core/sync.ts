import { dirname, resolve, sep } from "node:path";
import type {
  AgentId,
  LoadoutManifest,
  ManifestPackage,
  McpConfigPlan,
} from "../shared/types.js";
import { loadEffectiveCatalog } from "./catalog.js";
import { installedAgents, type InstallBatchEntry } from "./install.js";
import {
  orderManifestPackages,
  readManifest,
  writeLockfile,
} from "./manifest.js";
import { detectAgents, userHome } from "./paths.js";
import { fetchGitSnapshot, fetchRepositorySnapshot } from "./source.js";
import { addRootFileExports, buildUniversalPackagePlan } from "./components.js";
import {
  analyzeInstallPlanSafety,
  type UpdateSafetyAnalysis,
} from "./safety.js";
import {
  fetchRemoteRegistryPackage,
  packPackage,
  resolveRegistryPackage,
} from "./registry.js";
import { createSnapshot, restoreSnapshot } from "./snapshot.js";
import {
  discoverMcpManifests,
  planMcpConfigBatch,
  writeMcpConfigPlan,
} from "./mcp.js";
import { applySkillPlan, detectInstallConflicts } from "./skills.js";
import { installStatePath, recordInstallTransaction } from "./state.js";

export interface SyncPlan {
  manifest: string;
  resolvedManifest?: LoadoutManifest;
  packages: Array<InstallBatchEntry & { safety: UpdateSafetyAnalysis }>;
  mcpPlans: Array<{ packageId: string; plan: McpConfigPlan }>;
  skipped: Array<{ packageId: string; reason: string }>;
  policyViolations: string[];
}

function registrySourceKey(
  source: ManifestPackage["source"],
): string | undefined {
  if (source.type === "registry")
    return `local:${source.name}@${source.version}`;
  if (source.type === "remote-registry")
    return `${source.registry}:${source.name}@${source.version}`;
  return undefined;
}

function dependencySource(
  parent: ManifestPackage["source"],
  name: string,
  version: string,
): ManifestPackage["source"] {
  if (parent.type === "registry") return { type: "registry", name, version };
  if (parent.type === "remote-registry")
    return {
      type: "remote-registry",
      registry: parent.registry,
      name,
      version,
    };
  throw new Error(
    "Only registry packages can resolve package-owned dependencies",
  );
}

async function expandRegistryDependencies(
  manifest: LoadoutManifest,
): Promise<LoadoutManifest> {
  const explicit = new Map(manifest.packages.map((pkg) => [pkg.id, pkg]));
  const expanded = new Map<string, ManifestPackage>();
  const visiting = new Set<string>();
  const packageCache = new Map<
    string,
    Awaited<ReturnType<typeof packPackage>>
  >();
  const requestedVersions = new Map<string, string>();

  async function visit(input: ManifestPackage, chain: string[]): Promise<void> {
    const key = registrySourceKey(input.source);
    if (!key) {
      if (!expanded.has(input.id)) expanded.set(input.id, input);
      return;
    }
    if (visiting.has(key))
      throw new Error(
        `Registry dependency cycle: ${[...chain, input.id].join(" -> ")}`,
      );
    const existing = expanded.get(input.id);
    if (existing) {
      if (JSON.stringify(existing.source) !== JSON.stringify(input.source))
        throw new Error(
          `Registry dependency id '${input.id}' resolves to conflicting sources`,
        );
      const agents =
        existing.agents === undefined || input.agents === undefined
          ? undefined
          : [...new Set([...existing.agents, ...input.agents])];
      expanded.set(input.id, {
        ...existing,
        ...(agents ? { agents } : { agents: undefined }),
      });
      return;
    }
    visiting.add(key);
    let packed = packageCache.get(key);
    if (!packed) {
      const source = await resolvePackage(input);
      packed = await packPackage(source.path);
      packageCache.set(key, packed);
    }
    const dependencies = Object.entries({
      ...(packed.descriptor.dependencies ?? {}),
      ...(input.includeDevDependencies
        ? (packed.descriptor.devDependencies ?? {})
        : {}),
    }).sort(([left], [right]) => left.localeCompare(right));
    const dependencyIds: string[] = [];
    for (const [name, version] of dependencies) {
      const previous = requestedVersions.get(name);
      if (previous && previous !== version)
        throw new Error(
          `Registry dependency version conflict for '${name}': ${previous} versus ${version}`,
        );
      requestedVersions.set(name, version);
      const source = dependencySource(input.source, name, version);
      const configured = explicit.get(name);
      if (
        configured &&
        JSON.stringify(configured.source) !== JSON.stringify(source)
      )
        throw new Error(
          `Registry dependency '${name}@${version}' conflicts with explicitly configured package '${name}'`,
        );
      await visit(
        configured ?? {
          id: name,
          source,
          ...(input.agents ? { agents: input.agents } : {}),
        },
        [...chain, input.id],
      );
      dependencyIds.push(name);
    }
    visiting.delete(key);
    const dependsOn = [
      ...new Set([...(input.dependsOn ?? []), ...dependencyIds]),
    ];
    expanded.set(input.id, {
      ...input,
      ...(dependsOn.length ? { dependsOn } : {}),
    });
  }

  for (const pkg of manifest.packages) await visit(pkg, []);
  return { ...manifest, packages: [...expanded.values()] };
}

function policyViolations(
  manifest: LoadoutManifest,
  packages: SyncPlan["packages"],
): string[] {
  const violations: string[] = [];
  const blockedDomains = new Set(
    (manifest.policy?.blockedDomains ?? []).map((domain) =>
      domain.toLowerCase(),
    ),
  );
  const blockedCommands = new Set(
    (manifest.policy?.blockedCommands ?? []).map((command) =>
      command.toLowerCase(),
    ),
  );
  const allowPackages = new Set(manifest.policy?.allowPackages ?? []);
  const allowRepositories = new Set(
    (manifest.policy?.allowRepositories ?? []).map((repository) =>
      repository.toLowerCase(),
    ),
  );
  const deniedPackages = new Set(manifest.policy?.deniedPackages ?? []);
  const deniedRepositories = new Set(
    (manifest.policy?.deniedRepositories ?? []).map((repository) =>
      repository.toLowerCase(),
    ),
  );
  for (const entry of packages) {
    const packageId = entry.plan.packageId;
    const repository = entry.metadata?.repository?.toLowerCase();
    if (allowPackages.size && !allowPackages.has(packageId))
      violations.push(`${packageId} is not on the package allowlist`);
    if (
      allowRepositories.size &&
      (!repository || !allowRepositories.has(repository))
    )
      violations.push(`${packageId} is not on the repository allowlist`);
    if (deniedPackages.has(packageId))
      violations.push(`${packageId} is on the package denylist`);
    if (repository && deniedRepositories.has(repository))
      violations.push(`${packageId} is on the repository denylist`);
    for (const finding of entry.safety.findings) {
      if (finding.category === "domain")
        for (const domain of finding.names ?? [])
          if (blockedDomains.has(domain.toLowerCase()))
            violations.push(
              `${entry.plan.packageId} references blocked domain '${domain}'`,
            );
    }
    for (const file of entry.plan.files) {
      const name = file.source
        .split(/[\\/]/)
        .at(-1)
        ?.replace(/\.[^.]+$/, "")
        .toLowerCase();
      if (name && blockedCommands.has(name))
        violations.push(
          `${entry.plan.packageId} contains blocked command '${name}'`,
        );
    }
  }
  return [...new Set(violations)];
}

async function resolvePackage(
  pkg: ManifestPackage,
): Promise<{ path: string; repository?: string; commit?: string }> {
  if (pkg.source.type === "local") return { path: resolve(pkg.source.path) };
  if (pkg.source.type === "github") {
    const fetched = await fetchRepositorySnapshot(pkg.source.repository, {
      ref: pkg.source.ref,
    });
    const selected = pkg.source.path
      ? resolve(fetched.path, pkg.source.path)
      : fetched.path;
    if (
      selected !== fetched.path &&
      !selected.startsWith(`${fetched.path}${sep}`)
    )
      throw new Error(
        `Package subpath escapes fetched repository: ${pkg.source.path}`,
      );
    return {
      path: selected,
      repository: fetched.repository,
      commit: fetched.commit,
    };
  }
  if (pkg.source.type === "git") {
    const fetched = await fetchGitSnapshot(pkg.source.url, {
      ref: pkg.source.ref,
    });
    const selected = pkg.source.path
      ? resolve(fetched.path, pkg.source.path)
      : fetched.path;
    if (
      selected !== fetched.path &&
      !selected.startsWith(`${fetched.path}${sep}`)
    )
      throw new Error(
        `Package subpath escapes fetched Git repository: ${pkg.source.path}`,
      );
    return { path: selected, commit: fetched.commit };
  }
  if (pkg.source.type === "registry") {
    const resolved = await resolveRegistryPackage(
      pkg.source.name,
      pkg.source.version,
    );
    return { path: resolved.path, commit: resolved.digest };
  }
  if (pkg.source.type === "remote-registry") {
    const resolved = await fetchRemoteRegistryPackage(
      pkg.source.registry,
      pkg.source.name,
      pkg.source.version,
    );
    return { path: resolved.path, commit: resolved.digest };
  }
  const catalogId = pkg.source.id;
  const catalog = await loadEffectiveCatalog();
  const found = catalog.find((item) => item.id === catalogId);
  if (!found) throw new Error(`Unknown catalog package '${catalogId}'`);
  const fetched = await fetchRepositorySnapshot(found.repository);
  return {
    path: fetched.path,
    repository: fetched.repository,
    commit: fetched.commit,
  };
}

export async function buildSyncPlan(
  manifestPath = "loadout.json",
): Promise<SyncPlan> {
  const manifest = await expandRegistryDependencies(
    await readManifest(manifestPath),
  );
  const disabled = new Set(
    manifest.packages
      .filter((pkg) => pkg.enabled === false)
      .map((pkg) => pkg.id),
  );
  for (const pkg of manifest.packages.filter(
    (item) => item.enabled !== false,
  )) {
    const unavailable = (pkg.dependsOn ?? []).filter((id) => disabled.has(id));
    if (unavailable.length)
      throw new Error(
        `Enabled package '${pkg.id}' depends on disabled package(s): ${unavailable.join(", ")}`,
      );
  }
  const detected = await detectAgents();
  const rootFileTarget =
    manifest.scope === "project" ? dirname(resolve(manifestPath)) : userHome();
  const packages: SyncPlan["packages"] = [];
  const mcpPlans: SyncPlan["mcpPlans"] = [];
  const skipped: SyncPlan["skipped"] = [];
  for (const pkg of orderManifestPackages(manifest.packages).filter(
    (item) => item.enabled !== false,
  )) {
    const requested = pkg.agents ?? manifest.agents;
    const agents = installedAgents(detected, requested as AgentId[]);
    const source = await resolvePackage(pkg);
    let plan;
    try {
      plan = await buildUniversalPackagePlan(source.path, pkg.id, agents);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("No supported"))
        plan = {
          packageId: pkg.id,
          files: [],
          targetAgents: agents.map((agent) => agent.id),
          warnings: [],
        };
      else throw error;
    }
    if (pkg.rootFiles?.length)
      await addRootFileExports(
        plan,
        source.path,
        rootFileTarget,
        pkg.rootFiles,
      );
    const manifests = pkg.mcp ? await discoverMcpManifests(source.path) : [];
    const allServers = manifests.flatMap((manifest) => manifest.servers);
    const requestedServers =
      pkg.mcp?.servers ?? allServers.map((server) => server.name);
    const selectedServers = requestedServers.map((name) => {
      const matches = allServers.filter((server) => server.name === name);
      if (matches.length === 0)
        throw new Error(
          `MCP server '${name}' was not found in package '${pkg.id}'`,
        );
      if (matches.length > 1)
        throw new Error(
          `MCP server '${name}' is ambiguous in package '${pkg.id}'`,
        );
      return matches[0];
    });
    if (pkg.mcp && selectedServers.length === 0)
      throw new Error(
        `Package '${pkg.id}' has MCP configuration enabled but contains no MCP servers`,
      );
    if (pkg.mcp)
      mcpPlans.push({
        packageId: pkg.id,
        plan: await planMcpConfigBatch(
          resolve(pkg.mcp.config),
          selectedServers.map((server) => ({ server })),
        ),
      });
    if (plan.files.length === 0 && selectedServers.length === 0) {
      skipped.push({
        packageId: pkg.id,
        reason:
          "No supported skill, rule, command, agent, or configured MCP component was found.",
      });
      continue;
    }
    const safetyPlan = {
      ...plan,
      files: [
        ...plan.files,
        ...manifests.map((manifest) => ({
          source: manifest.path,
          target: manifest.path,
          componentType: "mcp" as const,
        })),
      ],
    };
    const safety = await analyzeInstallPlanSafety(safetyPlan);
    if (pkg.mcp) {
      safety.approvalRequired = true;
      safety.findings.push({
        severity: "blocking",
        category: "mcp",
        message:
          "Package changes MCP configuration and requires explicit approval.",
        paths: [resolve(pkg.mcp.config)],
        names: selectedServers.map((server) => server.name),
      });
    }
    packages.push({
      plan,
      metadata: {
        repository: source.repository,
        resolvedCommit: source.commit,
      },
      safety,
    });
  }
  return {
    manifest: manifestPath,
    resolvedManifest: manifest,
    packages,
    mcpPlans,
    skipped,
    policyViolations: policyViolations(manifest, packages),
  };
}

export async function applySyncPlan(
  plan: SyncPlan,
  lockPath = "loadout.lock",
  options: { approveRisk?: boolean } = {},
): Promise<{ snapshotId?: string; lockfile: string }> {
  if (plan.policyViolations.length)
    throw new Error(
      `Synchronization violates manifest policy: ${plan.policyViolations.join("; ")}`,
    );
  const blocked = plan.packages.filter(
    (entry) => entry.safety.approvalRequired,
  );
  if (blocked.length && !options.approveRisk)
    throw new Error(
      `Synchronization requires explicit risk approval for: ${blocked.map((entry) => entry.plan.packageId).join(", ")}`,
    );
  const conflicts = detectInstallConflicts(
    plan.packages.map((entry) => entry.plan),
  );
  const blockingConflicts = conflicts.filter(
    (conflict) => conflict.severity === "blocking",
  );
  if (blockingConflicts.length)
    throw new Error(
      `Synchronization has blocking target conflicts: ${blockingConflicts.map((conflict) => conflict.message).join("; ")}`,
    );
  if (!plan.packages.length && !plan.mcpPlans.length) {
    await writeLockfile(
      plan.resolvedManifest ?? (await readManifest(plan.manifest)),
      lockPath,
    );
    return { lockfile: lockPath };
  }
  const snapshot = await createSnapshot([
    ...plan.packages.flatMap((entry) =>
      entry.plan.files.map((file) => file.target),
    ),
    ...plan.mcpPlans.map((entry) => entry.plan.path),
    installStatePath(),
    resolve(lockPath),
  ]);
  try {
    for (const entry of plan.packages)
      if (entry.plan.files.length) await applySkillPlan(entry.plan);
    for (const entry of plan.mcpPlans) await writeMcpConfigPlan(entry.plan);
    await recordInstallTransaction(plan.packages, plan.mcpPlans, snapshot.id);
    await writeLockfile(
      plan.resolvedManifest ?? (await readManifest(plan.manifest)),
      lockPath,
    );
  } catch (error) {
    await restoreSnapshot(snapshot);
    throw error;
  }
  return { snapshotId: snapshot.id, lockfile: lockPath };
}
