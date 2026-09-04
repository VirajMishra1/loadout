# Live Claude Code ↔ Codex coordination

Live coordination is beta in 0.9.0. The ordinary `loadout handoff` inbox is
the stable fallback: it is durable, understandable, and does not run either
provider automatically.

## What “shared memory” means

Loadout shares structured project facts, not private conversations or model
context windows. Both agents can see the same tasks, file ownership, versioned
contracts, decisions, progress, blockers, verification results, and cursors.
Every accepted event is persisted before a watcher, dashboard, or provider
bridge sees it.

```text
Claude Code CLI  <---->  provider bridge  <---->  Codex SDK
                              |
                    coordination protocol
                    .handoff/coordination.jsonl
                       /        |        \
                    CLI        MCP     HTTP/SSE
```

The source of truth is an append-only project JSONL log protected by an
exclusive cross-process lock. There is no cloud service and no SQLite database.
Sequence numbers, acknowledgements, and snapshots make reconnects deterministic.

## Three operating levels

1. **Durable handoff (stable):** `loadout handoff` passes a bounded task and
   context to the next agent session.
2. **Shared coordination protocol (beta):** CLI or MCP tools publish and read
   structured events. Agents see changes when they call `snapshot`/`subscribe`,
   while the local daemon and dashboard can observe changes immediately.
3. **Provider bridge (beta, opt-in):** a long-running local process resumes
   provider sessions and submits relevant events as new follow-up turns.

The bridge does not inject into an already-running turn. Delivery happens at a
safe turn boundary because that is what the supported Claude Code CLI and Codex
SDK interfaces provide.

## Quick protocol test (no paid agent turn)

Run these commands in a disposable Git repository:

```bash
loadout coord own claude-code src/api
loadout coord contract checkout-api --agent claude-code \
  --body "POST /api/checkout -> 201 { id: string }"
loadout coord snapshot codex
loadout coord ack codex 1
loadout coord release claude-code src/api
loadout coord status
loadout coord replay
```

The contract revision is allocated atomically when `--revision` is omitted.
Overlapping exclusive ownership is rejected. A future acknowledgement or stale
explicit contract revision is rejected as a conflict.

## Connect the MCP server

`loadout serve` starts a protocol-only stdio MCP server in the current project.
It exposes `claim_task`, `release_ownership`, `publish_contract`,
`publish_update`, `subscribe`, `ack`, and `snapshot`. Contract revisions
auto-increment when omitted.

For Claude Code, add the server at project scope using its MCP command:

```bash
claude mcp add --transport stdio --scope project loadout-coordination -- loadout serve
```

For Codex, add this table to `~/.codex/config.toml` (or use the equivalent
Codex MCP configuration UI):

```toml
[mcp_servers."loadout-coordination"]
command = "loadout"
args = ["serve"]
```

Restart the host after changing its MCP configuration. The server inherits the
host process working directory, so confirm the agent opened the intended
project before publishing coordination state.

## Run the provider bridge

First check what is available:

```bash
loadout coord agents detect
```

You can start sessions through Loadout (this runs paid provider turns):

```bash
loadout coord agents start claude-code "Own the backend and publish endpoint contracts"
loadout coord agents start codex "Own the frontend and consume backend contracts"
```

Copy the returned IDs, then keep both attached:

```bash
loadout coord agents bridge \
  claude-code:<session-id> \
  codex:<thread-id>
```

You can instead validate an existing known host session with
`loadout coord agents attach provider:session-id`. `loadout coord agents list`
shows project-tracked sessions, and `loadout coord agents send` performs one
explicit follow-up turn.

Bridge safeguards:

- only one bridge process can own a project at a time;
- events route to different providers concurrently;
- update and acknowledgement events are passive by default and do not spend a
  provider turn;
- contract, task, decision, done, ownership, and error events are delivered at
  the next safe boundary;
- automatic delivery stops after 20 turns per session unless
  `--max-turns <n>` changes the cap;
- provider responses are printed but never saved in `.handoff`;
- injected event text is labeled untrusted project data and must not authorize
  commands, scope expansion, publishing, or destructive actions;
- the project kill switch blocks CLI, MCP, daemon, compaction, and provider
  turns.

Use `loadout daemon kill "reason"` to stop coordination and
`loadout daemon resume` to re-enable it.

## Optional daemon and dashboard

```bash
loadout daemon start
```

The daemon binds only to `127.0.0.1`. It prints an authenticated dashboard URL
whose token is carried in the URL fragment, moved immediately into browser
session storage, and removed from visible history. REST and SSE accept bearer
headers only; query-string tokens, non-loopback Host headers, and cross-origin
browser requests are rejected. The token and session state are project-local
files with mode `0600`.

The dashboard is observability, not an agent injector. Use the MCP tools or the
provider bridge for agent-to-agent delivery.

## Safety and data model

- Event schemas cap names, descriptions, context, payloads, arrays, and paths.
- Secret-like keys and values are redacted at the canonical write boundary, so
  CLI, MCP, and HTTP writes follow the same rule.
- Ownership claims use normalized project-relative paths and detect directory /
  child overlap.
- Contract revisions and event sequences are allocated while holding the same
  project lock.
- Compaction first writes a complete archival copy and aborts if archival fails.
- Corrupt JSONL lines are reported rather than hiding valid neighboring events.
- `.handoff/coordination.jsonl` is project data. Do not commit it when its facts
  are private; add the appropriate `.handoff` paths to `.gitignore`.

## Honest limitations

- This is durable shared state plus follow-up turns, not one simultaneous model
  context or provider-to-provider hidden channel.
- Claude Code and Codex authentication, quotas, billing, and host session IDs
  remain provider concerns.
- The bridge cannot steer a turn already in progress.
- A provider may fail, time out, reject a resume ID, or return output Loadout
  cannot parse. The event stays durable and can still be consumed manually.
- The bridge is local to one machine and one repository. Remote teams need a
  separately designed authenticated transport; this release intentionally does
  not expose the daemon to a network.

## Evidence

The coordination test suite covers concurrent writers, ownership conflicts,
revision allocation, malformed logs, redaction, authenticated HTTP/SSE, MCP
stdio framing, retention failure safety, kill-switch behavior, provider CLI/SDK
shapes, session replay, concurrent provider delivery, passive policy, and the
automatic-turn cap. The package smoke test verifies the compiled MCP artifact is
included in the npm tarball.
