import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { createDashboardServer } from "../src/dashboard.js";

describe("dashboard server", () => {
  it("serves real status/catalog endpoints and the shell", async () => {
    const server = createDashboardServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    const [html, status, health, profiles, recommendations, registry, catalog, updates] = await Promise.all([fetch(`${base}/`), fetch(`${base}/api/status`), fetch(`${base}/api/health`), fetch(`${base}/api/profiles`), fetch(`${base}/api/recommendations`), fetch(`${base}/api/registry`), fetch(`${base}/api/catalog`), fetch(`${base}/api/update`)]);
    expect(html.status).toBe(200);
    expect(await html.text()).toContain("Health");
    expect(status.status).toBe(200);
    expect((await status.json()).agents).toBeInstanceOf(Array);
    expect(health.status).toBe(200);
    expect((await health.json()).health.status).toMatch(/healthy|attention|unhealthy/);
    expect(profiles.status).toBe(200);
    expect((await profiles.json()).profiles.stable).toBeTruthy();
    expect(recommendations.status).toBe(200);
    expect((await recommendations.json()).recommendations).toBeInstanceOf(Array);
    expect(registry.status).toBe(200);
    expect((await registry.json()).packages).toBeInstanceOf(Array);
    expect(catalog.status).toBe(200);
    expect((await catalog.json()).packages).toBeInstanceOf(Array);
    expect(updates.status).toBe(200);
    expect((await updates.json()).updates).toBeInstanceOf(Array);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("requires a session token for apply and rollback mutations", async () => {
    let restored = "";
    const plan = { manifest: "loadout.json", packages: [], mcpPlans: [], skipped: [], policyViolations: [] };
    const server = createDashboardServer({ buildSync: async () => plan, applySync: async () => ({ snapshotId: "snap-123", lockfile: "loadout.lock" }), rollback: async (id) => { restored = id; } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    const preview = await fetch(`${base}/api/sync-plan`); expect(preview.status).toBe(200); expect((await preview.json()).plan.policyViolations).toEqual([]);
    const denied = await fetch(`${base}/api/sync`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); expect(denied.status).toBe(403);
    const token = (await (await fetch(`${base}/api/session`)).json()).token;
    const applied = await fetch(`${base}/api/sync`, { method: "POST", headers: { "content-type": "application/json", "x-loadout-token": token }, body: "{}" }); expect(applied.status).toBe(200); expect((await applied.json()).result.snapshotId).toBe("snap-123");
    const rolledBack = await fetch(`${base}/api/rollback`, { method: "POST", headers: { "content-type": "application/json", "x-loadout-token": token }, body: JSON.stringify({ snapshotId: "snap-123" }) }); expect(rolledBack.status).toBe(200); expect(restored).toBe("snap-123");
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("keeps mutation endpoints loopback-only and same-origin", async () => {
    const plan = { manifest: "loadout.json", packages: [], mcpPlans: [], skipped: [], policyViolations: [] };
    const server = createDashboardServer({ buildSync: async () => plan, applySync: async () => ({ lockfile: "loadout.lock" }) });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    const token = (await (await fetch(`${base}/api/session`)).json()).token;
    const crossOrigin = await fetch(`${base}/api/sync`, { method: "POST", headers: { "content-type": "application/json", "x-loadout-token": token, origin: "https://example.com" }, body: "{}" });
    expect(crossOrigin.status).toBe(403);
    const nonLoopbackStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${base}/api/status`, { headers: { host: "example.com" } }, (response) => resolve(response.statusCode ?? 0));
      request.once("error", reject);
      request.end();
    });
    expect(nonLoopbackStatus).toBe(403);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("ships keyboard-accessible dashboard controls and defensive UI states", async () => {
    const dashboardDirectory = join(process.cwd(), "dashboard");
    const [html, script, styles] = await Promise.all([
      readFile(join(dashboardDirectory, "index.html"), "utf8"),
      readFile(join(dashboardDirectory, "app.js"), "utf8"),
      readFile(join(dashboardDirectory, "styles.css"), "utf8"),
    ]);
    expect(html).toContain('href="#dashboard-content"');
    expect(html).toContain('id="sync-acknowledgement"');
    expect(html).toContain('aria-labelledby="sync-heading"');
    expect(html).toContain('role="status"');
    expect(html).toContain('id="refresh-dashboard"');
    expect(script).toContain("Promise.allSettled");
    expect(script).toContain("syncAcknowledgement.checked");
    expect(script).toContain("Expected a local JSON response");
    expect(script).toContain("escapeHtml");
    expect(styles).toContain(".skip-link:focus");
    expect(styles).toContain("button:focus-visible");
  });
});
