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
4. **Bounded design discussion (beta, opt-in):** Claude Code and Codex
   alternate proposals and critiques on one question, then record a decision.

The bridge does not inject into an already-running turn. Delivery happens at a
safe turn boundary because that is what the supported Claude Code CLI and Codex
SDK interfaces provide.

## Quick protocol test (no paid agent turn)

For the beginner path, preview and approve a normalized ownership split:

```bash
loadout coord start --agents claude-code,codex
loadout coord start --agents claude-code,codex --yes
```

The command ignores generated directories and collapses redundant child paths.
Any existing ownership makes it stop rather than overwrite active work.

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

After ownership exists, detect imports that cross agent boundaries:

```bash
loadout coord detect
loadout coord detect --publish
loadout coord detect --publish --yes
```

Detection is conservative. Exact supported one-line declarations may be
published after the second approval; multiline or ambiguous declarations are
marked `MANUAL` and refused. Existing generated bodies are reported as current
or stale. This is an on-demand scan, not a background compiler or watcher.

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

You can instead track an existing known host session without running a provider
turn with `loadout coord agents attach provider:session-id`. The provider validates
the ID when a later `send` or `bridge` operation submits a turn. `loadout coord
agents list` shows project-tracked sessions, and `loadout coord agents send`
performs one explicit follow-up turn.

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

## Let Claude Code and Codex debate one feature

Use a design room when both agents should compare approaches before either one
claims files or writes code:

```bash
loadout coord discuss start "REST or GraphQL for checkout?" \
  --agents claude-code,codex \
  --rounds 2 \
  --max-turns 5 \
  --timeout 120
```

`--agents` starts fresh sessions lazily. To continue existing conversations,
replace it with explicit IDs:

```bash
loadout coord discuss start "REST or GraphQL for checkout?" \
  --sessions claude-code:<session-id> codex:<thread-id> \
  --rounds 2 --max-turns 5
```

The first participant is the proposer; use `--proposer codex` to swap roles.
One round means one proposer turn and one reviewer turn. Synthesis costs one
additional turn, so the exact required count is `rounds * 2 + 1`. Loadout
rejects an insufficient budget, invalid provider set, invalid timeout, or mixed
fresh/existing mode before it starts a paid turn.

Every prompt says that the response is public, will be persisted, and must not
edit files, run commands, use tools, or reveal private reasoning. Every public
statement has a thread ID and reply ID. The final synthesis records the selected
decision, rationale, credible alternatives, and unresolved disagreement. Review
it later without spending quota:

```bash
loadout coord discuss list
loadout coord discuss show <thread-id>
loadout coord replay
```

The discussion holds the same singleton lease as the provider bridge, checks
the kill switch before every provider turn, never retries a rejected or invalid
response silently, and defaults to a 120-second per-turn timeout. It does not
begin implementation automatically.

Turn an accepted decision into implementation only after reviewing the dry run:

```bash
loadout coord discuss implement <thread-id>
loadout coord discuss implement <thread-id> --yes
```

The approved command refuses mentioned paths without ownership, bundles files
that already exist, attaches acceptance criteria, records generated handoff
IDs, and uses a deterministic plan ID so retries do not duplicate tasks.
Extracted paths are normalized inside the project and the plan fails before
sending anything if it exceeds the 256-file coordination event limit.

Git history can suggest ownership when commits carry distinguishable authors:

```bash
loadout coord git-ownership \
  --agents "claude-code=Claude Opus 4.6,codex=Viraj Mishra"
```

Confidence includes commits by unmapped human authors. Add `--yes` only after
reviewing the suggestions; Git history is evidence, not proof of current intent.

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
- The design-room kill switch cannot cancel a provider call already in flight;
  it prevents persistence and the next provider turn.
- A provider may fail, time out, reject a resume ID, or return output Loadout
  cannot parse. The event stays durable and can still be consumed manually.
- The bridge is local to one machine and one repository. Remote teams need a
  separately designed authenticated transport; this release intentionally does
  not expose the daemon to a network.
- Contract detection supports relative TypeScript/JavaScript imports and exact
  one-line declarations; aliases, generated clients, path mappings, and complex
  multiline declarations may require a manual contract.

## Evidence

The coordination test suite covers concurrent writers, ownership conflicts,
revision allocation, malformed logs, redaction, authenticated HTTP/SSE, MCP
stdio framing, retention failure safety, kill-switch behavior, provider CLI/SDK
shapes, session replay, concurrent provider delivery, passive policy, and the
automatic-turn cap. The package smoke test verifies the compiled MCP artifact is
included in the npm tarball.
