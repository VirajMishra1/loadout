import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { detectAgents } from "./core/paths.js";
import { loadEffectiveCatalog, rankCatalog } from "./core/catalog.js";
import { buildUpdatePlan } from "./core/update.js";
import { buildHealthReport } from "./core/health.js";
import { recommendPackages, scanProject, TESTED_PROFILES } from "./core/recommend.js";
import { searchLocalRegistry } from "./core/registry.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { applySyncPlan, buildSyncPlan, type SyncPlan } from "./core/sync.js";
import { readSnapshot, restoreSnapshot } from "./core/snapshot.js";

const publicDirectory = process.env.LOADOUT_DASHBOARD_DIR ?? join(process.cwd(), "dashboard");

async function sendJson(response: ServerResponse, status: number, body: unknown): Promise<void> {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; frame-ancestors 'none'" });
  response.end(JSON.stringify(body));
}

export interface DashboardOptions {
  manifestPath?: string;
  lockPath?: string;
  buildSync?: (manifestPath: string) => Promise<SyncPlan>;
  applySync?: typeof applySyncPlan;
  rollback?: (snapshotId: string) => Promise<void>;
}

function safeSyncPlan(plan: SyncPlan): unknown {
  return { manifest: plan.manifest, packages: plan.packages.map((entry) => ({ packageId: entry.plan.packageId, targetAgents: entry.plan.targetAgents, files: entry.plan.files.map((file) => ({ target: file.target, componentType: file.componentType, compatibility: file.compatibility })), warnings: entry.plan.warnings, safety: entry.safety })), mcpChanges: plan.mcpPlans.map((entry) => ({ packageId: entry.packageId, path: entry.plan.path, changes: entry.plan.changes, warnings: entry.plan.warnings })), skipped: plan.skipped, policyViolations: plan.policyViolations };
}

function authorized(request: IncomingMessage, token: string): boolean {
  const provided = request.headers["x-loadout-token"];
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided); const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += value.length;
    if (size > 8_192) throw new Error("Request body is too large");
    chunks.push(value);
  }
  if (!chunks.length) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Request body must be a JSON object");
  return parsed as Record<string, unknown>;
}

async function route(request: IncomingMessage, response: ServerResponse, context: Required<DashboardOptions> & { token: string }): Promise<void> {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  try {
    const host = request.headers.host?.split(":")[0];
    if (host && host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]") { await sendJson(response, 403, { error: "Dashboard accepts loopback hosts only" }); return; }
    if (request.method === "POST" && request.headers.origin) {
      let sameOrigin = false; try { sameOrigin = new URL(request.headers.origin).host === request.headers.host; } catch { /* invalid origins are denied */ }
      if (!sameOrigin) { await sendJson(response, 403, { error: "Cross-origin dashboard mutation denied" }); return; }
    }
    if (pathname === "/api/session" && request.method === "GET") { await sendJson(response, 200, { token: context.token }); return; }
    if (pathname === "/api/sync-plan" && request.method === "GET") { await sendJson(response, 200, { plan: safeSyncPlan(await context.buildSync(context.manifestPath)) }); return; }
    if (pathname === "/api/sync" && request.method === "POST") {
      if (!authorized(request, context.token)) { await sendJson(response, 403, { error: "Invalid dashboard session" }); return; }
      const input = await body(request); const plan = await context.buildSync(context.manifestPath);
      const result = await context.applySync(plan, context.lockPath, { approveRisk: input.approveRisk === true });
      await sendJson(response, 200, { result }); return;
    }
    if (pathname === "/api/rollback" && request.method === "POST") {
      if (!authorized(request, context.token)) { await sendJson(response, 403, { error: "Invalid dashboard session" }); return; }
      const input = await body(request);
      if (typeof input.snapshotId !== "string" || !/^[A-Za-z0-9-]+$/.test(input.snapshotId)) throw new Error("A valid snapshotId is required");
      await context.rollback(input.snapshotId); await sendJson(response, 200, { restored: input.snapshotId }); return;
    }
    if (pathname.startsWith("/api/") && request.method !== "GET") { await sendJson(response, 405, { error: "Method not allowed" }); return; }
    if (pathname === "/api/status") {
      const agents = await detectAgents();
      await sendJson(response, 200, { agents, platform: process.platform });
      return;
    }
    if (pathname === "/api/catalog") {
      const catalog = rankCatalog(await loadEffectiveCatalog());
      await sendJson(response, 200, { packages: catalog });
      return;
    }
    if (pathname === "/api/health") {
      await sendJson(response, 200, { health: await buildHealthReport() });
      return;
    }
    if (pathname === "/api/profiles") {
      await sendJson(response, 200, { profiles: TESTED_PROFILES });
      return;
    }
    if (pathname === "/api/recommendations") {
      const signals = await scanProject(process.cwd());
      await sendJson(response, 200, { signals, recommendations: recommendPackages(signals, await loadEffectiveCatalog()) });
      return;
    }
    if (pathname === "/api/registry") {
      await sendJson(response, 200, { packages: await searchLocalRegistry() });
      return;
    }
    if (pathname === "/api/update" || pathname === "/api/updates") {
      const updates = await buildUpdatePlan();
      await sendJson(response, 200, { updates });
      return;
    }
    const asset = pathname === "/" ? "index.html" : pathname.slice(1);
    if (request.method !== "GET") { await sendJson(response, 405, { error: "Method not allowed" }); return; }
    if (!/^[a-z0-9._-]+$/i.test(asset)) {
      await sendJson(response, 404, { error: "Not found" });
      return;
    }
    const content = await readFile(join(publicDirectory, asset));
    const type = asset.endsWith(".css") ? "text/css; charset=utf-8" : asset.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8";
    response.writeHead(200, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "x-frame-options": "DENY", "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
    response.end(content);
  } catch (error) {
    await sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export function createDashboardServer(options: DashboardOptions = {}) {
  const context: Required<DashboardOptions> & { token: string } = {
    manifestPath: options.manifestPath ?? join(process.cwd(), "loadout.json"),
    lockPath: options.lockPath ?? join(process.cwd(), "loadout.lock"),
    buildSync: options.buildSync ?? buildSyncPlan,
    applySync: options.applySync ?? applySyncPlan,
    rollback: options.rollback ?? (async (snapshotId) => restoreSnapshot(await readSnapshot(snapshotId))),
    token: randomBytes(32).toString("hex"),
  };
  return createServer((request, response) => { void route(request, response, context); });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.LOADOUT_PORT ?? 4173);
  const server = createDashboardServer();
  server.listen(port, "127.0.0.1", () => console.log(`Loadout dashboard: http://127.0.0.1:${port}`));
}
