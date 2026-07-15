import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { LoadoutLockfile, LoadoutManifest } from "../shared/types.js";
import { parseLockfile, readLockfile } from "./audit.js";
import { parseManifest, readManifest } from "./manifest.js";
import { createSnapshot, restoreSnapshot } from "./snapshot.js";
import { detectSecretKinds } from "./safety.js";

export interface PortableLoadout {
  schemaVersion: 1;
  kind: "loadout-portable";
  exportedAt: string;
  manifest: LoadoutManifest;
  lockfile?: LoadoutLockfile;
}

export interface ImportPlan {
  source: string;
  manifestPath: string;
  lockPath?: string;
  packageCount: number;
  includesLockfile: boolean;
  warnings: string[];
}

export function parsePortableLoadout(value: unknown): PortableLoadout {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Portable Loadout must be an object");
  const item = value as Record<string, unknown>;
  if (
    item.schemaVersion !== 1 ||
    item.kind !== "loadout-portable" ||
    typeof item.exportedAt !== "string"
  )
    throw new Error("Portable Loadout schema is invalid");
  const manifest = parseManifest(item.manifest);
  const lockfile =
    item.lockfile === undefined ? undefined : parseLockfile(item.lockfile);
  if (lockfile && lockfile.manifestName !== manifest.name)
    throw new Error("Portable lockfile does not belong to its manifest");
  const serialized = JSON.stringify({ manifest, lockfile });
  const secrets = detectSecretKinds(serialized);
  if (secrets.length)
    throw new Error(
      `Portable Loadout appears to contain secret material: ${secrets.join(", ")}`,
    );
  return {
    schemaVersion: 1,
    kind: "loadout-portable",
    exportedAt: item.exportedAt,
    manifest,
    ...(lockfile ? { lockfile } : {}),
  };
}

export async function exportPortableLoadout(
  manifestPath: string,
  output: string,
  lockPath?: string,
): Promise<PortableLoadout> {
  const manifest = await readManifest(manifestPath);
  const absoluteLocal = manifest.packages.find(
    (pkg) => pkg.source.type === "local" && isAbsolute(pkg.source.path),
  );
  if (absoluteLocal)
    throw new Error(
      `Package '${absoluteLocal.id}' uses an absolute local path and cannot be exported portably`,
    );
  const lockfile = lockPath ? await readLockfile(lockPath) : undefined;
  const bundle = parsePortableLoadout({
    schemaVersion: 1,
    kind: "loadout-portable",
    exportedAt: new Date().toISOString(),
    manifest,
    lockfile,
  });
  const target = resolve(output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(bundle, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return bundle;
}

async function readPortableFile(path: string): Promise<PortableLoadout> {
  const source = resolve(path);
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("Portable Loadout source must be a real file");
  if (info.size > 5_000_000)
    throw new Error("Portable Loadout exceeds the 5 MB limit");
  return parsePortableLoadout(JSON.parse(await readFile(source, "utf8")));
}

export async function planPortableImport(
  source: string,
  manifestPath = "loadout.json",
  lockPath = "loadout.lock",
): Promise<{ plan: ImportPlan; bundle: PortableLoadout }> {
  const bundle = await readPortableFile(source);
  const warnings = bundle.manifest.packages
    .filter((pkg) => pkg.source.type === "local")
    .map(
      (pkg) =>
        `Local package '${pkg.id}' is resolved relative to the importing machine.`,
    );
  return {
    plan: {
      source: resolve(source),
      manifestPath: resolve(manifestPath),
      ...(bundle.lockfile ? { lockPath: resolve(lockPath) } : {}),
      packageCount: bundle.manifest.packages.length,
      includesLockfile: Boolean(bundle.lockfile),
      warnings,
    },
    bundle,
  };
}

export async function applyPortableImport(
  source: string,
  manifestPath = "loadout.json",
  lockPath = "loadout.lock",
  options: { overwrite?: boolean } = {},
): Promise<{ plan: ImportPlan; snapshotId: string }> {
  const { plan, bundle } = await planPortableImport(
    source,
    manifestPath,
    lockPath,
  );
  const targets = [
    plan.manifestPath,
    ...(plan.lockPath ? [plan.lockPath] : []),
  ];
  if (!options.overwrite) {
    for (const target of targets) {
      try {
        await lstat(target);
        throw new Error(
          `Refusing to overwrite existing file without --overwrite: ${target}`,
        );
      } catch (error) {
        if (!(
          error &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code?: string }).code === "ENOENT"
        ))
          throw error;
      }
    }
  }
  const snapshot = await createSnapshot(targets);
  const writes = [
    { path: plan.manifestPath, value: bundle.manifest },
    ...(plan.lockPath && bundle.lockfile
      ? [{ path: plan.lockPath, value: bundle.lockfile }]
      : []),
  ];
  const temporary: string[] = [];
  try {
    for (const entry of writes) {
      await mkdir(dirname(entry.path), { recursive: true });
      const temp = `${entry.path}.loadout-import-${process.pid}-${Date.now()}`;
      temporary.push(temp);
      await writeFile(temp, `${JSON.stringify(entry.value, null, 2)}\n`, {
        flag: "wx",
      });
    }
    for (let index = 0; index < writes.length; index += 1) {
      if (options.overwrite) await rm(writes[index].path, { force: true });
      await rename(temporary[index], writes[index].path);
    }
    return { plan, snapshotId: snapshot.id };
  } catch (error) {
    await restoreSnapshot(snapshot);
    throw error;
  } finally {
    await Promise.all(temporary.map((path) => rm(path, { force: true })));
  }
}
