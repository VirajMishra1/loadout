# Project Activation Safety and Relevance Design

**Status:** Approved direction; awaiting written-spec review  
**Date:** 2026-07-20  
**Release target:** Loadout 0.4.1

## Problem

The founder acceptance run of `loadout activate --project . --agents
codex,claude-code --limit 30` exposed three connected defects:

1. The preview reported `0/30 active` even though Claude Code already had 12
   unmanaged skills. The planner counted only active Loadout records, so applying the
   proposal could exceed the disclosed per-agent limit.
2. An earlier rollback correctly restored recursively empty skill directories. The
   activation planner treated the existence of those empty directories as occupied
   content and blocked safe activation for both agents.
3. Project detection recognized only JavaScript/TypeScript and Playwright. It missed
   strong local evidence that this repository is a Node CLI, an npm package, a Vitest
   project, an MCP-related tool, and a release/supply-chain project. Ranking then used
   the entire 30-slot budget as a quota and proposed redundant or mismatched skills,
   including several overlapping Playwright workflows and a Jest skill for a Vitest
   repository.

No activation was applied. The Maximum library remains disabled, and the founder's
12 unmanaged Claude skills remain unchanged.

## Goals

- Make `--limit` a truthful ceiling over all active skills visible to each selected
  agent, whether managed by Loadout or not.
- Plan and explain capacity separately for every selected agent.
- Treat recursively empty rollback residue as unoccupied while continuing to refuse
  every non-empty, symlinked, unreadable, or unsupported target.
- Improve local project recognition enough to distinguish this Node CLI/npm/Vitest
  repository from a generic Playwright web application.
- Select a compact, diverse working set instead of filling every available slot with
  weak or redundant matches.
- Preserve a preview-first, transactional, rollback-safe mutation path.

## Non-goals

- No model or external API call is required for recommendation or activation.
- No project source, filename, dependency, or outcome data leaves the machine.
- This work does not claim that a deterministic recommendation proves global package
  quality.
- This work does not install deferred MCP servers or collect credentials.
- Dashboard removal remains a separate 0.4.1 task.

## Design

### 1. One shared definition of an occupied skill target

Loadout will use one filesystem predicate for both initial installation and later
library activation:

- A missing path is unoccupied.
- A real directory containing no entries at any depth is unoccupied.
- A regular file, symlink, special entry, unreadable directory, or directory with any
  non-directory descendant is occupied.
- Recursive inspection is bounded to 10,000 entries. Reaching the bound is treated as
  occupied, never as empty.

Activation will re-check this predicate inside the transaction immediately before
copying. This closes the preview/apply race without deleting or adopting user content.
Empty target directories may be removed immediately before the copy because they
contain no bytes to preserve; rollback still restores the pre-transaction topology.

### 2. Per-agent total active capacity

For each requested agent, the planner will scan the agent's real skill root and count
every directory containing a valid `SKILL.md`. This inventory already distinguishes
managed and unmanaged skills and will be the capacity source of truth.

For agent `a`:

```text
available(a) = max(0, limit - inventory(a).total)
```

Candidate ranking is deterministic and shared, but selection is sliced independently
to each agent's available capacity. In the founder fixture, Claude Code has 12 active
unmanaged skills and may receive at most 18 additions; Codex has zero active skills and
may receive at most 30. An agent at its limit receives no changes and a clear warning;
it does not prevent another requested agent from using its own available capacity.

The plan must never count an empty directory as an active skill. Existing managed
skills already in the desired state count toward capacity but are not proposed again.

### 3. Project signals

Project scanning remains deterministic, bounded, and local-only. It will read known
root manifests/configuration and a bounded set of repository filenames. For Node
projects it will derive explicit signals from `package.json`:

- `bin` -> Node CLI
- package name plus `publishConfig` or non-private package -> npm package/release
- `vitest` -> Vitest
- `jest` -> Jest
- `@playwright/test` or Playwright config -> Playwright
- `commander` -> command-line application
- `zod` -> schema validation
- scripts containing `prepack`, package-smoke, or release checks -> package/release

Repository filenames add delivery, security, MCP, and documentation signals only when
matching explicit reviewed patterns such as `.github/workflows`, `SECURITY.md`, MCP-
named modules, and package/release scripts. The scanner does not recursively read
arbitrary project source or send any data elsewhere.

Human output will name the important detected roles, for example:

```text
Detected: TypeScript, Node CLI, npm package, Vitest, Playwright, MCP tooling
```

### 4. Relevant and diverse selection

The existing source-priority tie-break remains, but a capacity ceiling is not a quota.
Selection stops when no candidate reaches the evidence threshold.

Ranking will:

- reward exact tool and role matches such as Vitest, CLI design, npm packaging,
  TypeScript, MCP security, release verification, and documentation;
- reject framework mismatches such as Jest-only guidance when Vitest is detected and
  Jest is not;
- group close alternatives into capability families such as browser testing, code
  review, documentation, planning, security, and architecture;
- select the highest-evidence representative before taking another member of the same
  family;
- cap weak generic foundation choices so they cannot crowd out project-specific
  evidence;
- continue to honor explicit `--pin` selectors, while disclosing when a pin consumes a
  slot or conflicts with the limit.

The same skill name from multiple repositories remains an alternative, not two active
copies. Multiple distinct skills in one family are allowed only when each has separate
strong project evidence.

### 5. Recommendation type clarity

Package-level `loadout recommend` output will label every suggestion as one of:

- `skill library` — eligible for disabled-library activation;
- `MCP/runtime setup` — requires a separate explicit preview and may require a
  non-model credential;
- `unavailable` — not prepared locally, with the reason.

Playwright MCP and GitHub MCP must not look like ordinary automatically activatable
skills. The command will show the next preview command for explicit integrations and
will continue to state that recommendations are rule-selected, not proof of quality.

### 6. Preview and apply output

The default human preview will begin with one compact block per agent:

```text
Claude Code: 12 active (0 managed, 12 unmanaged), 18/30 slots available
Codex: 0 active, 30/30 slots available
```

It will then show additions grouped by agent and capability, followed by blockers. A
recursively empty target is not printed as a blocker. A real conflict prints the exact
target and a non-destructive next action. JSON output retains full scores, reasons,
alternatives, per-agent budgets, targets, and blocker details.

`--yes` is rejected when any proposed target is blocked. A successful apply creates
one transaction snapshot covering every selected agent and prints the exact rollback
command.

## Data flow

1. Scan project metadata into local project signals.
2. Scan each requested agent's active skill inventory.
3. Read reviewed disabled-library records and local-only outcomes.
4. Score and diversify eligible candidates.
5. Slice the ordered candidates independently to each agent's available capacity.
6. Build exact activation changes and inspect targets with the shared occupancy rule.
7. Print the preview; stop unless `--yes` is present.
8. Inside the transaction, re-read state, re-check capacity and target occupancy, copy
   reviewed library bytes, fingerprint the result, persist activation state, and emit
   the rollback snapshot.

## Failure handling

- If inventory scanning fails for an agent, activation for that agent is blocked; its
  capacity is never guessed.
- If the project manifest is malformed, show the exact manifest error and continue
  only with signals that remain trustworthy.
- If state or filesystem contents change between preview and apply, abort the entire
  multi-agent transaction without partial activation.
- If fewer candidates meet the evidence threshold than available slots, activate only
  those candidates and explain that unused capacity is intentional.

## Tests and acceptance criteria

Automated tests must prove:

1. A recursively empty target does not block preview or apply.
2. A target containing a file, symlink, unreadable entry, or more than the inspection
   bound remains blocked and unchanged.
3. Empty-directory handling is identical in initial setup and project activation.
4. Twelve unmanaged Claude skills plus an 18-skill proposal never exceeds a limit of 30.
5. The same plan may select 18 additions for Claude and 30 for an empty Codex profile.
6. An agent already at capacity receives no additions while another agent can proceed.
7. Apply re-checks inventory and occupancy and aborts atomically when either changes.
8. The Loadout repository fixture detects Node CLI, npm package, Vitest, Playwright,
   Commander, Zod, release, security, and MCP signals.
9. A Vitest-only fixture never recommends a Jest-only skill.
10. Redundant Playwright/browser candidates do not consume most of the active set.
11. Recommendation output distinguishes skill libraries from explicit MCP/runtime
    setup.
12. Human output shows per-agent managed/unmanaged counts and unused capacity; JSON
    exposes the same facts structurally.
13. Existing Stable, Power, Maximum, rollback, and non-overwrite tests remain green.

Founder acceptance resumes only after the published release candidate previews a
non-blocked plan, reports Claude's existing 12 skills, respects both per-agent limits,
applies transactionally, and restores its explicit snapshot without changing unmanaged
content.

## Compatibility

Existing `loadout activate` and `loadout optimize` flags remain valid. The meaning of
`--limit` is corrected from an implicit managed-only count to the documented total
active skill ceiling. JSON consumers must migrate from one global `activeBefore` and
`capacity` pair to per-agent budget records; the 0.4.1 changelog will call out this
schema correction.
