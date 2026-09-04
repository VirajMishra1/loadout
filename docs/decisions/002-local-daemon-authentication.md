# ADR 002: Loopback-only authenticated coordination daemon

- Status: accepted
- Date: 2026-09-03

## Context

A localhost HTTP service is still reachable by browser pages, local malware,
and other users on an incorrectly configured machine. Coordination events can
contain private repository structure and can influence paid provider turns.

## Decision

Bind the daemon only to `127.0.0.1`. Generate a random 32-byte project token in
`.handoff/daemon.token` with mode `0600`. REST and SSE require a bearer header;
query-string tokens are rejected. Validate loopback Host headers and allow only
same-origin browser requests.

The CLI passes the token to the dashboard in a URL fragment. The dashboard
moves it into session storage immediately and removes the fragment from browser
history. Human-readable status does not expose the project root. Request bodies,
routes, cursors, agent names, and typed event payloads are bounded and validated.

## Consequences

- The dashboard opens conveniently without putting credentials in HTTP request
  URLs or referrers.
- API clients must explicitly read the local token and set `Authorization`.
- The daemon is observability and local transport only; it is not supported as
  a LAN or internet-facing service.
- Activating the project kill switch fails closed across storage, daemon,
  compaction, MCP/CLI writes, and provider-driven turns.
