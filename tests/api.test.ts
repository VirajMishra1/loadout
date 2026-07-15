import { afterEach, describe, expect, it } from "vitest";
import { startApiServer, type ApiHandle } from "../src/core/api.js";

let handle: ApiHandle | undefined;
afterEach(async () => { if (handle) await handle.close(); handle = undefined; });

async function get(path: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`http://${handle!.host}:${handle!.port}${path}`);
  return { status: response.status, body: await response.json() };
}

describe("local API", () => {
  it("serves read-only endpoints on an ephemeral loopback port", async () => {
    handle = await startApiServer({
      port: 0,
      status: async () => [{ id: "codex", installed: true }],
      catalog: async () => [{ id: "pkg", tier: "stable" }],
      updates: async () => [{ packageId: "pkg", status: "up-to-date" }],
    });
    expect(handle.host).toBe("127.0.0.1");
    expect(handle.port).toBeGreaterThan(0);
    expect((await get("/status")).body).toEqual({ ok: true, data: [{ id: "codex", installed: true }] });
    expect((await get("/catalog")).body.ok).toBe(true);
    expect((await get("/update")).body.ok).toBe(true);
  });

  it("returns structured errors for unknown paths, methods, and handler failures", async () => {
    handle = await startApiServer({ port: 0, status: async () => { throw new Error("state unavailable"); } });
    expect((await get("/missing")).body).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "Endpoint not found." } });
    expect((await get("/status")).body).toEqual({ ok: false, error: { code: "INTERNAL_ERROR", message: "state unavailable" } });
    const response = await fetch(`http://${handle.host}:${handle.port}/status`, { method: "POST" });
    expect(response.status).toBe(405);
    expect((await response.json()).error.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("refuses non-loopback bindings", async () => {
    await expect(startApiServer({ host: "0.0.0.0", port: 0 })).rejects.toThrow(/loopback-only/);
  });
});
