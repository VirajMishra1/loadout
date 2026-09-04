---
name: loadout-handoff
description: Pass coding work between Claude Code and Codex, check the other agent's work, coordinate simultaneous implementation, or run a bounded two-agent design discussion. Use for delegation, pending handoffs, shared contracts and file ownership, or when the user wants both agents to debate an approach before coding.
---

# Loadout Handoff

Claude Code and Codex cannot see each other. Loadout gives them a shared,
append-only task log in the repository so work can pass between them.

## Prerequisite

```bash
loadout --version
```

If that fails, tell the user to install it (`npm install --global loadout-ai`)
and stop.

## Check your inbox

At the start of a session, and after finishing a task, run only the command for
the current agent:

```bash
# When you are running in Codex
loadout handoff codex

# When you are running in Claude Code
loadout handoff claude-code
```

If tasks are listed, work them in order and run the `loadout handoff --done <id>`
command printed with each one. If nothing is pending, say nothing about it and
carry on — do not narrate an empty inbox.

Read the `context` line carefully. It is the only thing the sender chose to
carry across; the rest of their conversation is not available to you.

## Send a task

```bash
loadout handoff codex "write vitest coverage for src/auth.ts" --context "zod schemas already exist, stripe v16"
```

One command. It creates the log on first use and adds a short block to
`CLAUDE.md` and `AGENTS.md` telling each agent to check its inbox.

**Write the context as if the receiver knows nothing about this conversation,
because it does not.** Include:

- the files involved, by path
- decisions already made, so they are not relitigated
- what you deliberately left out and why
- how to tell the work is finished

A task with no context usually comes back wrong or gets redone.

## When to suggest a handoff

Delegating has a real cost: the other agent starts cold and the user has to
switch windows. It is worth it when:

- the work is genuinely separable, like tests for code that is already written
- a second opinion matters more than continuity, such as reviewing a change you
  authored
- the user has said they want to spread work across their two subscriptions

It is not worth it for something you could finish in the next few minutes.

## Confirm before sending

Sending writes to a shared file in the user's repository. Confirm first unless
they asked for the handoff themselves.

## Seeing everything

```bash
loadout handoff              # every pending task, both directions
loadout handoff --done 4f2a1c
```

If the log reports unreadable lines, tell the user which line numbers — the log
is append-only and a partial write can leave one corrupt entry. The remaining
messages are still shown.

## Live coordination (automatic)

When the user says both agents are working simultaneously (e.g. "Claude does
backend, Codex does frontend"), **you handle coordination automatically**. The
user should never have to type `loadout coord` commands — that is your job.

### At session start — check for updates

Use the current agent id in every command: `claude-code` inside Claude Code and
`codex` inside Codex.

```bash
loadout coord snapshot <current-agent> --json
```

If there are unacknowledged events (contracts, decisions, ownership claims from
the other agent), read them, incorporate them into your work, and acknowledge:

```bash
loadout coord ack <current-agent> <seq>
```

Tell the user briefly what the other agent has been doing: "Codex published
auth-api rev2 — I'll build against that contract."

### When you start working on files — claim ownership

Before writing to files, claim them so the other agent knows not to touch them:

```bash
loadout coord own <current-agent> src/api/ src/db/ --json
```

If there's a conflict (other agent already owns those paths), tell the user and
ask how to proceed. Do not silently overwrite another agent's work.

### When you create or change an API/schema/interface — publish a contract

Whenever you create or modify something the other agent depends on (API
endpoints, database schemas, TypeScript interfaces, environment variables),
publish it:

```bash
loadout coord contract auth-api --body "export interface AuthAPI {
  login(credentials: LoginRequest): Promise<Session>;
  logout(sessionId: string): Promise<void>;
  refresh(token: string): Promise<Session>;
}" --format typescript --agent <current-agent>
```

The revision auto-increments. The other agent sees it on their next check.

### When you finish a chunk of work — report progress

```bash
loadout coord update <current-agent> --note "Auth endpoints done, rate limiting added" --files src/api/auth.ts src/api/middleware.ts --next "Starting payment integration"
```

Release exact paths when you are finished with them so ownership does not stay
stale:

```bash
loadout coord release <current-agent> src/api/ src/db/
```

### When you make a design decision — record it

```bash
loadout coord decide <current-agent> "Use JWT for session tokens" --rationale "Stateless, works across services, Codex frontend can decode without API call"
```

### When the user asks what the other agent is doing

```bash
loadout coord snapshot <current-agent>
```

This shows pending tasks, active contracts, file ownership, recent decisions,
and unacknowledged events in one bounded summary.

## Live daemon mode

If the user starts `loadout daemon start`, dashboards and custom clients can
observe the local event stream via authenticated SSE:

- Open the authenticated dashboard URL printed by the command.
- REST and SSE require a bearer token; query-string tokens are rejected.
- The dashboard observes events. It does not inject them into an agent session.

All write paths redact secret-like data at the shared storage boundary.

## Provider bridge mode (opt-in)

### Debate one design before coding

When the user explicitly asks Claude Code and Codex to compare approaches on
the same feature before either agent writes code, offer a bounded discussion:

```bash
loadout coord discuss start "REST or GraphQL for checkout?" \
  --agents claude-code,codex --rounds 2 --max-turns 5
```

Use `--proposer codex` to swap roles, or reuse explicit sessions with
`--sessions claude-code:<session-id> codex:<thread-id>`. Each round gives both
agents one turn and the final synthesis uses one more turn. Tell the user the
exact number of paid provider turns. Do not start without an explicit user request.

The design room records only responses produced for that public discussion.
It tells both agents not to edit files, run commands, use tools, or reveal
private reasoning. Review the final decision with the user before claiming
ownership or beginning implementation. Inspect it later with
`loadout coord discuss show <thread-id>`.

### Route implementation events

When the user explicitly wants automatic follow-up turns, they can run:

```bash
loadout coord agents detect
loadout coord agents bridge claude-code:<session-id> codex:<thread-id>
```

The bridge uses supported provider interfaces and delivers relevant events at
safe turn boundaries. It cannot steer a turn already in progress. Progress
updates are passive by default, one bridge may own a project, and automatic
turns stop after 20 per session unless the user changes `--max-turns`. Starting,
attaching, sending, or bridging provider sessions can consume the user's
provider quota, so do not do it without an explicit request.

## What this is not (without the provider bridge)

Without a provider bridge, the other agent is **not given a new turn
automatically**. The daemon can receive events instantly, but an agent sees them
when it next checks its MCP tools, snapshot, or subscription. If the user needs
work now, tell them to open the other agent or explicitly start a bridge.

## Summary of when to run what

| Moment                                     | What to run                                                         |
| ------------------------------------------ | ------------------------------------------------------------------- |
| Session start                              | `loadout handoff <agent>` + `loadout coord snapshot <agent> --json` |
| Before writing files                       | `loadout coord own <agent> <paths...>`                              |
| Created/changed an API or schema           | `loadout coord contract <name> --body "..." --agent <agent>`        |
| Finished a chunk of work                   | `loadout coord update <agent> --note "..." --files "..."`           |
| Finished writing owned paths               | `loadout coord release <agent> <paths...>`                          |
| Made a design decision                     | `loadout coord decide <agent> "<title>" --rationale "..."`          |
| Both agents should compare a design        | `loadout coord discuss start "<topic>" --agents claude-code,codex`  |
| After reading other agent's events         | `loadout coord ack <agent> <seq>`                                   |
| User asks "what is the other agent doing?" | `loadout coord snapshot <agent>`                                    |
| Delegating a task                          | `loadout handoff <other-agent> "<task>" --context "..."`            |
| Task complete                              | `loadout handoff --done <id>`                                       |
