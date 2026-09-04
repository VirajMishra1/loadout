/**
 * Local coordination daemon.
 *
 * Lightweight HTTP server with REST API and Server-Sent Events (SSE) for
 * live push notifications. No external dependencies — uses Node's built-in
 * http module.
 *
 * Endpoints:
 *   GET  /api/snapshot/:agent   — bounded state for agent
 *   GET  /api/contracts         — active contracts
 *   GET  /api/ownership         — file ownership map
 *   GET  /api/events?after=N    — events after cursor
 *   POST /api/emit              — emit a new event
 *   POST /api/ack               — acknowledge events
 *   GET  /api/subscribe/:agent  — SSE stream for agent (or /api/subscribe for all)
 *   GET  /api/status            — daemon health + log stats
 *   POST /api/compact           — trigger log compaction
 *   GET  /                      — web dashboard
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  emit,
  readAfterCursor,
  snapshot,
  getContracts,
  getOwnership,
  getAckState,
  readCoordLog,
} from "./coordinator.js";
import { watchCoordination, type CoordinationWatcher } from "./watcher.js";
import { redactDescription, redactPayload } from "./redaction.js";
import { compact, logSize, DEFAULT_RETENTION } from "./retention.js";
import { type CoordinationEvent, COORDINATION_EVENT_TYPES } from "./events.js";
import {
  writePidFile,
  removePidFile,
  isKillSwitchActive,
} from "./crash-recovery.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SSEClient {
  id: string;
  agent: string | undefined;
  res: ServerResponse;
  cursor: number;
}

interface DaemonState {
  projectRoot: string;
  clients: Map<string, SSEClient>;
  watcher: CoordinationWatcher | null;
  startedAt: string;
}

function cors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function error(res: ServerResponse, message: string, status = 400): void {
  json(res, { error: message }, status);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  const MAX_BODY = 1024 * 1024; // 1MB
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function sendSSE(client: SSEClient, events: CoordinationEvent[]): void {
  for (const event of events) {
    client.res.write(`data: ${JSON.stringify(event)}\n\n`);
    client.cursor = Math.max(client.cursor, event.seq);
  }
}

function broadcastToClients(
  state: DaemonState,
  events: CoordinationEvent[],
): void {
  for (const client of state.clients.values()) {
    const relevant = client.agent
      ? events.filter(
          (e) =>
            e.to === client.agent || e.to === "*" || e.from === client.agent,
        )
      : events;

    if (relevant.length > 0) {
      try {
        sendSSE(client, relevant);
      } catch {
        // Client disconnected, will be cleaned up
        state.clients.delete(client.id);
      }
    }
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  state: DaemonState,
): Promise<void> {
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );
  const path = url.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // Dashboard
  if (path === "/" && req.method === "GET") {
    cors(res);
    try {
      const html = await readFile(join(__dirname, "dashboard.html"), "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(generateDashboardHTML());
    }
    return;
  }

  // API routes
  if (path.startsWith("/api/")) {
    const route = path.slice(4); // strip /api

    // GET /api/snapshot/:agent
    if (route.startsWith("/snapshot/") && req.method === "GET") {
      const agent = decodeURIComponent(route.slice(10));
      if (!agent) return error(res, "Agent name required");
      const snap = await snapshot(state.projectRoot, agent);
      return json(res, snap);
    }

    // GET /api/contracts
    if (route === "/contracts" && req.method === "GET") {
      const contracts = await getContracts(state.projectRoot);
      return json(res, [...contracts.values()]);
    }

    // GET /api/ownership
    if (route === "/ownership" && req.method === "GET") {
      const ownership = await getOwnership(state.projectRoot);
      return json(res, [...ownership.values()]);
    }

    // GET /api/events?after=N
    if (route === "/events" && req.method === "GET") {
      const after = parseInt(url.searchParams.get("after") ?? "-1");
      const { events, highSeq } = await readAfterCursor(
        state.projectRoot,
        after,
      );
      return json(res, { events, highSeq });
    }

    // POST /api/emit
    if (route === "/emit" && req.method === "POST") {
      // Kill switch check
      const ks = await isKillSwitchActive(state.projectRoot);
      if (ks.active) {
        return error(res, `Kill switch active: ${ks.reason}`, 503);
      }

      const body = JSON.parse(await readBody(req)) as {
        from: string;
        to: string;
        type: string;
        description: string;
        payload?: Record<string, unknown>;
      };

      if (!body.from || !body.type || !body.description) {
        return error(res, "from, type, and description required");
      }

      const validTypes: readonly string[] = COORDINATION_EVENT_TYPES;
      if (!validTypes.includes(body.type)) {
        return error(res, `Invalid event type: ${body.type}`);
      }

      // Redact before storing
      const description = redactDescription(body.description);
      const payload = body.payload ? redactPayload(body.payload) : undefined;

      const event = await emit(state.projectRoot, {
        from: body.from,
        to: body.to ?? "*",
        type: body.type as (typeof COORDINATION_EVENT_TYPES)[number],
        description,
        payload,
      });

      return json(res, event, 201);
    }

    // POST /api/ack
    if (route === "/ack" && req.method === "POST") {
      const body = JSON.parse(await readBody(req)) as {
        agent: string;
        seq: number;
        note?: string;
      };

      if (!body.agent || body.seq === undefined) {
        return error(res, "agent and seq required");
      }

      const event = await emit(state.projectRoot, {
        from: body.agent,
        to: "*",
        type: "ack",
        description: `Acknowledged through seq ${body.seq}`,
        payload: {
          eventSeq: body.seq,
          ...(body.note ? { note: body.note } : {}),
        },
      });

      return json(res, event, 201);
    }

    // GET /api/subscribe/:agent or /api/subscribe
    if (route.startsWith("/subscribe") && req.method === "GET") {
      const agent =
        route.length > 10 ? decodeURIComponent(route.slice(11)) : undefined;
      const cursor = parseInt(url.searchParams.get("cursor") ?? "-1");

      cors(res);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      // Send initial keepalive
      res.write(": connected\n\n");

      const clientId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const client: SSEClient = { id: clientId, agent, res, cursor };
      state.clients.set(clientId, client);

      // Send backlog
      if (cursor >= 0) {
        const { events } = await readAfterCursor(state.projectRoot, cursor);
        const relevant = agent
          ? events.filter(
              (e) => e.to === agent || e.to === "*" || e.from === agent,
            )
          : events;
        if (relevant.length > 0) {
          sendSSE(client, relevant);
        }
      }

      // Keepalive every 30s
      const keepalive = setInterval(() => {
        try {
          res.write(": keepalive\n\n");
        } catch {
          clearInterval(keepalive);
          state.clients.delete(clientId);
        }
      }, 30000);

      req.on("close", () => {
        clearInterval(keepalive);
        state.clients.delete(clientId);
      });

      return;
    }

    // GET /api/status
    if (route === "/status" && req.method === "GET") {
      const size = await logSize(state.projectRoot);
      const ackState = await getAckState(state.projectRoot);
      return json(res, {
        daemon: "running",
        startedAt: state.startedAt,
        projectRoot: state.projectRoot,
        connectedClients: state.clients.size,
        clients: [...state.clients.values()].map((c) => ({
          id: c.id,
          agent: c.agent ?? "all",
          cursor: c.cursor,
        })),
        log: size,
        ackCursors: Object.fromEntries(ackState.cursors),
        unackedCount: ackState.unacked.length,
      });
    }

    // POST /api/compact
    if (route === "/compact" && req.method === "POST") {
      const result = await compact(state.projectRoot);
      return json(res, result);
    }

    return error(res, "Not found", 404);
  }

  error(res, "Not found", 404);
}

export function generateDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Loadout Coordination</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #e6edf3; --muted: #8b949e; --accent: #58a6ff;
    --green: #3fb950; --yellow: #d29922; --red: #f85149;
    --cyan: #39d2c0; --purple: #bc8cff;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text);
    line-height: 1.5; padding: 1rem;
  }
  .header {
    display: flex; align-items: center; gap: 1rem;
    padding: 1rem; margin-bottom: 1.5rem;
    border-bottom: 1px solid var(--border);
  }
  .header h1 { font-size: 1.4rem; font-weight: 600; }
  .status-dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--green); animation: pulse 2s infinite;
  }
  @keyframes pulse { 50% { opacity: 0.5; } }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
    gap: 1rem; margin-bottom: 1.5rem;
  }
  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 1rem;
  }
  .card h2 {
    font-size: 0.85rem; text-transform: uppercase;
    letter-spacing: 0.05em; color: var(--muted);
    margin-bottom: 0.75rem; display: flex;
    align-items: center; gap: 0.5rem;
  }
  .card h2 .count {
    background: var(--border); border-radius: 10px;
    padding: 0 8px; font-size: 0.75rem; color: var(--text);
  }
  .item {
    padding: 0.5rem 0; border-bottom: 1px solid var(--border);
    font-size: 0.9rem;
  }
  .item:last-child { border-bottom: none; }
  .agent { color: var(--accent); font-weight: 600; }
  .badge {
    display: inline-block; padding: 1px 6px; border-radius: 4px;
    font-size: 0.75rem; font-weight: 500;
  }
  .badge-exclusive { background: rgba(248,81,73,0.2); color: var(--red); }
  .badge-shared { background: rgba(210,153,34,0.2); color: var(--yellow); }
  .badge-contract { background: rgba(57,210,192,0.2); color: var(--cyan); }
  .badge-decision { background: rgba(188,140,255,0.2); color: var(--purple); }
  .event-feed {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 1rem; max-height: 500px;
    overflow-y: auto;
  }
  .event {
    padding: 0.4rem 0; border-bottom: 1px solid var(--border);
    font-size: 0.85rem; font-family: 'SF Mono', Monaco, monospace;
  }
  .event:last-child { border-bottom: none; }
  .event .time { color: var(--muted); }
  .event .type { font-weight: 600; }
  .type-contract { color: var(--cyan); }
  .type-ownership { color: var(--yellow); }
  .type-decision { color: var(--purple); }
  .type-update { color: var(--green); }
  .type-ack { color: var(--muted); }
  .type-task { color: var(--accent); }
  .type-done { color: var(--green); }
  .type-error { color: var(--red); }
  .stat-row {
    display: flex; justify-content: space-between;
    padding: 0.3rem 0; font-size: 0.9rem;
  }
  .stat-value { font-weight: 600; color: var(--accent); }
  .empty { color: var(--muted); font-style: italic; font-size: 0.9rem; }
  .connected-badge {
    font-size: 0.75rem; color: var(--green);
    margin-left: auto;
  }
</style>
</head>
<body>
<div class="header">
  <div class="status-dot" id="status-dot"></div>
  <h1>Loadout Coordination</h1>
  <span class="connected-badge" id="connection-status">connecting...</span>
</div>

<div class="grid">
  <div class="card" id="stats-card">
    <h2>📊 Status</h2>
    <div id="stats"><span class="empty">Loading...</span></div>
  </div>
  <div class="card">
    <h2>📋 Contracts <span class="count" id="contract-count">0</span></h2>
    <div id="contracts"><span class="empty">No contracts</span></div>
  </div>
  <div class="card">
    <h2>🔒 File Ownership <span class="count" id="ownership-count">0</span></h2>
    <div id="ownership"><span class="empty">No ownership claims</span></div>
  </div>
  <div class="card">
    <h2>✅ Ack State</h2>
    <div id="acks"><span class="empty">No acknowledgements</span></div>
  </div>
</div>

<div class="event-feed">
  <h2 style="font-size:0.85rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:0.75rem;">
    ⚡ Live Event Feed
  </h2>
  <div id="events"><span class="empty">Waiting for events...</span></div>
</div>

<script>
const API = window.location.origin;
let eventSource = null;
const maxEvents = 200;
const eventBuffer = [];

async function fetchJSON(path) {
  const res = await fetch(API + path);
  return res.json();
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function refreshState() {
  try {
    const [status, contracts, ownership] = await Promise.all([
      fetchJSON('/api/status'),
      fetchJSON('/api/contracts'),
      fetchJSON('/api/ownership'),
    ]);

    // Stats
    document.getElementById('stats').innerHTML = [
      statRow('Events', status.log.events),
      statRow('Log size', formatBytes(status.log.bytes)),
      statRow('Connected clients', status.connectedClients),
      statRow('Unacked events', status.unackedCount),
      statRow('Uptime', formatUptime(status.startedAt)),
    ].join('');

    // Contracts
    document.getElementById('contract-count').textContent = contracts.length;
    document.getElementById('contracts').innerHTML = contracts.length
      ? contracts.map(c =>
          '<div class="item">' +
          '<span class="badge badge-contract">' + escapeHtml(c.name) + ' rev' + c.revision + '</span> ' +
          'by <span class="agent">' + escapeHtml(c.publisher) + '</span>' +
          (c.format ? ' <span style="color:var(--muted)">(' + escapeHtml(c.format) + ')</span>' : '') +
          '</div>'
        ).join('')
      : '<span class="empty">No contracts</span>';

    // Ownership
    document.getElementById('ownership-count').textContent = ownership.length;
    document.getElementById('ownership').innerHTML = ownership.length
      ? ownership.map(o =>
          '<div class="item">' +
          '<span class="agent">' + escapeHtml(o.agent) + '</span> ' +
          '<span class="badge badge-' + o.mode + '">' + o.mode + '</span> ' +
          escapeHtml(o.paths.join(', ')) +
          '</div>'
        ).join('')
      : '<span class="empty">No ownership claims</span>';

    // Ack state
    const ackHtml = Object.entries(status.ackCursors).map(([agent, cursor]) =>
      '<div class="item">' +
      '<span class="agent">' + escapeHtml(agent) + '</span>: seq ' + cursor +
      '</div>'
    ).join('');
    document.getElementById('acks').innerHTML = ackHtml || '<span class="empty">No acknowledgements</span>';

  } catch (e) {
    console.error('Refresh failed:', e);
  }
}

function statRow(label, value) {
  return '<div class="stat-row"><span>' + label + '</span><span class="stat-value">' + value + '</span></div>';
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatUptime(startedAt) {
  const ms = Date.now() - new Date(startedAt).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

function renderEvent(event) {
  const time = event.timestamp ? event.timestamp.slice(11, 19) : '';
  return '<div class="event">' +
    '<span class="time">' + time + '</span> ' +
    '<span class="type type-' + event.type + '">[' + event.type + ']</span> ' +
    '<span class="agent">' + escapeHtml(event.from) + '</span>' +
    (event.to !== '*' ? ' → ' + escapeHtml(event.to) : '') + ' ' +
    escapeHtml(event.description) +
    '</div>';
}

function addEvent(event) {
  eventBuffer.unshift(event);
  if (eventBuffer.length > maxEvents) eventBuffer.pop();
  const el = document.getElementById('events');
  el.innerHTML = eventBuffer.map(renderEvent).join('');
}

function connectSSE() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource(API + '/api/subscribe');

  eventSource.onopen = () => {
    document.getElementById('connection-status').textContent = 'connected';
    document.getElementById('status-dot').style.background = 'var(--green)';
  };

  eventSource.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      addEvent(event);
      refreshState();
    } catch {}
  };

  eventSource.onerror = () => {
    document.getElementById('connection-status').textContent = 'reconnecting...';
    document.getElementById('status-dot').style.background = 'var(--red)';
    setTimeout(connectSSE, 3000);
  };
}

// Initial load
(async () => {
  // Load recent events
  try {
    const { events } = await fetchJSON('/api/events?after=-1');
    const recent = events.slice(-50);
    for (const e of recent) eventBuffer.push(e);
    document.getElementById('events').innerHTML =
      eventBuffer.length ? eventBuffer.map(renderEvent).join('')
      : '<span class="empty">No events yet</span>';
  } catch {}

  await refreshState();
  connectSSE();

  // Refresh state every 10s
  setInterval(refreshState, 10000);
})();
</script>
</body>
</html>`;
}

export async function startDaemon(
  projectRoot: string,
  port = 4510,
): Promise<{ port: number; close: () => void }> {
  // Check kill switch
  const killSwitch = await isKillSwitchActive(projectRoot);
  if (killSwitch.active) {
    throw new Error(
      `Kill switch active: ${killSwitch.reason}\n` +
        `Deactivate with: loadout daemon resume`,
    );
  }

  const state: DaemonState = {
    projectRoot,
    clients: new Map(),
    watcher: null,
    startedAt: new Date().toISOString(),
  };

  // Start file watcher to push events to SSE clients
  try {
    state.watcher = await watchCoordination(projectRoot, {
      onEvents(events) {
        broadcastToClients(state, events);
      },
      onError(err) {
        console.error(`Watcher error: ${err.message}`);
      },
    });
  } catch {
    // Watcher failed — daemon still works, just no push
  }

  const server = createServer((req, res) => {
    handleRequest(req, res, state).catch((err) => {
      console.error("Request error:", err);
      if (!res.headersSent) {
        error(res, "Internal server error", 500);
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${port} already in use — daemon may already be running`,
          ),
        );
      } else {
        reject(err);
      }
    });

    server.listen(port, "127.0.0.1", async () => {
      // Write PID file after successful bind
      await writePidFile(projectRoot, port);

      // Clean up PID file on exit — only register once per process
      const onExit = () => removePidFile(projectRoot);
      const onTerm = async () => {
        await removePidFile(projectRoot);
        process.exit(0);
      };
      process.once("exit", onExit);
      process.once("SIGTERM", onTerm);

      resolve({
        port,
        close() {
          process.removeListener("exit", onExit);
          process.removeListener("SIGTERM", onTerm);
          state.watcher?.stop();
          for (const client of state.clients.values()) {
            try {
              client.res.end();
            } catch {
              // ignore
            }
          }
          state.clients.clear();
          server.close();
          removePidFile(projectRoot);
        },
      });
    });
  });
}
