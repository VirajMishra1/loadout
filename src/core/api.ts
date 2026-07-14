import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { loadEffectiveCatalog, rankCatalog } from "./catalog.js";
import { detectAgents } from "./paths.js";
import { buildUpdatePlan } from "./update.js";
import { buildHealthReport } from "./health.js";

export interface ApiOptions {
  /** Defaults to loopback only. Port 0 asks the OS for an ephemeral port. */
  host?: string;
  port?: number;
  /** Dependency overrides keep the API deterministic and easy to test. */
  status?: () => Promise<unknown>;
  catalog?: () => Promise<unknown>;
  updates?: () => Promise<unknown>;
  health?: () => Promise<unknown>;
}

export interface ApiHandle {
  server: Server;
  host: string;
  port: number;
  close: () => Promise<void>;
}

function json(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
}

function success(data: unknown): unknown {
  return { ok: true, data };
}

function errorBody(code: string, message: string): unknown {
  return { ok: false, error: { code, message } };
}

function pathOf(request: IncomingMessage): string {
  try { return new URL(request.url ?? "/", "http://127.0.0.1").pathname; }
  catch { return "/"; }
}

export async function startApiServer(options: ApiOptions = {}): Promise<ApiHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const status = options.status ?? (async () => detectAgents());
  const catalog = options.catalog ?? (async () => rankCatalog(await loadEffectiveCatalog()));
  const updates = options.updates ?? (async () => buildUpdatePlan());
  const health = options.health ?? (async () => buildHealthReport());

  const server = createServer(async (request, response) => {
    if (request.method !== "GET") {
      json(response, 405, errorBody("METHOD_NOT_ALLOWED", "Only GET requests are supported."));
      return;
    }
    const path = pathOf(request);
    const handler = path === "/status" ? status : path === "/catalog" ? catalog : path === "/health" ? health : path === "/update" || path === "/updates" ? updates : undefined;
    if (!handler) {
      json(response, 404, errorBody("NOT_FOUND", "Endpoint not found."));
      return;
    }
    try {
      json(response, 200, success(await handler()));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      json(response, 500, errorBody("INTERNAL_ERROR", message));
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (cause: Error) => { server.off("listening", onListening); reject(cause); };
    const onListening = () => { server.off("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Could not determine API server address");
  }
  return {
    server,
    host,
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => server.close((cause) => cause ? reject(cause) : resolve())),
  };
}
