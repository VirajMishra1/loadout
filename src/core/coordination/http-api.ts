import type { IncomingMessage, ServerResponse } from "node:http";
import { isLoopbackHostname } from "./auth.js";

export const MAX_BODY_BYTES = 1024 * 1024;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function parseAuthority(value: string): URL | null {
  try {
    return new URL(`http://${value}`);
  } catch {
    return null;
  }
}

export function validateRequestSource(req: IncomingMessage): void {
  const host = req.headers.host;
  const hostUrl = host ? parseAuthority(host) : null;
  if (!hostUrl || !isLoopbackHostname(hostUrl.hostname)) {
    throw new HttpError(403, "forbidden_host", "Host is not loopback");
  }

  const origin = req.headers.origin;
  if (!origin) return;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new HttpError(403, "forbidden_origin", "Origin is not same-origin");
  }

  if (
    !isLoopbackHostname(originUrl.hostname) ||
    originUrl.host.toLowerCase() !== hostUrl.host.toLowerCase() ||
    originUrl.protocol !== "http:" ||
    originUrl.origin !== origin
  ) {
    throw new HttpError(403, "forbidden_origin", "Origin is not same-origin");
  }
}

function matchingOrigin(req: IncomingMessage): string | undefined {
  const host = req.headers.host;
  const origin = req.headers.origin;
  const hostUrl = host ? parseAuthority(host) : null;
  if (!hostUrl || !origin) return undefined;

  try {
    const originUrl = new URL(origin);
    return originUrl.protocol === "http:" &&
      isLoopbackHostname(originUrl.hostname) &&
      originUrl.host.toLowerCase() === hostUrl.host.toLowerCase() &&
      originUrl.origin === origin
      ? origin
      : undefined;
  } catch {
    return undefined;
  }
}

export function setResponseHeaders(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const origin = matchingOrigin(req);
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type",
    );
  }
}

export function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  data: unknown,
  status = 200,
): void {
  setResponseHeaders(req, res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

export function sendError(
  req: IncomingMessage,
  res: ServerResponse,
  code: string,
  message: string,
  status: number,
): void {
  sendJson(req, res, { error: { code, message } }, status);
}

export function setEventStreamHeaders(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  setResponseHeaders(req, res);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const contentLength = Number(req.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "payload_too_large", "Request body too large");
  }

  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
    } else if (!tooLarge) {
      chunks.push(buffer);
    }
  }

  if (tooLarge) {
    throw new HttpError(413, "payload_too_large", "Request body too large");
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8")) as T;
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON");
  }
}
