---
name: loadout-router
description: Choose the right model tier and agent for a coding task, and hand work off between Claude Code and Codex. Use when the user asks which model to use, mentions running low on usage or quota, wants to save tokens or cost, asks whether to switch to Opus/Sonnet/Haiku or a GPT tier, or wants to delegate a task to another agent.
---

# Loadout Router

Route each coding task to the cheapest model that still does it well, and hand
work between agents when a different one is better suited.

This skill wraps the `loadout` CLI, so the model catalog and pricing stay
current with the installed version rather than going stale in this file.

## Prerequisite

Check once per session:

```bash
loadout --version
```

If that fails, tell the user to install it (`npm install --global loadout-ai`)
and answer from general knowledge instead of guessing at specifics.

## Choosing a model

Run the router with the task described in plain words:

```bash
loadout route <task description>
```

It classifies the task into one of six phases — plan, implement, review, test,
debug, document — and prints the recommended tier, the models in that tier with
current prices, which of the user's installed agents can run them, and a cheaper
fallback with its tradeoff.

Report the recommendation and the reason. Name the actual model, not just the
tier. If the output lists a `Conserve:` alternative, mention it only when the
user cares about cost or quota, otherwise it is noise.

When the user is explicit about the phase, skip classification:

```bash
loadout route --phase review
```

## When the user is low on usage

If the user mentions running out, being rate limited, conserving quota, or
stretching a plan, add `--conserve`:

```bash
loadout route --conserve <task description>
```

This drops each phase one tier and prints the tradeoff you are accepting. Say
what is being given up — "shallower architectural reasoning, so review the plan
more carefully" — rather than presenting it as a free win.

Neither Claude Code nor Codex exposes remaining quota programmatically, so never
claim to know how much the user has left. `--conserve` is a user-driven choice,
not a measurement.

## Comparing models and cost

```bash
loadout route --models
loadout route --models --provider anthropic
loadout route --models --tier fast
loadout route --cost
```

Use these when the user asks what is available or what something costs. Prices
are per-million-token list rates; actual spend depends on prompt size, so give
ratios ("roughly 4x cheaper") rather than predicting a dollar total.

## Handing work to another agent

When a different agent suits the task better — or the user asks to delegate —
use the handoff log. Check it is set up:

```bash
loadout handoff status
```

If uninitialized, run `loadout handoff init` first. Then send the task:

```bash
loadout handoff send codex "write unit tests for the auth module" --context "see src/auth.ts"
```

Put anything the receiving agent needs into `--context`: file paths, the
decision you already made, what you deliberately left out. The other agent has
none of this conversation.

Sending a task is a real side effect on a shared file. Confirm with the user
before sending unless they asked for the handoff themselves.

## Reading your own inbox

At the start of a session, and after finishing a task, check whether another
agent left you work:

```bash
loadout handoff inbox claude-code
```

If it lists tasks, work them in order and run the `loadout handoff done <id>`
command it prints for each one. If it reports none, continue as normal and do
not mention it.

## Judgment this skill does not replace

- A "simple" task in an unfamiliar or high-risk area still deserves a stronger
  model. The classifier reads keywords, not stakes.
- Security-sensitive, migration, and data-loss paths are worth frontier tier
  regardless of what phase they classify as.
- If the user has already chosen a model, do not argue unless the choice is
  clearly wrong for the work.
