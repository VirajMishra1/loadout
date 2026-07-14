import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { PackageDescriptor, PackedPackage } from "../shared/types.js";
import { loadoutHome } from "./paths.js";
import { analyzeUpdateSafety, type UpdateSafetyAnalysis } from "./safety.js";

const NAME = /^[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

export function parsePackageDescriptor(value: unknown): PackageDescriptor {
  if (!value || typeof value !== "object") throw new Error("Package descriptor must be an object");
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1) throw new Error("Package schemaVersion must be 1");
  if (typeof item.name !== "string" || !NAME.test(item.name)) throw new Error("Package name must use lowercase letters, numbers, dots, underscores, or dashes");
  if (typeof item.version !== "string" || !VERSION.test(item.version)) throw new Error("Package version must be semantic version such as 1.0.0");
  if (typeof item.description !== "string" || !item.description.trim()) throw new Error("Package description is required");
  if (item.dependencies !== undefined && (!item.dependencies || typeof item.dependencies !== "object" || Array.isArray(item.dependencies) || Object.entries(item.dependencies).some(([name, version]) => !NAME.test(name) || typeof version !== "string" || !version))) throw new Error("Package dependencies must map names to version constraints");
  return { schemaVersion: 1, name: item.name, version: item.version, description: item.description.trim(), ...(typeof item.license === "string" ? { license: item.license } : {}), ...(item.dependencies ? { dependencies: item.dependencies as Record<string, string> } : {}) };
}

export async function createPackage(root: string, options: { name: string; description?: string; version?: string }): Promise<PackageDescriptor> {
  const directory = resolve(root);
  const descriptor = parsePackageDescriptor({ schemaVersion: 1, name: options.name, version: options.version ?? "0.1.0", description: options.description ?? `${options.name} Loadout package` });
  await mkdir(directory, { recursive: false });
  await Promise.all(["skills", "rules", "commands", "agents"].map((name) => mkdir(join(directory, name))));
  await writeFile(join(directory, "loadout-package.json"), `${JSON.stringify(descriptor, null, 2)}\n`);
  await writeFile(join(directory, "README.md"), `# ${descriptor.name}\n\n${descriptor.description}\n`);
  return descriptor;
}

async function inventory(root: string): Promise<PackedPackage["files"]> {
  const base = resolve(root); const files: PackedPackage["files"] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".loadout-record.json") continue;
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in package: ${absolute}`);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) {
        const content = await readFile(absolute);
        files.push({ path: relative(base, absolute).split(sep).join("/"), sha256: createHash("sha256").update(content).digest("hex"), size: content.length });
      }
    }
  }
  await visit(base);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function packPackage(root: string): Promise<PackedPackage> {
  const directory = resolve(root);
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Package root must be a real directory");
  const descriptor = parsePackageDescriptor(JSON.parse(await readFile(join(directory, "loadout-package.json"), "utf8")));
  const files = await inventory(directory);
  const digest = createHash("sha256").update(files.map((file) => `${file.path}\0${file.sha256}\0${file.size}`).join("\n")).digest("hex");
  return { descriptor, root: directory, digest, files };
}

const registryRoot = () => join(loadoutHome(), "registry");

export async function publishLocalPackage(root: string, options: { approveRisk?: boolean } = {}): Promise<PackedPackage> {
  const packed = await packPackage(root);
  const safety: UpdateSafetyAnalysis = await analyzeUpdateSafety(undefined, packed.root);
  if (safety.approvalRequired && !options.approveRisk) throw new Error(`Publishing requires explicit risk approval: ${safety.findings.filter((finding) => finding.severity === "blocking").map((finding) => finding.message).join(" ")}`);
  const target = join(registryRoot(), packed.descriptor.name, packed.descriptor.version);
  try {
    const existing = JSON.parse(await readFile(join(target, ".loadout-record.json"), "utf8")) as { digest?: string };
    if (existing.digest === packed.digest) return packed;
    throw new Error(`Registry version ${packed.descriptor.name}@${packed.descriptor.version} already exists with different content`);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT")) throw error;
  }
  const temporary = `${target}.staging-${process.pid}-${Date.now()}`;
  await mkdir(temporary, { recursive: true });
  try {
    for (const file of packed.files) {
      const source = resolve(packed.root, file.path); const destination = resolve(temporary, file.path);
      if (!destination.startsWith(`${resolve(temporary)}${sep}`)) throw new Error(`Package file escapes registry target: ${file.path}`);
      await mkdir(resolve(destination, ".."), { recursive: true });
      await cp(source, destination);
    }
    await writeFile(join(temporary, ".loadout-record.json"), `${JSON.stringify({ name: packed.descriptor.name, version: packed.descriptor.version, digest: packed.digest, publishedAt: new Date().toISOString(), safety }, null, 2)}\n`);
    await mkdir(join(registryRoot(), packed.descriptor.name), { recursive: true });
    await cp(temporary, target, { recursive: true, errorOnExist: true });
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return packed;
}

export async function resolveRegistryPackage(name: string, version: string): Promise<{ path: string; digest: string }> {
  if (!NAME.test(name) || !VERSION.test(version)) throw new Error("Invalid registry package name or version");
  const path = join(registryRoot(), name, version);
  try {
    const record = JSON.parse(await readFile(join(path, ".loadout-record.json"), "utf8")) as { digest?: string };
    if (!record.digest) throw new Error("missing digest");
    const packed = await packPackage(path);
    if (packed.digest !== record.digest) throw new Error("registry package content does not match its immutable digest");
    return { path, digest: record.digest };
  } catch (error) { throw new Error(`Could not resolve registry package ${name}@${version}: ${error instanceof Error ? error.message : String(error)}`); }
}

export async function searchLocalRegistry(query = ""): Promise<Array<{ name: string; version: string; description: string }>> {
  const results: Array<{ name: string; version: string; description: string }> = [];
  let names: string[] = []; try { names = await readdir(registryRoot()); } catch { return results; }
  for (const name of names.sort()) {
    let versions: string[] = []; try { versions = await readdir(join(registryRoot(), name)); } catch { continue; }
    for (const version of versions.sort()) {
      try {
        const descriptor = parsePackageDescriptor(JSON.parse(await readFile(join(registryRoot(), name, version, "loadout-package.json"), "utf8")));
        if (!query || `${descriptor.name} ${descriptor.description}`.toLowerCase().includes(query.toLowerCase())) results.push({ name, version, description: descriptor.description });
      } catch { /* ignore corrupt entries; resolve reports exact errors */ }
    }
  }
  return results;
}
