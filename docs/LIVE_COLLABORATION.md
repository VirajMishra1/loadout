# Live collaboration design

> Design proposal for a release after 0.9.0. The live coordinator described
> here is not implemented yet. Loadout 0.9.0 handoff is intentionally a durable,
> session-boundary inbox.

## The idea

One developer should be able to give Codex the frontend and Claude Code the
backend while both agents share the same current contract: tasks, ownership,
decisions, endpoint changes, blockers, and verification results. The user
should not have to relay those facts manually.

This is possible, but a skill alone cannot make it live. A skill teaches an
agent when and how to use tools; it does not keep running or inject context
into another provider's active conversation. Live coordination needs a small
local process that both agents can reach and an adapter that resumes or steers
each agent when relevant events arrive.

## Proposed architecture

```text
Codex SDK / app server  <---->  Loadout coordinator  <---->  Claude Agent SDK
                                  |       |
                                  |       +-- project event stream
                                  +---------- SQLite state + append-only log
```

The coordinator would run locally and expose the same MCP tools to both
agents:

- `claim_task`: reserve work and declare owned files or surfaces.
- `publish_contract`: publish a versioned API, schema, component, or decision.
- `publish_update`: report progress, touched files, tests, blockers, and next
  action.
- `subscribe`: stream relevant events after a cursor.
- `ack`: record that an agent incorporated an event.
- `snapshot`: return a bounded, current summary for reconnecting sessions.

The existing `.handoff/messages.jsonl` remains the human-readable audit trail.
A project-local SQLite database becomes the indexed source of truth for live
state, with every state change mirrored to the log. A monotonically increasing
sequence number makes reconnects deterministic and prevents missed messages.

## What should be shared

Share structured project facts, not entire private conversations:

- task ID, status, owner, dependencies, and acceptance criteria;
- file or directory ownership and expected write set;
- versioned contracts such as OpenAPI fragments, TypeScript types, database
  migrations, and environment-variable names;
- decisions with rationale and superseded decision IDs;
- changed files, commit or diff reference, verification commands, and results;
- blockers and explicit requests for another agent.

For the frontend/backend example, Claude publishes an endpoint contract with a
revision number. Codex receives that event, acknowledges the revision, and
generates against the saved contract. If Claude changes it, the coordinator
marks Codex's older acknowledgement stale and sends only the contract delta.

## Delivery semantics

"Live" should mean seconds, with durable recovery—not two models sharing one
hidden context window.

1. Each adapter keeps a streaming connection to the local coordinator.
2. Events are persisted before notification.
3. The adapter filters events by task, ownership, and dependency.
4. A relevant event steers an active turn when the host supports it; otherwise
   it resumes the agent at the next safe turn boundary.
5. The agent acknowledges the exact event sequence it incorporated.
6. Reconnecting agents request a bounded snapshot plus events after their last
   cursor.

OpenAI documents programmatic local Codex threads and streamed agent events
through the [Codex SDK and app server](https://developers.openai.com/codex/sdk/).
Anthropic documents programmatic and streaming Claude Code operation through
its [CLI and SDK](https://docs.anthropic.com/en/docs/claude-code/cli-usage).
Those host interfaces are the right integration layer; the first-party
`loadout-handoff` skill should remain the conversational interface on top.

## Safety and conflict rules

- Keep secrets, credentials, raw prompts, and unredacted tool output out of the
  shared store by default.
- Validate every event against a versioned schema and cap every field and
  payload.
- Treat agent-written messages as untrusted input; never turn them directly
  into shell commands.
- Require explicit file ownership or separate worktrees for concurrent writes.
- Detect overlapping write sets before either agent applies a conflicting
  change.
- Require user approval for destructive actions, publishing, deployment, and
  permission expansion.
- Preserve append-only provenance: author, provider, session, timestamp,
  sequence, and the event being superseded.
- Compact old events into signed summaries without deleting the audit log.

## Delivery plan

### Phase 1: structured asynchronous handoff

Extend the current log with typed events for contracts, ownership, decisions,
and verification. Add cursors, acknowledgements, snapshots, conflict checks,
and CLI/MCP parity. This makes handoff reliable without running a daemon.

### Phase 2: local live coordinator

Add the SQLite-backed daemon, authenticated local transport, subscriptions,
redaction, retention limits, and a read-only status UI. Agents still act only
at safe turn boundaries.

### Phase 3: provider adapters

Integrate the Codex SDK/app server and Claude Agent SDK, resume persistent
sessions, translate streamed events into the common schema, and add policy for
which events may interrupt active work.

### Phase 4: production hardening

Add crash recovery, concurrency and race tests, prompt-injection tests,
cross-platform installers, metrics, audit export, version negotiation, and a
kill switch. Ship it as an opt-in beta before making any live behavior a
default.

## Success criteria

- A contract update is durable before either agent sees it.
- The dependent agent observes it within five seconds while connected.
- Restarting either agent loses no acknowledged or unacknowledged event.
- Concurrent ownership of the same file is blocked or explicitly approved.
- Shared context stays bounded as the repository and conversation grow.
- The user can inspect, pause, export, and completely remove coordination
  state.
