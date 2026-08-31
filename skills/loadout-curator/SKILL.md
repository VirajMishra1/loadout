---
name: loadout-curator
description: Decide which agent skills, MCP servers, and tools should be active for the current repository, and keep that set current. Use when the user asks what skills they should install, why an agent is missing context about their stack, whether their setup is up to date, or when starting work in an unfamiliar codebase.
---

# Loadout Curator

Match the active skill set to the repository in front of you. Too few skills and
the agent lacks context; too many and every prompt carries weight it does not
need.

This skill wraps the `loadout` CLI so the catalog, provenance, and safety
findings stay current rather than being copied into this file.

## Prerequisite

```bash
loadout --version
```

If that fails, tell the user to install it (`npm install --global loadout-ai`)
and stop; do not guess at catalog contents.

## Starting work in a repository

Read what the codebase actually is before suggesting anything:

```bash
loadout recommend --project .
```

This prints detected signals (languages, frameworks, test runners) and
rule-based suggestions with a confidence label. The signals are the useful part
— they tell you what the repository is without you reading every file.

Report the detected stack first, then the suggestions worth acting on. Skip
low-confidence suggestions unless the user asks for the full list.

`recommend` reads the project and the catalog. It does not prove quality, and it
says so; repeat that framing rather than presenting suggestions as verified.

## Proposing an active set

```bash
loadout optimize --project .
```

This proposes which already-downloaded library skills should be active here.
Use it when the user has a Maximum-mode library, or after `recommend` shows the
project needs something different from what is on.

Present the proposal as a diff in plain words — what turns on, what turns off,
and why — before the user approves. Both commands are read-only until `--yes`.

## Installing something new

```bash
loadout setup --mode custom --package <id>        # preview
loadout setup --mode custom --package <id> --yes  # apply
```

Never run the `--yes` form on your own initiative. Show the preview, summarize
what it adds and to which agents, and let the user approve. Loadout snapshots
before writing, and `loadout rollback` undoes the last apply — say so, because
it lowers the cost of trying something.

If the preview reports safety findings (scripts, network domains, instruction
overrides), read them out specifically. Do not summarize a finding as "minor."

## Checking whether the setup is current

```bash
loadout status     # health grade and what is managed
loadout health     # safer updates and local drift
loadout alerts     # archived, stale, or changed upstream sources
```

Run these when the user asks whether their setup is up to date, or when an agent
behaves oddly and stale or drifted skills could explain it.

`alerts` reporting an archived upstream is worth raising unprompted — an
archived source will not receive fixes.

## Inspecting before trusting

For a source not yet in the catalog:

```bash
loadout inspect --repository <owner/name>
```

This clones at an immutable commit and classifies what it finds. Use it when the
user asks about a repository you cannot otherwise vouch for. Report what it
actually contains rather than what its README claims.

## Judgment this skill does not replace

- A large active set is not automatically wrong; a monorepo touching several
  stacks legitimately needs more than a single-purpose service.
- Detected signals describe dependencies, not intent. A repository with a test
  runner installed but no tests still needs testing skills.
- The catalog is a review queue with provenance, not a quality ranking. High
  star counts are evidence of popularity only.
- Never enable an MCP server that needs credentials without walking the user
  through what it will access first.
