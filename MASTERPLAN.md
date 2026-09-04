# Loadout 0.9.0 release candidate

Version **0.9.0** is prepared locally and is not published yet. This file tracks
the release and launch steps and should be updated as each external step is
verified.

## Before publishing

1. Run the complete [user test guide](./docs/USER_TEST_GUIDE.md) on a disposable
   profile, then the small real-profile path you are comfortable approving.
2. Run `npm run verify:full` from a clean checkout and inspect `npm pack --dry-run`.
3. Review `CHANGELOG.md`, then replace `Unreleased` with the actual release date.
4. Merge the release candidate and create GitHub release `v0.9.0`. The release
   workflow verifies the tag, runs the full gate, and publishes with provenance.
5. Confirm `npm view loadout-ai@0.9.0 version` succeeds before announcing it.

## Repository launch setup

- Upload `docs/assets/loadout-social-preview.png` in GitHub **Settings → General →
  Social preview**. The checked-in asset is 1280×640 and centers the Claude Code
  ↔ Codex handoff.
- Enable GitHub private vulnerability reporting so the links in `SECURITY.md`
  and the issue chooser resolve to a private report form.
- Confirm Discussions is enabled only if you intend to answer questions there.
- Re-record the demo from `docs/DEMO_SCRIPT.md`; keep the current README video
  until the replacement has been watched in a signed-out browser.

## Launch claims

Lead with what the tool actually does: discover, inspect, preview, install,
activate, hand off, and roll back agent extensions. Handoff is an append-only
local task log checked at session boundaries—not a live channel. Do not claim
quota detection, automatic model switching, guaranteed safety, or independent
human review that has not happened.

## Live collaboration — Phase 1 complete

Phase 1 of the [live collaboration design](./docs/LIVE_COLLABORATION.md) ships
in 0.9.0 as `loadout coordinate` (alias `coord`):

- **Typed events**: contracts, file ownership, decisions, progress updates,
  and acknowledgements with Zod-validated payloads.
- **Monotonic sequence numbers** and cursor-based reads — reconnecting agents
  never miss an event.
- **File ownership and conflict detection** — exclusive vs shared modes,
  same-agent re-claim allowed.
- **Contract versioning** — auto-incrementing revision per named contract.
- **Snapshot endpoint** — bounded current state summary for reconnecting agents.
- **MCP server** (`loadout serve`) — exposes the same tools over stdio MCP
  so both Claude Code and Codex connect to a shared coordinator. Requires
  `@modelcontextprotocol/sdk` as an optional dependency.

The existing `loadout handoff` and `.handoff/messages.jsonl` are preserved as
the human-readable task log. The coordination log lives in
`.handoff/coordination.jsonl`.

## Live collaboration — Phase 2 complete

Phase 2 ships as `loadout daemon` with a full HTTP coordination server:

- **HTTP daemon** (`loadout daemon start`) — local REST API on 127.0.0.1:4510
  with SSE push for connected agents.
- **Web dashboard** — live status UI at the daemon URL showing contracts,
  file ownership, agent activity, and a real-time event feed.
- **SSE subscriptions** — agents connect to `/api/subscribe/:agent` and receive
  events pushed in real time, no polling needed.
- **Redaction** — secrets, API keys, tokens, and credentials are automatically
  stripped from event payloads before storage.
- **Retention and compaction** (`loadout coord compact`) — configurable max
  events and max age, atomic log rewrite with archived backup.
- **Full REST API** — snapshot, contracts, ownership, events, emit, ack,
  compact, status endpoints.

## After 0.9.0

- Phase 3: Codex SDK and Claude Agent SDK adapters with session resumption.
- Phase 4: crash recovery, concurrency tests, cross-platform, kill switch.
