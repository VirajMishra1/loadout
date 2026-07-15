import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRegistryBundle,
  importRegistryBundle,
  publishLocalPackage,
  resolveRegistryPackage,
  type RegistryBundle,
} from "./registry.js";

export interface RegistryServerHandle {
  server: Server;
  host: string;
  port: number;
  close(): Promise<void>;
}

function send(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function tokenMatches(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

async function requestJson(request: IncomingMessage): Promise<RegistryBundle> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 35_000_000) throw new Error("Request exceeds registry limit");
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as RegistryBundle;
}

export async function startRegistryServer(
  options: { host?: string; port?: number; token?: string } = {},
): Promise<RegistryServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const token = options.token ?? randomBytes(32).toString("hex");
  if (host !== "127.0.0.1" && host !== "::1" && !options.token)
    throw new Error("A publish token is required when binding beyond loopback");
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://registry.local");
      const match = url.pathname.match(
        /^\/v1\/packages\/([a-z0-9][a-z0-9._-]*)\/([^/]+)$/,
      );
      if (request.method === "GET" && match) {
        const resolved = await resolveRegistryPackage(
          match[1],
          decodeURIComponent(match[2]),
        );
        send(response, 200, await createRegistryBundle(resolved.path));
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/packages") {
        if (!tokenMatches(request, token)) {
          request.resume();
          await new Promise<void>((resolve) => request.once("end", resolve));
          send(response, 401, { error: "Invalid registry token" });
          return;
        }
        const temporary = await mkdtemp(
          join(tmpdir(), "loadout-registry-upload-"),
        );
        try {
          const packed = await importRegistryBundle(
            await requestJson(request),
            join(temporary, "package"),
          );
          const published = await publishLocalPackage(packed.root, {
            approveRisk: request.headers["x-loadout-approve-risk"] === "true",
          });
          send(response, 201, {
            name: published.descriptor.name,
            version: published.descriptor.version,
            digest: published.digest,
          });
        } finally {
          await rm(temporary, { recursive: true, force: true });
        }
        return;
      }
      send(response, 404, { error: "Not found" });
    } catch (error) {
      send(response, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not determine registry address");
  return {
    server,
    host,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
