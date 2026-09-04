---
name: loadout-handoff
description: Pass a coding task to another AI agent, and pick up tasks another agent left for you. Use when the user wants to delegate work to Codex or Claude Code, asks what the other agent is working on, or at the start of a session to check for pending handoffs. Also handles live coordination — automatically publish contracts, claim file ownership, and report progress when collaborating with another agent.
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

```bash
loadout coord snapshot claude-code --json
```

If there are unacknowledged events (contracts, decisions, ownership claims from
the other agent), read them, incorporate them into your work, and acknowledge:

```bash
loadout coord ack claude-code <seq>
```

Tell the user briefly what the other agent has been doing: "Codex published
auth-api rev2 — I'll build against that contract."

### When you start working on files — claim ownership

Before writing to files, claim them so the other agent knows not to touch them:

```bash
loadout coord own claude-code src/api/ src/db/ --json
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
}" --format typescript --agent claude-code
```

The revision auto-increments. The other agent sees it on their next check.

### When you finish a chunk of work — report progress

```bash
loadout coord update claude-code --note "Auth endpoints done, rate limiting added" --files "src/api/auth.ts,src/api/middleware.ts" --next "Starting payment integration"
```

### When you make a design decision — record it

```bash
loadout coord decide claude-code "Use JWT for session tokens" --rationale "Stateless, works across services, Codex frontend can decode without API call"
```

### When the user asks what the other agent is doing

```bash
loadout coord snapshot claude-code
```

This shows pending tasks, active contracts, file ownership, recent decisions,
and unacknowledged events in one bounded summary.

## Live daemon mode

If the user starts `loadout daemon start`, both agents can connect to the
local HTTP server for real-time push notifications via SSE:

- Dashboard: `http://127.0.0.1:4510` (open in browser for live status)
- SSE stream: `http://127.0.0.1:4510/api/subscribe/claude-code`
- REST API: all coordination operations available via HTTP

The daemon also auto-redacts secrets from events and provides log compaction.

## What this is not (without the daemon)

Without `loadout daemon start`, the other agent is **not notified in real
time**. It sees events when it next checks (at session start, or when it runs
`loadout coord subscribe`). If the user needs something done now, tell them
to open the other agent and it will pick up the events.

## Summary of when to run what

| Moment                                     | What to run                                                         |
| ------------------------------------------ | ------------------------------------------------------------------- |
| Session start                              | `loadout handoff <agent>` + `loadout coord snapshot <agent> --json` |
| Before writing files                       | `loadout coord own <agent> <paths...>`                              |
| Created/changed an API or schema           | `loadout coord contract <name> --body "..." --agent <agent>`        |
| Finished a chunk of work                   | `loadout coord update <agent> --note "..." --files "..."`           |
| Made a design decision                     | `loadout coord decide <agent> "<title>" --rationale "..."`          |
| After reading other agent's events         | `loadout coord ack <agent> <seq>`                                   |
| User asks "what is the other agent doing?" | `loadout coord snapshot <agent>`                                    |
| Delegating a task                          | `loadout handoff <other-agent> "<task>" --context "..."`            |
| Task complete                              | `loadout handoff --done <id>`                                       |
