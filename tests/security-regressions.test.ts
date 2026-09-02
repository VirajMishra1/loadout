import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fetchRemoteRegistryPackage } from "../src/core/catalog/registry.js";
import { analyzeUpdateSafety } from "../src/core/catalog/safety.js";

describe("security regressions", () => {
  let home: string;
  let work: string;
  const originalHome = process.env.LOADOUT_HOME;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "loadout-sec-home-"));
    work = await mkdtemp(join(tmpdir(), "loadout-sec-work-"));
    process.env.LOADOUT_HOME = home;
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.LOADOUT_HOME;
    else process.env.LOADOUT_HOME = originalHome;
    vi.unstubAllGlobals();
    await rm(home, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  });

  describe("remote registry digest cannot escape the cache", () => {
    function respondWithDigest(digest: string) {
      const body = JSON.stringify({
        schemaVersion: 1,
        descriptor: { name: "demo", version: "1.0.0" },
        digest,
        files: [],
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          status: 200,
          headers: new Headers(),
          arrayBuffer: async () => new TextEncoder().encode(body).buffer,
        })),
      );
    }

    it("refuses a traversing digest and leaves the victim untouched", async () => {
      const victim = join(work, "victim");
      await mkdir(victim, { recursive: true });
      await writeFile(join(victim, "keep.txt"), "important", "utf8");

      respondWithDigest(`../../../../../../../..${victim}`);

      await expect(
        fetchRemoteRegistryPackage("https://registry.example", "demo", "1.0.0"),
      ).rejects.toThrow(/digest/i);

      // The file must still be there: rejection has to happen before any delete.
      expect((await stat(join(victim, "keep.txt"))).isFile()).toBe(true);
    });

    it.each([
      ["not hex", "z".repeat(64)],
      ["too short", "a".repeat(63)],
      ["uppercase", "A".repeat(64)],
      ["empty", ""],
      ["dot segment", ".."],
    ])("rejects a %s digest", async (_label, digest) => {
      respondWithDigest(digest);
      await expect(
        fetchRemoteRegistryPackage("https://registry.example", "demo", "1.0.0"),
      ).rejects.toThrow(/digest/i);
    });
  });

  describe("safety scan fails closed on files it cannot read", () => {
    it("flags an oversized root file instead of reporting no findings", async () => {
      const big = join(work, "install.sh");
      await writeFile(big, Buffer.alloc(2_000_001, "#"), "utf8");

      const analysis = await analyzeUpdateSafety(undefined, big);
      expect(analysis.approvalRequired).toBe(true);
      expect(analysis.findings.map((f) => f.category)).toContain(
        "uninspectable",
      );
    });

    it("flags an oversized nested file", async () => {
      const pkg = join(work, "pkg");
      await mkdir(pkg, { recursive: true });
      await writeFile(join(pkg, "SKILL.md"), "# fine", "utf8");
      await writeFile(join(pkg, "payload.sh"), Buffer.alloc(2_000_001, "#"));

      const analysis = await analyzeUpdateSafety(undefined, pkg);
      expect(analysis.approvalRequired).toBe(true);
      const finding = analysis.findings.find(
        (f) => f.category === "uninspectable",
      );
      expect(finding).toBeDefined();
      expect(finding!.paths).toContain("payload.sh");
    });

    it("stays quiet when everything was inspectable", async () => {
      const pkg = join(work, "clean");
      await mkdir(pkg, { recursive: true });
      await writeFile(join(pkg, "SKILL.md"), "# clean skill", "utf8");

      const analysis = await analyzeUpdateSafety(undefined, pkg);
      expect(analysis.findings.map((f) => f.category)).not.toContain(
        "uninspectable",
      );
    });
  });
});

describe("bounded network and repository defaults", () => {
  it("applies a timeout, byte cap, and file cap without being asked", async () => {
    const { REPOSITORY_FETCH_DEFAULTS } =
      await import("../src/core/install/source.js");
    expect(REPOSITORY_FETCH_DEFAULTS.timeoutMs).toBeGreaterThan(0);
    expect(REPOSITORY_FETCH_DEFAULTS.maxBytes).toBeGreaterThan(0);
    expect(REPOSITORY_FETCH_DEFAULTS.maxFiles).toBeGreaterThan(0);
  });

  it("rejects a registry response larger than the cap", async () => {
    const home = await mkdtemp(join(tmpdir(), "loadout-reg-"));
    const previous = process.env.LOADOUT_HOME;
    process.env.LOADOUT_HOME = home;
    const huge = "x".repeat(33 * 1024 * 1024);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: async () => new TextEncoder().encode(`"${huge}"`).buffer,
      })),
    );
    const { fetchRemoteRegistryPackage: fetchPackage } =
      await import("../src/core/catalog/registry.js");
    await expect(
      fetchPackage("https://registry.example", "demo", "1.0.0"),
    ).rejects.toThrow(/size limit/i);
    if (previous === undefined) delete process.env.LOADOUT_HOME;
    else process.env.LOADOUT_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });

  it("rejects a malformed registry response instead of throwing raw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: async () => new TextEncoder().encode("{not json").buffer,
      })),
    );
    const { fetchRemoteRegistryPackage: fetchPackage } =
      await import("../src/core/catalog/registry.js");
    await expect(
      fetchPackage("https://registry.example", "demo", "1.0.0"),
    ).rejects.toThrow(/malformed JSON/i);
  });
});
