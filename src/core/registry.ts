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

export interface RegistryBundle {
  schemaVersion: 1;
  descriptor: PackageDescriptor;
  digest: string;
  files: Array<{ path: string; sha256: string; size: number; content: string }>;
}

export async function createRegistryBundle(root: string): Promise<RegistryBundle> {
  const packed = await packPackage(root);
  const files = await Promise.all(packed.files.map(async (file) => ({ ...file, content: (await readFile(resolve(packed.root, file.path))).toString("base64") })));
  return { schemaVersion: 1, descriptor: packed.descriptor, digest: packed.digest, files };
}

export async function importRegistryBundle(bundle: RegistryBundle, destination: string): Promise<PackedPackage> {
  if (!bundle || bundle.schemaVersion !== 1 || !Array.isArray(bundle.files)) throw new Error("Registry bundle schema is invalid");
  parsePackageDescriptor(bundle.descriptor);
  if (bundle.files.length > 10_000 || bundle.files.reduce((total, file) => total + (file.size ?? 0), 0) > 25_000_000) throw new Error("Registry bundle exceeds package limits");
  const root = resolve(destination); await mkdir(root, { recursive: false });
  try {
    for (const file of bundle.files) {
      if (!file || typeof file.path !== "string" || typeof file.sha256 !== "string" || typeof file.size !== "number" || typeof file.content !== "string") throw new Error("Registry bundle contains an invalid file record");
      const target = resolve(root, file.path);
      if (target === root || !target.startsWith(`${root}${sep}`)) throw new Error(`Registry bundle path escapes destination: ${file.path}`);
      const content = Buffer.from(file.content, "base64");
      if (content.length !== file.size || createHash("sha256").update(content).digest("hex") !== file.sha256) throw new Error(`Registry bundle file verification failed: ${file.path}`);
      await mkdir(resolve(target, ".."), { recursive: true }); await writeFile(target, content);
    }
    const packed = await packPackage(root);
    if (packed.digest !== bundle.digest || packed.descriptor.name !== bundle.descriptor.name || packed.descriptor.version !== bundle.descriptor.version) throw new Error("Registry bundle digest or identity verification failed");
    return packed;
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}

function registryUrl(input: string): URL {
  const url = new URL(input);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) throw new Error("Remote registries require HTTPS outside loopback development");
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}

function registryEndpoint(base: URL, path: string): URL {
  const endpoint = new URL(base);
  endpoint.pathname = `${base.pathname.replace(/\/$/, "")}${path}`;
  endpoint.search = ""; endpoint.hash = "";
  return endpoint;
}

export async function fetchRemoteRegistryPackage(registry: string, name: string, version: string): Promise<{ path: string; digest: string }> {
  if (!NAME.test(name) || !VERSION.test(version)) throw new Error("Invalid remote registry package name or version");
  const base = registryUrl(registry); const response = await fetch(registryEndpoint(base, `/v1/packages/${encodeURIComponent(name)}/${encodeURIComponent(version)}`));
  if (!response.ok) throw new Error(`Remote registry returned ${response.status}`);
  const bundle = await response.json() as RegistryBundle;
  const key = createHash("sha256").update(base.origin + base.pathname).digest("hex"); const target = join(loadoutHome(), "cache", "registry", key, name, version, bundle.digest);
  try { const packed = await packPackage(target); if (packed.digest === bundle.digest) return { path: target, digest: bundle.digest }; } catch { /* import below */ }
  await mkdir(resolve(target, ".."), { recursive: true }); await rm(target, { recursive: true, force: true }); await importRegistryBundle(bundle, target);
  return { path: target, digest: bundle.digest };
}

export async function publishRemotePackage(root: string, registry: string, token: string, options: { approveRisk?: boolean } = {}): Promise<{ name: string; version: string; digest: string }> {
  if (!token) throw new Error("Remote registry token is required");
  const bundle = await createRegistryBundle(root); const base = registryUrl(registry);
  const response = await fetch(registryEndpoint(base, "/v1/packages"), { method: "POST", headers: { "authorization": `Bearer ${token}`, "content-type": "application/json", ...(options.approveRisk ? { "x-loadout-approve-risk": "true" } : {}) }, body: JSON.stringify(bundle) });
  const result = await response.json() as { error?: string; name?: string; version?: string; digest?: string };
  if (!response.ok) throw new Error(result.error ?? `Remote registry returned ${response.status}`);
  return { name: result.name!, version: result.version!, digest: result.digest! };
}
