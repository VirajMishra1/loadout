import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  discoverMcpManifests,
  parseMcpManifest,
  summarizeMcpManifest,
} from "../src/core/mcp.js";

describe("MCP manifest discovery", () => {
  it("normalizes mcpServers and never exposes env values in summaries", () => {
    const manifest = parseMcpManifest(
      {
        mcpServers: {
          docs: {
            command: "npx",
            args: ["-y", "server"],
            env: { TOKEN: "secret" },
          },
          remote: { url: "https://example.test/mcp" },
        },
      },
      "/tmp/mcp.json",
    );
    expect(manifest.servers[0]).toMatchObject({
      name: "docs",
      command: "npx",
      args: ["-y", "server"],
      env: { TOKEN: "secret" },
    });
    expect(summarizeMcpManifest(manifest)).not.toContain("secret");
    expect(summarizeMcpManifest(manifest)).toContain("2 MCP server(s)");
  });

  it("finds supported manifests recursively and reports malformed JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-mcp-"));
    await mkdir(join(root, "nested"));
    await writeFile(
      join(root, "nested", ".mcp.json"),
      JSON.stringify({ servers: { local: { command: "node" } } }),
    );
    await writeFile(join(root, "claude_desktop_config.json"), "{bad");
    const manifests = await discoverMcpManifests(root);
    expect(manifests).toHaveLength(2);
    expect(
      manifests.find((entry) => entry.servers.length === 1)?.servers[0].name,
    ).toBe("local");
    expect(
      manifests.find((entry) => entry.warnings.length > 0)?.warnings[0],
    ).toContain("invalid JSON");
  });
});
