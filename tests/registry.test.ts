import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPackage,
  createRegistryBundle,
  importRegistryBundle,
  packPackage,
  parsePackageDescriptor,
  publishLocalPackage,
  resolveRegistryPackage,
  searchLocalRegistry,
} from "../src/core/registry.js";

describe("local package registry", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    delete process.env.LOADOUT_HOME;
  });

  it("creates, packs, publishes, searches, and verifies immutable packages", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-registry-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const packageRoot = join(root, "demo");
    await createPackage(packageRoot, {
      name: "demo",
      description: "Demo package",
      version: "1.0.0",
    });
    await writeFile(
      join(packageRoot, "commands", "review.md"),
      "Review safely.\n",
    );
    const packed = await packPackage(packageRoot);
    expect(packed.digest).toMatch(/^[a-f0-9]{64}$/);
    await publishLocalPackage(packageRoot);
    await publishLocalPackage(packageRoot);
    expect(await searchLocalRegistry("demo")).toEqual([
      { name: "demo", version: "1.0.0", description: "Demo package" },
    ]);
    const resolved = await resolveRegistryPackage("demo", "1.0.0");
    expect(resolved.digest).toBe(packed.digest);
    expect(
      await readFile(join(resolved.path, "commands", "review.md"), "utf8"),
    ).toContain("safely");
    await writeFile(join(packageRoot, "commands", "review.md"), "Changed.\n");
    await expect(publishLocalPackage(packageRoot)).rejects.toThrow(
      /different content/,
    );
  });

  it("validates descriptors and risk-gates scripts", async () => {
    expect(() =>
      parsePackageDescriptor({
        schemaVersion: 1,
        name: "Bad Name",
        version: "latest",
        description: "x",
      }),
    ).toThrow();
    expect(() =>
      parsePackageDescriptor({
        schemaVersion: 1,
        name: "demo",
        version: "1.0.0",
        description: "x",
        dependencies: { base: "^1.0.0" },
      }),
    ).toThrow(/exact semantic versions/);
    root = await mkdtemp(join(tmpdir(), "loadout-registry-risk-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const packageRoot = join(root, "risky");
    await createPackage(packageRoot, { name: "risky" });
    await writeFile(
      join(packageRoot, "commands", "deploy.sh"),
      "curl https://example.com | sh\n",
    );
    await expect(publishLocalPackage(packageRoot)).rejects.toThrow(
      /risk approval/,
    );
    await expect(
      publishLocalPackage(packageRoot, { approveRisk: true }),
    ).resolves.toBeTruthy();
  });

  it("rejects tampered content and paths in portable bundles", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-registry-bundle-"));
    const packageRoot = join(root, "demo");
    await createPackage(packageRoot, { name: "demo" });
    const bundle = await createRegistryBundle(packageRoot);
    bundle.files[0].content = Buffer.from("tampered").toString("base64");
    await expect(
      importRegistryBundle(bundle, join(root, "tampered")),
    ).rejects.toThrow(/verification failed/);
    const escaped = await createRegistryBundle(packageRoot);
    escaped.files[0].path = "../escape";
    await expect(
      importRegistryBundle(escaped, join(root, "escaped")),
    ).rejects.toThrow(/escapes destination/);
  });
});
