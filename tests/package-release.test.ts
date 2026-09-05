import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("npm release contract", () => {
  it("publishes the available package name with the Loadout executable and runtime assets", async () => {
    const [manifestText, lockfileText] = await Promise.all([
      readFile(new URL("../package.json", import.meta.url), "utf8"),
      readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
    ]);
    const manifest = JSON.parse(manifestText) as {
      name?: string;
      private?: boolean;
      bin?: Record<string, string>;
      files?: string[];
      scripts?: Record<string, string>;
      license?: string;
      version?: string;
      description?: string;
      keywords?: string[];
    };
    const lockfile = JSON.parse(lockfileText) as {
      version?: string;
      packages?: { ""?: { version?: string } };
    };

    expect(manifest.name).toBe("loadout-ai");
    expect(manifest.version).toBe("0.9.1");
    expect(lockfile.version).toBe(manifest.version);
    expect(lockfile.packages?.[""]?.version).toBe(manifest.version);
    expect(manifest.private).toBe(false);
    expect(manifest.license).toBe("MIT");
    expect(manifest.bin).toEqual({ loadout: "dist/src/cli.js" });
    expect(manifest.files).toEqual(
      expect.arrayContaining(["dist/src", "catalog"]),
    );
    expect(manifest.files).not.toContain("dashboard");
    expect(manifest.files).not.toContain("tests");
    expect(manifest.scripts?.prepack).toBe("npm run build");
    expect(manifest.scripts?.prebuild).toBe("npm run clean");
    expect(manifest.scripts?.clean).toBe("node scripts/clean-dist.mjs");
    expect(manifest.scripts?.["test:package"]).toBe(
      "node scripts/package-smoke.mjs",
    );
    expect(manifest.scripts?.["verify:full"]).toMatch(/test:coverage/);
    expect(manifest.description).toBe(
      "The package manager for AI coding agent extensions",
    );
    expect(manifest.keywords).toEqual(
      expect.arrayContaining([
        "agent-skills",
        "ai-coding",
        "cursor",
        "gemini-cli",
        "developer-tools",
        "model-context-protocol",
      ]),
    );
  });

  it("runs the full coverage gate before publishing with provenance", async () => {
    const workflow = await readFile(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8",
    );
    expect(workflow).toContain("npm run verify:full");
    expect(workflow).not.toMatch(/run: npm run verify\s*$/m);
    expect(workflow).toContain("npm publish --access public --provenance");
  });

  it("keeps current release instructions on the candidate version and full gate", async () => {
    const currentGuides = await Promise.all(
      [
        "../README.md",
        "../docs/DEMO_SCRIPT.md",
        "../docs/USER_TEST_GUIDE.md",
        "../docs/TESTING.md",
        "../docs/RELEASE_REVIEW.md",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );
    const joinedGuides = currentGuides.join("\n");

    expect(joinedGuides).not.toMatch(/loadout-ai@(?:0\.5\.9|0\.8\.0)/);
    expect(joinedGuides).not.toContain("verify:full` is retained as an alias");
    expect(joinedGuides).not.toContain(
      "verify:full` is an alias for the same CLI release gate",
    );
    expect(joinedGuides).toContain("loadout-ai@0.9.0");
    expect(joinedGuides).toContain("npm run verify:full");
  });
});
