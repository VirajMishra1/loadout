import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { startDaemon } from "../src/core/coordination/daemon.js";

let root: string;
let daemon: Awaited<ReturnType<typeof startDaemon>> | null = null;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loadout-daemon-security-"));
  // Port 0 lets the OS pick a free port, avoiding EACCES on Windows CI
  daemon = await startDaemon(root, 0);
});

afterEach(async () => {
  daemon?.close();
  daemon = null;
  await rm(root, { recursive: true, force: true });
});

function daemonUrl(path: string): string {
  if (!daemon) throw new Error("Daemon has not started");
  return `http://127.0.0.1:${daemon.port}${path}`;
}

function authHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  if (!daemon) throw new Error("Daemon has not started");
  return { Authorization: `Bearer ${daemon.token}`, ...extra };
}

function rawGet(
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  if (!daemon) throw new Error("Daemon has not started");
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: daemon!.port,
        path,
        method: "GET",
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("coordination daemon HTTP security", () => {
  it.each([
    ["missing", undefined],
    ["incorrect", "Bearer incorrect-token"],
  ])("rejects %s bearer authentication", async (_case, authorization) => {
    const headers = authorization
      ? { Authorization: authorization }
      : undefined;
    const res = await fetch(daemonUrl("/api/status"), { headers });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: {
        code: "unauthorized",
        message: "Bearer authentication required",
      },
    });
  });

  it("does not accept the daemon token in an API query parameter", async () => {
    const res = await fetch(daemonUrl(`/api/status?token=${daemon!.token}`));

    expect(res.status).toBe(401);
  });

  it("requires authentication before opening an SSE stream", async () => {
    const res = await fetch(daemonUrl("/api/subscribe"));

    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("rejects a non-loopback Host header", async () => {
    const res = await rawGet(
      "/api/status",
      authHeaders({ Host: "attacker.example" }),
    );

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toEqual({
      error: { code: "forbidden_host", message: "Host is not loopback" },
    });
  });

  it.each(["https://attacker.example", "same-origin-with-path"])(
    "rejects a hostile browser Origin: %s",
    async (origin) => {
      const sentOrigin =
        origin === "same-origin-with-path"
          ? `http://127.0.0.1:${daemon!.port}/unexpected-path`
          : origin;
      const res = await fetch(daemonUrl("/api/status"), {
        headers: authHeaders({ Origin: sentOrigin }),
      });

      expect(res.status).toBe(403);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      expect(await res.json()).toEqual({
        error: {
          code: "forbidden_origin",
          message: "Origin is not same-origin",
        },
      });
    },
  );

  it("uses explicit same-origin CORS instead of a wildcard", async () => {
    const origin = `http://127.0.0.1:${daemon!.port}`;
    const res = await fetch(daemonUrl("/api/status"), {
      headers: authHeaders({ Origin: origin }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
  });

  it("returns a structured 400 response for malformed JSON", async () => {
    const res = await fetch(daemonUrl("/api/ack"), {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: "{not-json",
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "invalid_json",
        message: "Request body must be valid JSON",
      },
    });
  });

  it("returns a structured 413 response for oversized bodies", async () => {
    const res = await fetch(daemonUrl("/api/ack"), {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ note: "x".repeat(1024 * 1024) }),
    });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: { code: "payload_too_large", message: "Request body too large" },
    });
  });

  it.each([
    ["/api/emit", { from: 42, type: "task", description: "invalid" }],
    ["/api/ack", { agent: "codex", seq: "zero" }],
  ])("returns 400 for schema-invalid JSON at %s", async (path, body) => {
    const res = await fetch(daemonUrl(path), {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "invalid_request",
        message: "Request validation failed",
      },
    });
  });

  it("rejects invalid cursor and agent query values", async () => {
    const invalidCursor = await fetch(daemonUrl("/api/events?after=nope"), {
      headers: authHeaders(),
    });
    const oversizedAgent = await fetch(
      daemonUrl(`/api/snapshot/${"a".repeat(129)}`),
      { headers: authHeaders() },
    );

    expect(invalidCursor.status).toBe(400);
    expect(oversizedAgent.status).toBe(400);
  });

  it("returns 409 for acknowledgement and contract revision conflicts", async () => {
    const firstEvent = await fetch(daemonUrl("/api/emit"), {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        from: "claude-code",
        type: "task",
        description: "seed",
      }),
    });
    expect(firstEvent.status).toBe(201);

    const futureAck = await fetch(daemonUrl("/api/ack"), {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ agent: "codex", seq: 99 }),
    });
    expect(futureAck.status).toBe(409);

    const contract = {
      from: "claude-code",
      type: "contract",
      description: "API contract",
      payload: { name: "api", revision: 1, body: "v1" },
    };
    const firstContract = await fetch(daemonUrl("/api/emit"), {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(contract),
    });
    expect(firstContract.status).toBe(201);
    const staleContract = await fetch(daemonUrl("/api/emit"), {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(contract),
    });
    expect(staleContract.status).toBe(409);
  });

  it("never exposes the absolute project root in browser-visible status", async () => {
    const res = await fetch(daemonUrl("/api/status"), {
      headers: authHeaders(),
    });
    const raw = await res.text();

    expect(res.status).toBe(200);
    expect(raw).not.toContain(root);
    expect(JSON.parse(raw)).not.toHaveProperty("projectRoot");
  });

  it("returns structured errors for missing routes", async () => {
    const res = await fetch(daemonUrl("/api/missing"), {
      headers: authHeaders(),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "not_found", message: "Not found" },
    });
  });
});
