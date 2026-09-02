---
name: loadout-handoff
description: Pass a coding task to another AI agent, and pick up tasks another agent left for you. Use when the user wants to delegate work to Codex or Claude Code, asks what the other agent is working on, or at the start of a session to check for pending handoffs.
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

At the start of a session, and after finishing a task:

```bash
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

## What this is not

The other agent is **not notified**. It sees the task when it next checks its
inbox, which the managed block asks it to do at session start. If the user needs
something done now, tell them to run it themselves rather than implying delivery.
