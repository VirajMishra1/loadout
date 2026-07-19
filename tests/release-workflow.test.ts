import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("npm release workflow", () => {
  it("keeps the verified provenance publishing contract", async () => {
    const workflow = await readFile(".github/workflows/release.yml", "utf8");

    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("node-version: 24");
    expect(workflow).toContain("package-manager-cache: false");
    expect(workflow).toContain("npm@11.5.1");
    expect(workflow).toContain("npm run verify");
    expect(workflow).toContain(
      `test "\${GITHUB_REF_NAME}" = "v$(node -p "require('./package.json').version")"`,
    );
    expect(workflow).toContain("npm publish --access public --provenance");
  });

  it("pins third-party actions to immutable commits with version comments", async () => {
    const workflow = await readFile(".github/workflows/release.yml", "utf8");

    expect(workflow).toMatch(/actions\/checkout@[0-9a-f]{40}\s+# v5/);
    expect(workflow).toMatch(/actions\/setup-node@[0-9a-f]{40}\s+# v6/);
    expect(workflow).not.toMatch(/uses:\s+[^\s@]+@v\d+(?:\s|$)/m);
  });
});
