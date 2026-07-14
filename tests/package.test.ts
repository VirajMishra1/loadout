import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectPackage, formatPackageInspection } from "../src/core/package.js";

describe("package inspection", () => {
  it("returns normalized skills and MCP servers without secret values", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-package-"));
    await mkdir(join(root, "skills", "docs"), { recursive: true });
    await writeFile(join(root, "skills", "docs", "SKILL.md"), "---\nname: docs\ndescription: Documentation helper\n---\n");
    await mkdir(join(root, "plugin", ".claude-plugin"), { recursive: true });
    await writeFile(join(root, "plugin", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "docs-plugin", version: "1.2.0", description: "Docs helpers", commands: ["commands/docs.md"], skills: ["skills/docs"], hooks: { SessionStart: [] }, mcpServers: { context: {} } }));
    await mkdir(join(root, "codex-plugin", ".codex-plugin"), { recursive: true });
    await writeFile(join(root, "codex-plugin", ".codex-plugin", "plugin.json"), JSON.stringify({ name: "codex-plugin", version: "0.1.0", agents: ["agents/reviewer.md"] }));
    await writeFile(join(root, "mcp.json"), JSON.stringify({ mcpServers: { context: { url: "https://example.test/mcp", env: { TOKEN: "secret" } } } }));
    const result = await inspectPackage(root);
    expect(result.counts).toEqual({ skills: 1, rules: 0, commands: 0, agents: 0, plugins: 2, mcpServers: 1, manifests: 1 });
    expect(result.skills[0]).toMatchObject({ type: "skill", name: "docs", path: "skills/docs" });
    expect(result.mcpServers[0]).toMatchObject({ type: "mcp", name: "context", transport: "url", environmentVariableCount: 1 });
    expect(result.plugins.find((plugin) => plugin.name === "docs-plugin")).toMatchObject({ type: "plugin", name: "docs-plugin", version: "1.2.0", components: ["command", "mcp", "skill"], hookEvents: ["SessionStart"], mcpServers: ["context"] });
    expect(result.plugins.find((plugin) => plugin.name === "codex-plugin")).toMatchObject({ components: ["agent"] });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(formatPackageInspection(result)).toContain("Skills: 1");
  });
});
