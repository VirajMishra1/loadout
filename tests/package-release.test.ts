import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("npm release contract", () => {
  it("publishes the available package name with the Loadout executable and runtime assets", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      name?: string;
      private?: boolean;
      bin?: Record<string, string>;
      files?: string[];
      scripts?: Record<string, string>;
    };

    expect(manifest.name).toBe("loadout-ai");
    expect(manifest.private).toBe(false);
    expect(manifest.bin).toEqual({ loadout: "dist/src/cli.js" });
    expect(manifest.files).toEqual(
      expect.arrayContaining(["dist/src", "dashboard", "catalog"]),
    );
    expect(manifest.files).not.toContain("tests");
    expect(manifest.scripts?.prepack).toBe("npm run build");
  });
});
