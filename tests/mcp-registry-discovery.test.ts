import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverOfficialMcpRegistry } from "../src/core/mcp-registry-discovery.js";

const observedAt = new Date("2026-07-16T12:00:00.000Z");

function server(
  name: string,
  version: string,
  overrides: {
    description?: string;
    updatedAt?: string;
    isLatest?: boolean;
    repository?: unknown;
    packages?: unknown;
    remotes?: unknown;
    status?: string;
  } = {},
) {
  return {
    server: {
      $schema:
        "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
      name,
      description: overrides.description ?? "A useful MCP server",
      title: "Useful server",
      version,
      repository:
        overrides.repository === undefined
          ? {
              url: "https://github.com/acme/useful-mcp",
              source: "github",
              id: "12345",
              subfolder: "packages/server",
            }
          : overrides.repository,
      packages:
        overrides.packages === undefined
          ? [
              {
                registryType: "npm",
                identifier: "@acme/useful-mcp",
                version,
                fileSha256: "a".repeat(64),
                transport: { type: "stdio" },
              },
            ]
          : overrides.packages,
      remotes:
        overrides.remotes === undefined
          ? [
              {
                type: "streamable-http",
                url: "https://mcp.acme.example/server",
              },
            ]
          : overrides.remotes,
    },
    _meta: {
      "io.modelcontextprotocol.registry/official": {
        status: overrides.status ?? "active",
        publishedAt: "2026-07-01T00:00:00Z",
        updatedAt: overrides.updatedAt ?? "2026-07-10T00:00:00Z",
        statusChangedAt: "2026-07-01T00:00:00Z",
        isLatest: overrides.isLatest ?? true,
      },
    },
  };
}

function page(servers: unknown[], nextCursor?: string) {
  return new Response(
    JSON.stringify({
      servers,
      metadata: {
        count: servers.length,
        ...(nextCursor ? { nextCursor } : {}),
      },
    }),
    { headers: { "content-type": "application/json" } },
  );
}

describe("Official MCP Registry discovery connector", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  it("uses v0.1 cursor pagination and preserves distribution and verification evidence", async () => {
    const requested: URL[] = [];
    const first = server("io.github.acme/useful", "1.0.0");
    const newerDuplicate = server("io.github.acme/useful", "1.0.0", {
      description: "A useful MCP server, revised",
      updatedAt: "2026-07-11T00:00:00Z",
    });
    const second = server("com.example/other", "2.0.0", {
      repository: undefined,
      packages: [],
      remotes: [{ type: "sse", url: "https://mcp.example.com/sse" }],
    });
    // Explicitly remove the default repository for this fixture.
    delete (second.server as { repository?: unknown }).repository;

    const result = await discoverOfficialMcpRegistry({
      pageSize: 2,
      maxPages: 4,
      cachePath: false,
      now: observedAt,
      fetcher: async (input) => {
        const url = new URL(String(input));
        requested.push(url);
        return url.searchParams.has("cursor")
          ? page([second])
          : page([first, newerDuplicate], "opaque/name:1.0.0");
      },
    });

    expect(requested).toHaveLength(2);
    expect(requested[0].pathname).toBe("/v0.1/servers");
    expect(requested[0].searchParams.get("version")).toBe("latest");
    expect(requested[1].searchParams.get("cursor")).toBe("opaque/name:1.0.0");
    expect(result.status).toBe("partial");
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      identityKey: "mcp-registry:io.github.acme/useful@1.0.0",
      namespace: "io.github.acme",
      description: "A useful MCP server, revised",
      repositoryKey: "github:acme/useful-mcp",
      repository: {
        repository: "acme/useful-mcp",
        id: "12345",
        subfolder: "packages/server",
      },
      verification: {
        lifecycleStatus: "active",
        isLatest: true,
      },
    });
    expect(result.records[0].distributions).toEqual([
      {
        kind: "package",
        type: "npm",
        identifier: "@acme/useful-mcp",
        version: "1.0.0",
        integritySha256: "a".repeat(64),
        transport: "stdio",
      },
      {
        kind: "remote",
        type: "streamable-http",
        identifier: "https://mcp.acme.example/server",
        transport: "streamable-http",
      },
    ]);
    expect(result.records[0].verification.meaning).toMatch(/identity/);
    expect(JSON.stringify(result.records[0])).not.toContain("ranking");
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "duplicate-record" }),
    ]);
  });

  it("detects cursor replay and returns only bounded partial evidence", async () => {
    let calls = 0;
    const result = await discoverOfficialMcpRegistry({
      pageSize: 1,
      maxPages: 5,
      cachePath: false,
      now: observedAt,
      fetcher: async () => {
        calls++;
        return page([server(`com.example/server-${calls}`, "1.0.0")], "same");
      },
    });
    expect(calls).toBe(2);
    expect(result.status).toBe("partial");
    expect(result.records).toHaveLength(2);
    expect(result.next).toBe("same");
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "pagination-replay" }),
    ]);
  });

  it("retains the first page when a later request is rate limited", async () => {
    const result = await discoverOfficialMcpRegistry({
      pageSize: 1,
      cachePath: false,
      now: observedAt,
      fetcher: async (input) =>
        new URL(String(input)).searchParams.has("cursor")
          ? new Response("limited", {
              status: 429,
              headers: { "retry-after": "30" },
            })
          : page([server("com.example/one", "1.0.0")], "next"),
    });
    expect(result.status).toBe("partial");
    expect(result.records).toHaveLength(1);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "rate-limited",
        retryAfterSeconds: 30,
        page: 1,
      }),
    ]);
  });

  it("skips malformed records without discarding valid identity evidence", async () => {
    const result = await discoverOfficialMcpRegistry({
      pageSize: 2,
      cachePath: false,
      now: observedAt,
      fetcher: async () =>
        page([
          server("com.example/valid", "1.0.0"),
          server("invalid-name", "latest", {
            description: "x".repeat(101),
          }),
        ]),
    });
    expect(result.status).toBe("partial");
    expect(result.records.map((record) => record.name)).toEqual([
      "com.example/valid",
    ]);
    expect(result.issues[0].code).toBe("invalid-record");
  });

  it("uses a complete cache when the official registry is offline", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-mcp-registry-cache-"));
    const cachePath = join(root, "registry.json");
    const live = await discoverOfficialMcpRegistry({
      pageSize: 1,
      cachePath,
      now: observedAt,
      fetcher: async () => page([server("com.example/one", "1.0.0")]),
    });
    expect(live.status).toBe("complete");

    const cached = await discoverOfficialMcpRegistry({
      pageSize: 1,
      cachePath,
      now: new Date("2026-07-17T12:00:00Z"),
      fetcher: async () => {
        throw new Error("offline");
      },
    });
    expect(cached.status).toBe("cached");
    expect(cached.records[0].name).toBe("com.example/one");
    expect(cached.cache).toEqual({
      path: cachePath,
      cachedAt: observedAt.toISOString(),
    });
    expect(cached.issues[0].code).toBe("request-failed");
  });

  it("validates user filters before network access", async () => {
    let calls = 0;
    await expect(
      discoverOfficialMcpRegistry({
        search: "x",
        fetcher: async () => {
          calls++;
          return page([]);
        },
      }),
    ).rejects.toThrow(/2-200/);
    await expect(
      discoverOfficialMcpRegistry({ updatedSince: "yesterday" }),
    ).rejects.toThrow(/RFC3339/);
    expect(calls).toBe(0);
  });

  it("reports a record cap as partial without exposing a lossy cursor", async () => {
    const result = await discoverOfficialMcpRegistry({
      pageSize: 2,
      maxRecords: 1,
      cachePath: false,
      now: observedAt,
      fetcher: async () =>
        page([
          server("com.example/one", "1.0.0"),
          server("com.example/two", "1.0.0"),
        ]),
    });
    expect(result.status).toBe("partial");
    expect(result.records).toHaveLength(1);
    expect(result.next).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "pagination-limit" }),
    ]);
  });
});
