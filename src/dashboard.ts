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

const publicDirectory = process.env.LOADOUT_DASHBOARD_DIR ?? join(process.cwd(), "dashboard");

async function sendJson(response: ServerResponse, status: number, body: unknown): Promise<void> {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  try {
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
    if (!/^[a-z0-9._-]+$/i.test(asset)) {
      await sendJson(response, 404, { error: "Not found" });
      return;
    }
    const content = await readFile(join(publicDirectory, asset));
    const type = asset.endsWith(".css") ? "text/css; charset=utf-8" : asset.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8";
    response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    response.end(content);
  } catch (error) {
    await sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export function createDashboardServer() {
  return createServer((request, response) => { void route(request, response); });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.LOADOUT_PORT ?? 4173);
  const server = createDashboardServer();
  server.listen(port, "127.0.0.1", () => console.log(`Loadout dashboard: http://127.0.0.1:${port}`));
}
