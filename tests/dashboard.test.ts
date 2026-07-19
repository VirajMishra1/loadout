import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createSnapshot,
  recordSnapshotPostMutationState,
} from "../src/core/snapshot.js";
import {
  createDashboardServer,
  startDashboardServer,
} from "../src/dashboard.js";

describe("dashboard server", () => {
  it("serves real status/catalog endpoints and the shell", async () => {
    const server = createDashboardServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    const [
      html,
      status,
      health,
      profiles,
      recommendations,
      registry,
      catalog,
      catalogDetail,
      installed,
      progress,
      updates,
    ] = await Promise.all([
      fetch(`${base}/`),
      fetch(`${base}/api/status`),
      fetch(`${base}/api/health`),
      fetch(`${base}/api/profiles`),
      fetch(`${base}/api/recommendations`),
      fetch(`${base}/api/registry`),
      fetch(`${base}/api/catalog`),
      fetch(`${base}/api/catalog/superpowers`),
      fetch(`${base}/api/installed`),
      fetch(`${base}/api/progress`),
      fetch(`${base}/api/update`),
    ]);
    expect(html.status).toBe(200);
    expect(await html.text()).toContain("Health");
    expect(status.status).toBe(200);
    expect((await status.json()).agents).toBeInstanceOf(Array);
    expect(health.status).toBe(200);
    expect((await health.json()).health.status).toMatch(
      /healthy|attention|unhealthy/,
    );
    expect(profiles.status).toBe(200);
    expect((await profiles.json()).profiles.stable).toBeTruthy();
    expect(recommendations.status).toBe(200);
    const recommendationPayload = await recommendations.json();
    expect(recommendationPayload.recommendations).toBeInstanceOf(Array);
    expect(recommendationPayload.recommendationBoundary).toEqual({
      selectionMethod: "deterministic-project-signal-rules",
      qualityEvidence: "not-established",
    });
    expect(registry.status).toBe(200);
    expect((await registry.json()).packages).toBeInstanceOf(Array);
    expect(catalog.status).toBe(200);
    expect((await catalog.json()).packages).toBeInstanceOf(Array);
    expect(catalogDetail.status).toBe(200);
    expect((await catalogDetail.json()).package.id).toBe("superpowers");
    expect(installed.status).toBe(200);
    expect((await installed.json()).packages).toBeInstanceOf(Array);
    expect(progress.status).toBe(200);
    expect((await progress.json()).operation.status).toBe("idle");
    expect(updates.status).toBe(200);
    expect((await updates.json()).updates).toBeInstanceOf(Array);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }, 15_000);

  it("labels policy suggestions, evidence health, and profiles without empirical claims", async () => {
    const [app, html] = await Promise.all([
      readFile(join(process.cwd(), "dashboard", "app.js"), "utf8"),
      readFile(join(process.cwd(), "dashboard", "index.html"), "utf8"),
    ]);
    expect(app).toContain("Rule-based project suggestions");
    expect(app).toContain("Evidence coverage and managed-state hygiene");
    expect(app).toContain("policy profiles");
    expect(`${app}\n${html}`).not.toMatch(/tested setups|tested profiles/i);
  });

  it("requires a session token for apply and rollback mutations", async () => {
    let restored = "";
    const plan = {
      manifest: "loadout.json",
      packages: [],
      mcpPlans: [],
      skipped: [],
      policyViolations: [],
    };
    const server = createDashboardServer({
      buildSync: async () => plan,
      applySync: async () => ({
        snapshotId: "snap-123",
        lockfile: "loadout.lock",
      }),
      rollback: async (id) => {
        restored = id;
      },
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    const preview = await fetch(`${base}/api/plan`);
    expect(preview.status).toBe(200);
    expect((await preview.json()).plan.policyViolations).toEqual([]);
    const denied = await fetch(`${base}/api/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(denied.status).toBe(403);
    const token = (await (await fetch(`${base}/api/session`)).json()).token;
    const applied = await fetch(`${base}/api/apply`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-loadout-token": token },
      body: "{}",
    });
    expect(applied.status).toBe(200);
    expect((await applied.json()).result.snapshotId).toBe("snap-123");
    const progress = await fetch(`${base}/api/progress`);
    expect((await progress.json()).operation).toMatchObject({
      kind: "sync",
      status: "completed",
      snapshotId: "snap-123",
    });
    const rolledBack = await fetch(`${base}/api/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-loadout-token": token },
      body: JSON.stringify({ snapshotId: "snap-123" }),
    });
    expect(rolledBack.status).toBe(200);
    expect(restored).toBe("snap-123");
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("uses drift-safe rollback in the default dashboard route", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-dashboard-rollback-"));
    const previousHome = process.env.LOADOUT_HOME;
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const target = join(root, "managed.txt");
    await writeFile(target, "before");
    const safe = await createSnapshot([target]);
    await writeFile(target, "after");
    await recordSnapshotPostMutationState(safe);
    await writeFile(target, "user edit");
    const legacy = await createSnapshot([join(root, "legacy.txt")]);
    const server = createDashboardServer();
    try {
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("server did not bind");
      const base = `http://127.0.0.1:${address.port}`;
      const token = (await (await fetch(`${base}/api/session`)).json()).token;
      const rollback = (snapshotId: string) =>
        fetch(`${base}/api/rollback`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-loadout-token": token,
          },
          body: JSON.stringify({ snapshotId }),
        });

      const drifted = await rollback(safe.id);
      expect(drifted.status).toBe(500);
      expect((await drifted.json()).error).toMatch(/rollback refused/i);
      expect(await readFile(target, "utf8")).toBe("user edit");

      const old = await rollback(legacy.id);
      expect(old.status).toBe(500);
      expect((await old.json()).error).toMatch(/post-mutation evidence/i);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (previousHome === undefined) delete process.env.LOADOUT_HOME;
      else process.env.LOADOUT_HOME = previousHome;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps mutation endpoints loopback-only and same-origin", async () => {
    const plan = {
      manifest: "loadout.json",
      packages: [],
      mcpPlans: [],
      skipped: [],
      policyViolations: [],
    };
    const server = createDashboardServer({
      buildSync: async () => plan,
      applySync: async () => ({ lockfile: "loadout.lock" }),
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    const token = (await (await fetch(`${base}/api/session`)).json()).token;
    const crossOrigin = await fetch(`${base}/api/sync`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-loadout-token": token,
        origin: "https://example.com",
      },
      body: "{}",
    });
    expect(crossOrigin.status).toBe(403);
    const nonLoopbackStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        `${base}/api/status`,
        { headers: { host: "example.com" } },
        (response) => resolve(response.statusCode ?? 0),
      );
      request.once("error", reject);
      request.end();
    });
    expect(nonLoopbackStatus).toBe(403);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("starts on an OS-assigned loopback port by default", async () => {
    const dashboard = await startDashboardServer();
    expect(dashboard.host).toBe("127.0.0.1");
    expect(dashboard.port).toBeGreaterThan(0);
    const response = await fetch(
      `http://${dashboard.host}:${dashboard.port}/api/session`,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).token).toMatch(/^[a-f0-9]{64}$/);
    await dashboard.close();
  });

  it("ships keyboard-accessible dashboard controls and defensive UI states", async () => {
    const dashboardDirectory = join(process.cwd(), "dashboard");
    const [html, script, styles] = await Promise.all([
      readFile(join(dashboardDirectory, "index.html"), "utf8"),
      readFile(join(dashboardDirectory, "app.js"), "utf8"),
      readFile(join(dashboardDirectory, "styles.css"), "utf8"),
    ]);
    expect(html).toContain('href="#dashboard-content"');
    expect(html).toContain('data-route="discover"');
    expect(html).toContain('id="catalog-search"');
    expect(html.match(/id="installed"/g)).toHaveLength(1);
    expect(html).toContain('id="installed-list"');
    expect(html.match(/id="updates"/g)).toHaveLength(1);
    expect(html).toContain('id="updates-list"');
    expect(html).toContain('id="sync-acknowledgement"');
    expect(html).toContain('aria-labelledby="sync-heading"');
    expect(html).toContain('role="status"');
    expect(html).toContain('id="refresh-dashboard"');
    expect(script).toContain("Promise.allSettled");
    expect(script).toContain('load("/api/installed")');
    expect(script).toContain('window.addEventListener("hashchange", setRoute)');
    expect(script).toContain("syncAcknowledgement.checked");
    expect(script).toContain("Expected a local JSON response");
    expect(script).toContain("escapeHtml");
    expect(styles).toContain(".skip-link:focus");
    expect(styles).toContain("button:focus-visible");
    expect(styles).toContain(".dashboard-nav");
  });
});
