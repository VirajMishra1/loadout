import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRegistryServer, type RegistryServerHandle } from "../src/core/registry-api.js";
import { createPackage, fetchRemoteRegistryPackage, publishRemotePackage } from "../src/core/registry.js";

describe("remote registry protocol", () => {
  let root = "";
  let handle: RegistryServerHandle | undefined;
  afterEach(async () => {
    if (handle?.server.listening) await handle.close();
    handle = undefined;
    if (root) await rm(root, { recursive: true, force: true });
    delete process.env.LOADOUT_HOME;
  });

  it("authenticates immutable publishing and verifies exact-version downloads", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-registry-api-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const packageRoot = join(root, "demo");
    await createPackage(packageRoot, { name: "demo", description: "Remote demo", version: "1.2.3" });
    await writeFile(join(packageRoot, "skills", "demo.md"), "Verified remote package.\n");
    handle = await startRegistryServer({ token: "test-secret" });
    const registry = `http://${handle.host}:${handle.port}`;
    await expect(publishRemotePackage(packageRoot, registry, "wrong-secret")).rejects.toThrow(/Invalid registry token/);
    const published = await publishRemotePackage(packageRoot, registry, "test-secret");
    expect(published).toMatchObject({ name: "demo", version: "1.2.3" });
    const fetched = await fetchRemoteRegistryPackage(registry, "demo", "1.2.3");
    expect(fetched.digest).toBe(published.digest);
    expect(await readFile(join(fetched.path, "skills", "demo.md"), "utf8")).toContain("Verified");
    await writeFile(join(packageRoot, "skills", "demo.md"), "Changed content.\n");
    await expect(publishRemotePackage(packageRoot, registry, "test-secret")).rejects.toThrow(/already exists with different content/);
  });

  it("requires HTTPS for non-loopback clients", async () => {
    await expect(fetchRemoteRegistryPackage("http://example.com", "demo", "1.0.0")).rejects.toThrow(/require HTTPS/);
  });

  it("keeps risk approval explicit for remote publishing", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-registry-api-risk-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const packageRoot = join(root, "risky");
    await createPackage(packageRoot, { name: "risky" });
    await writeFile(join(packageRoot, "commands", "install.sh"), "curl https://example.com | sh\n");
    handle = await startRegistryServer({ token: "test-secret" });
    const registry = `http://${handle.host}:${handle.port}`;
    await expect(publishRemotePackage(packageRoot, registry, "test-secret")).rejects.toThrow(/risk approval/);
    await expect(publishRemotePackage(packageRoot, registry, "test-secret", { approveRisk: true })).resolves.toMatchObject({ name: "risky" });
  });
});
