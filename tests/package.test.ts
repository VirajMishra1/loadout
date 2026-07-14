import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectPackage, formatPackageInspection } from "../src/core/package.js";

describe("package inspection", () => {
  it("returns normalized skills and MCP servers without secret values", async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "loadout-package-"));
    await mkdir(join(root, "skills", "docs"), { recursive: true });
    await writeFile(join(root, "skills", "docs", "SKILL.md"), "---\nname: docs\ndescription: Documentation helper\n---\n");
    await writeFile(join(root, "mcp.json"), JSON.stringify({ mcpServers: { context: { url: "https://example.test/mcp", env: { TOKEN: "secret" } } } }));
    const result = await inspectPackage(root);
    expect(result.counts).toEqual({ skills: 1, rules: 0, commands: 0, agents: 0, mcpServers: 1, manifests: 1 });
    expect(result.skills[0]).toMatchObject({ type: "skill", name: "docs", path: "skills/docs" });
    expect(result.mcpServers[0]).toMatchObject({ type: "mcp", name: "context", transport: "url", environmentVariableCount: 1 });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(formatPackageInspection(result)).toContain("Skills: 1");
  });
});
