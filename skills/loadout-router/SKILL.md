---
name: loadout-router
description: Decide which model to use for a coding task and hand work to another agent. Use when the user asks which model to use, mentions running low on usage or cost, asks whether to switch to Opus or Sonnet or a GPT tier, or wants to delegate a task to Codex or Claude Code.
---

# Loadout Router

Pick the model that fits the work, using the user's own routing policy rather
than your guess or mine.

## The policy is the user's, not yours

```bash
loadout route
```

That prints three buckets and the model the user has chosen for each:

- **hard** — architecture, security, migrations, tricky debugging, risky review
- **normal** — most implementation, ordinary debugging, refactors
- **cheap** — tests, docs, boilerplate, renames, mechanical edits

Read the policy before advising. If the user disagrees with a recommendation,
the fix is to change the policy, not to argue:

```bash
loadout route --set cheap=claude-sonnet-5
```

## Your job is the bucket, not the model

The CLI can guess a bucket from wording, and it says so when it does. **You
should do better**, because you have the conversation, the code, and the stakes.
Decide the bucket yourself and state it:

```bash
loadout route --bucket hard
```

Judge by consequence, not vocabulary:

- Anything touching auth, payments, migrations, or data deletion is **hard**,
  however small the diff.
- Unfamiliar code is harder than familiar code doing the same thing.
- A one-line change in a hot path is not cheap.
- Genuinely mechanical work — a rename, a docstring, a test for code you just
  wrote — is **cheap**, and paying frontier prices for it is waste.

Report the model and why that bucket. One or two sentences.

## When cost matters

If the user mentions running low, being rate limited, or wanting to spend less,
say what a cheaper bucket would cost them in quality rather than presenting it
as free. `loadout route` shows real per-million prices for the comparison.

Neither Claude Code nor Codex exposes remaining quota programmatically, so never
claim to know how much the user has left.

## Handing work to the other agent

One command sends a task; it sets up the shared log on first use:

```bash
loadout handoff codex "write vitest coverage for src/auth.ts" --context "zod schemas already exist"
```

Put everything the receiver needs into `--context` — file paths, decisions you
already made, what you deliberately left out. It has none of this conversation.

Sending writes to a shared file in the user's repository, so confirm first
unless they asked for the handoff themselves.

## Reading your own inbox

At session start, and after finishing a task:

```bash
loadout handoff claude-code
```

Work anything listed in order, then run the `loadout handoff --done <id>`
command it prints. If nothing is pending, say nothing and carry on.

`loadout handoff` with no arguments shows every pending task, both directions.
