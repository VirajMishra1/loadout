# Loadout — current state and roadmap

Current release: **0.9.4** (npm latest). CI passing with provenance.
12 supported agents. 53 catalog sources. Phases 1–4 of live collaboration shipped.

## Repository setup — outstanding

- [x] Upload `docs/assets/loadout-social-preview.png` to GitHub **Settings → General → Social preview** (1280×640, Claude Code ↔ Codex handoff)
- [x] Enable GitHub private vulnerability reporting so `SECURITY.md` links resolve to a private report form
- [ ] Record flagship demo (`~/Desktop/run-loadout-demo.sh`) once Codex quota resets — full flow: Maximum → curate → rollback → handoff → coord → discuss → replay

## Shipped

### Skill management
- `loadout setup` — preview-first install across 12 agents, 4 modes (Stable/Power/Maximum/Custom)
- `loadout optimize` — project-aware active-set curation from the installed library
- `loadout rollback` — every apply snapshots first; one command to undo
- `loadout discover` / `loadout review-queue` — discovery feed watching without installing
- `loadout scan` / `loadout update` / `loadout health` / `loadout alerts` — lifecycle management

### Handoff
- `loadout handoff` — durable append-only task log, survives session resets and quota limits
- Context bundles — secret-redacted source attached to tasks, capped at 50 KiB
- Verification criteria — tasks carry a pass/fail condition checked on completion

### Coordination (Phases 1–4)
- Typed events with Zod validation — contracts, ownership, decisions, updates, acks
- Monotonic sequence numbers, cursor reads — reconnecting agents never miss events
- File ownership with conflict detection — exclusive/shared modes
- Contract versioning and diffing (`loadout coord diff`)
- HTTP daemon with SSE push, bearer auth, loopback-only binding
- Web dashboard — live contracts, ownership, event feed
- Provider adapters — Claude Code (CLI) and Codex (SDK)
- Session manager — tracks sessions, replays missed events on reconnect
- Interrupt policy — immediate/boundary/passive per event type
- Atomic file locking — no duplicate sequence numbers
- Crash recovery and kill switch (`loadout daemon kill` / `loadout daemon resume`)
- Conflict preview (`loadout coord conflicts`) — git diffs before you write
- `loadout coord replay` — narrative timeline of all coordination events
- `loadout coord discuss` — bounded multi-turn Claude Code ↔ Codex debate with recorded decision

## What's next

| Feature | What it unlocks |
| ---------------------------------- | --------------------------------------------------------------- |
| **Async discuss** | discuss turns stored as events — agents debate across sessions, no need to be live simultaneously |
| **GitHub Actions sync** | `loadout sync` in CI applies the committed skill selection — identical curated set for every team member |
| **Handoff templates** | reusable task blueprints (`--template write-tests`) with pre-configured verify commands |
| **Cross-repo handoff** | pass a task from one repo to another with bundled context |
| **Cost ledger** | track provider turns spent per discussion, project, and week |
| **Agent-generated skills** | agent notices a repeated pattern and proposes a new skill into the catalog |
| **Outcome-based skill ratings** | local install outcomes improve rankings beyond star counts |

## Launch claims (still applies)

Lead with what the tool actually does: discover, inspect, preview, install,
activate, hand off, and roll back agent extensions. Handoff is an append-only
local task log checked at session boundaries — not a live channel. Do not claim
quota detection, automatic model switching, guaranteed safety, or independent
human review that has not happened.
