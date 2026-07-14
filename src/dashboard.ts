import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { detectAgents } from "./core/paths.js";
import { loadEffectiveCatalog, rankCatalog } from "./core/catalog.js";

const publicDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "dashboard");

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
