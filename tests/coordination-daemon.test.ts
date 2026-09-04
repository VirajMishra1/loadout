import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { emit } from "../src/core/coordination/coordinator.js";
import { startDaemon } from "../src/core/coordination/daemon.js";

let root: string;
let daemon: {
  port: number;
  token: string;
  dashboardUrl: string;
  close: () => void;
} | null = null;

// Use a random high port to avoid conflicts
function randomPort(): number {
  return 10000 + Math.floor(Math.random() * 50000);
}

async function startAuthenticatedDaemon(): Promise<NonNullable<typeof daemon>> {
  daemon = await startDaemon(root, randomPort());
  return daemon;
}

function authorization(token = daemon?.token): Record<string, string> {
  return { Authorization: `Bearer ${token ?? ""}` };
}

async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!daemon) throw new Error("Daemon has not started");
  return fetch(`http://127.0.0.1:${daemon.port}${path}`, {
    ...init,
    headers: {
      ...authorization(),
      ...init.headers,
    },
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loadout-daemon-"));
});

afterEach(async () => {
  daemon?.close();
  daemon = null;
  await rm(root, { recursive: true, force: true });
});

describe("coordination daemon", () => {
  it("starts and responds to /api/status", async () => {
    await startAuthenticatedDaemon();

    const res = await apiFetch("/api/status");
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      daemon: string;
      connectedClients: number;
    };
    expect(data.daemon).toBe("running");
    expect(data).not.toHaveProperty("projectRoot");
    expect(data.connectedClients).toBe(0);
  });

  it("creates a persistent 32-byte daemon token readable only by the user", async () => {
    const running = await startAuthenticatedDaemon();

    expect(running.token).toMatch(/^[a-f0-9]{64}$/);
    const tokenStat = await stat(join(root, ".handoff", "daemon.token"));
    expect(tokenStat.mode & 0o777).toBe(0o600);
  });

  it("serves the dashboard at /", async () => {
    const running = await startAuthenticatedDaemon();

    const res = await fetch(`http://127.0.0.1:${running.port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const html = await res.text();
    expect(html).toContain("Loadout Coordination");
  });

  it("keeps dashboard credentials out of request URLs", async () => {
    const running = await startAuthenticatedDaemon();

    expect(running.dashboardUrl).toBe(
      `http://127.0.0.1:${running.port}/#token=${running.token}`,
    );
    const res = await fetch(`http://127.0.0.1:${running.port}/`);
    const html = await res.text();
    expect(html).toContain("sessionStorage");
    expect(html).toContain("Authorization: 'Bearer ' + daemonToken");
    expect(html).not.toContain("new EventSource");
  });

  it("returns contracts via /api/contracts", async () => {
    // Seed a contract
    await emit(root, {
      from: "claude-code",
      to: "*",
      type: "contract",
      description: "Auth API v1",
      payload: { name: "auth-api", revision: 1, body: "types here" },
    });

    await startAuthenticatedDaemon();

    const res = await apiFetch("/api/contracts");
    const contracts = (await res.json()) as Array<{
      name: string;
      revision: number;
    }>;
    expect(contracts).toHaveLength(1);
    expect(contracts[0]!.name).toBe("auth-api");
  });

  it("returns ownership via /api/ownership", async () => {
    await emit(root, {
      from: "codex",
      to: "*",
      type: "ownership",
      description: "Codex owns frontend",
      payload: { paths: ["src/components/"], mode: "exclusive" },
    });

    await startAuthenticatedDaemon();

    const res = await apiFetch("/api/ownership");
    const ownership = (await res.json()) as Array<{
      agent: string;
      mode: string;
    }>;
    expect(ownership).toHaveLength(1);
    expect(ownership[0]!.agent).toBe("codex");
  });

  it("emits events via POST /api/emit", async () => {
    await startAuthenticatedDaemon();

    const res = await apiFetch("/api/emit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "claude-code",
        to: "*",
        type: "task",
        description: "Build auth module",
      }),
    });
    expect(res.status).toBe(201);

    const event = (await res.json()) as { seq: number; from: string };
    expect(event.seq).toBe(0);
    expect(event.from).toBe("claude-code");
  });

  it("redacts secrets in emitted events", async () => {
    await startAuthenticatedDaemon();

    await apiFetch("/api/emit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "claude-code",
        to: "*",
        type: "update",
        description: "Set api_key=sk_live_abcdefghijklmnopqrstuv",
        payload: { note: "password=supersecretpassword123" },
      }),
    });

    const res = await apiFetch("/api/events?after=-1");
    const data = (await res.json()) as {
      events: Array<{
        description: string;
        payload: { note: string };
      }>;
    };
    expect(data.events[0]!.description).toContain("[REDACTED]");
    expect(data.events[0]!.payload.note).toContain("[REDACTED]");
  });

  it("returns snapshot for agent", async () => {
    await emit(root, {
      from: "claude-code",
      to: "codex",
      type: "task",
      description: "Do the thing",
    });

    await startAuthenticatedDaemon();

    const res = await apiFetch("/api/snapshot/codex");
    const snap = (await res.json()) as {
      pendingTasks: Array<unknown>;
      highSeq: number;
    };
    expect(snap.highSeq).toBeGreaterThanOrEqual(0);
    expect(snap.pendingTasks.length).toBeGreaterThan(0);
  });

  it("returns events after cursor", async () => {
    await emit(root, {
      from: "a",
      to: "*",
      type: "task",
      description: "first",
    });
    await emit(root, {
      from: "b",
      to: "*",
      type: "task",
      description: "second",
    });

    await startAuthenticatedDaemon();

    const res = await apiFetch("/api/events?after=0");
    const data = (await res.json()) as {
      events: Array<{ description: string }>;
    };
    expect(data.events).toHaveLength(1);
    expect(data.events[0]!.description).toBe("second");
  });

  it("acknowledges events via POST /api/ack", async () => {
    await emit(root, {
      from: "a",
      to: "*",
      type: "task",
      description: "task",
    });

    await startAuthenticatedDaemon();

    const res = await apiFetch("/api/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: "codex", seq: 0 }),
    });
    expect(res.status).toBe(201);
  });

  it("triggers compaction via POST /api/compact", async () => {
    await startAuthenticatedDaemon();

    const res = await apiFetch("/api/compact", {
      method: "POST",
    });
    const data = (await res.json()) as { compacted: boolean };
    expect(data.compacted).toBe(false); // nothing to compact
  });

  it("rejects duplicate port", async () => {
    const port = randomPort();
    daemon = await startDaemon(root, port);

    await expect(startDaemon(root, port)).rejects.toThrow("already in use");
  });
});
