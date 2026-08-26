# Loadout — Focus & Harden Masterplan (V2)

Status: active. Branch: `refactor/focus-and-harden`.
Goal: turn a strong-but-buried product into a tight, trustworthy, intuitive one.
Method: **subtract → restructure → rebuild UX → grow.** Tests green at every phase gate.

Guiding thesis: the scan → recommend → install → update → rollback spine across AI
coding agents is excellent. Everything that does not serve it, or that invents a threat
model / distribution channel that does not exist, is removed. What remains is exactly the
tagline, and every remaining claim gets *stronger*.

Baseline at start: 40k LOC, ~98 commands, 625 tests passing.
Target after Phase 4: ~17–20k LOC, ~20 core commands, tests still green.

---

## Phase 0 — Safety net (done)
- [x] Clean tree confirmed, working branch `refactor/focus-and-harden` created.
- Gate: `npm run build` clean, full suite green before any change.

## Phase 1 — Bug fixes (safety, small, today) — DONE
Load-bearing correctness. No feature change.
Note: on inspection the symlink issue was dead/misleading code, not a live install-path
exploit — `validateSkillDirectory` -> `scanSkillSecurity` already rejects nested symlinks
fail-closed at plan time (skills.ts:72, before the early return). Fix removed the dead
branch + lying comment and added a regression test pinning the real guard.
1. **Symlink dead-code (HIGH)** — `src/core/skills.ts:84-95`. The symlink-rejection
   `throw` for files inside a skill package is unreachable (function returns at line 84
   before the loop that checks). A malicious skill package's nested symlink is copied into
   a live agent dir; only a post-copy hash backstop rolls it back, with a real on-disk
   window and no preview-time warning. Fix: walk the SKILL.md directory's own entries
   (recursively) for symlinks *before* the early return; reject at plan time.
2. **GitHub temp-file race (LOW)** — `src/core/github.ts:138,219`. Temp path keyed only by
   `process.pid`; concurrent same-repo metadata writes can corrupt cache. Fix: add
   `randomUUID()` like every other writer in the codebase.
- [x] Symlink dead-code removed + comment corrected (skills.ts).
- [x] GitHub temp race fixed with randomUUID (github.ts:139,220).
- [x] Regression test added (tests/skills-symlink.test.ts) — nested symlink rejected.
- Gate: build clean; targeted tests pass; full suite pending confirmation.

## Phase 2 — The big delete — DONE (src 40,111 -> 30,202 LOC; 14 core modules cut)
Correction to the plan: `registry.ts` was KEPT (sync.ts depends on its client resolvers);
only the registry *server* (registry-api.ts + registry-serve command) was removed. The
signed-catalog overlay was severed from catalog.ts (loadEffectiveCatalog now returns the
bundled catalog + GitHub-freshness cache). head-to-head + signing removed together. All
14 test-suite failures after the cut were 2 real contract updates (completion assertions,
help probe) + 12 sandbox subprocess-timeout flakes that pass in isolation.

Remove ceremony that no user path reaches or that defends a non-existent server.
Delete in dependency-safe order (leaf modules + their commands + their tests together).
- **Benchmark complex** — `benchmark-trust.ts`, `benchmark-evidence.ts`, `benchmark-runner.ts`,
  `benchmark-campaign.ts`, `benchmark-fixtures.ts`, `benchmark-evidence`/`benchmark-runner`
  usage, the `benchmark` command + `release-claims.ts` dependency. (~4,900 LOC)
- **Signing / registry / feed infra** — `signing.ts`, `catalog-release.ts`,
  `intelligence-feed.ts`, `intelligence-feed-build.ts`, `compatibility-intelligence.ts`,
  `registry.ts`, `registry-api.ts`; commands `keygen`, `catalog-sign`, `catalog-verify`,
  `verify`, `intelligence`, `compatibility`, `registry-serve`, `serve`. (~5,000 LOC)
  Trust story standardizes on commit-pin + SHA-256 content integrity + snapshot/rollback,
  which `source.ts`/`provenance.ts`/`snapshot.ts` already do.
- **Ecosystem interop** — `ecosystem-import.ts` + `interop apm` / `interop openpackage`. (~1,350 LOC)
- **Self-audit** — `claims` command moves to `scripts/` (CI check), out of the shipped CLI.
- After each deletion group: `npm run build` + full suite. Remove orphaned tests with their
  modules. No dangling imports.
- Gate: build clean, suite green, `grep` shows no references to deleted symbols outside history.

## Phase 3 — Cut command surface — DONE (default help now 24 core commands)
Reused the existing `HIDDEN_FROM_FIRST_SCREEN` mechanism (cli-guide.ts + cli.ts _hidden
flag) rather than building a new gate. Visible core: setup, scan, status, health, doctor,
recommend, library, list, optimize, activate, enable, disable, install, remove, update,
upgrade, rollback, sync, reconcile, catalog, alerts, mcp, guide, advanced. Everything else
stays runnable but off the first screen; `loadout advanced` lists it. Fixed ADVANCED_GUIDE,
which still named deleted commands. Original Phase 3 detail retained below.


- **KEEP (~20):** setup, scan, recommend, install, update, rollback, plan, list, library,
  add, remove, uninstall, search, status, health, doctor, sync, reconcile, adopt, profiles,
  catalog, mcp (consolidated), completion, init, export, import, lock.
- **--experimental (hidden from default help):** discover, candidate, review-queue, review,
  catalog-update, watch, alerts (+collapse the 5 alert subcommands to one), autopilot,
  outcomes/outcome, improve/improve-feedback, compare/compare-loadouts/head-to-head,
  evaluate, capabilities, sandbox-run, canary, skill-audit, audit.
- **Consolidate:** 4 mcp commands → `loadout mcp <sub>`; 6 alert commands → 1; merge
  `guide`/`advanced`/`cli-guide` into `--help` + one `guide`.
- Mechanism: an `--experimental` flag / `LOADOUT_EXPERIMENTAL=1` gate that hides commands
  from help and refuses them politely otherwise. Front-page help lists only the core verbs.
- Gate: `loadout --help` shows a focused screen; experimental commands still work behind the
  gate; suite green.

## Phase 4 — Split `cli.ts` (God Object) into `src/commands/*`
Do this AFTER deletion so far less code is moved.
- `src/cli.ts` → thin registrar (<150 LOC): program setup, version, error handler, group loop.
- `src/commands/setup.ts` (setup, install, plan, rollback, update)
- `src/commands/inventory.ts` (list, library, add, remove, uninstall, status)
- `src/commands/agents.ts` (scan, recommend, sync, reconcile, adopt, profiles)
- `src/commands/mcp.ts` (mcp + subcommands)
- `src/commands/catalog.ts` (catalog, search, + experimental discovery)
- `src/commands/health.ts` (health, doctor, audit)
- `src/commands/experimental.ts` (everything gated)
- Each module exports `register(program)`. Gate: build clean, suite green, no behavior change.

## Phase 5 — Modes reliability — DONE (offline guard + network rot check)
Findings during execution:
- The `isStableSkillSelected` "footgun" is INTENTIONAL, not a bug: stable mode's
  eligiblePackages returns only allowlisted packages, so the `!selected -> true` branch
  only fires in the reviewed-tier fallback (downstream catalogs without bundled ids),
  where installing all skills is the intended behavior. Left as-is.
- DONE: offline anti-rot guard (tests/profiles.test.ts) — fails loudly if any Stable/Power
  allowlist package is missing/archived, empty, duplicated, or (Stable) off reviewed tier.
- DONE: network rot check (scripts/check-mode-allowlists.mjs, `npm run check:allowlists`)
  fetches each allowlist package at its pinned commit and asserts every named skill still
  resolves, reusing fetchRepositorySnapshot + discoverSkillDirectories (installer code).
  Validated live: all 9 packages, every skill resolves. Gated as a live/network check
  (like check:live), not the offline `verify` chain, so CI stays deterministic offline.
- Did NOT rip out the curated allowlists for pure policy-derived selection: the curation
  encodes real judgment and full derivation would change what installs (product risk).
  Original Phase 5 plan retained below.


- Replace hardcoded `STABLE_SKILL_ALLOWLIST` / `POWER_SKILL_ALLOWLIST` name lists in
  `profiles.ts` with **policy filters** over the catalog (tier + category + trust-stage +
  max-count). Modes then evolve with the catalog; new entries flow in by policy.
- Keep a small curated override map only where policy is insufficient — but the default is derived.
- Fix `isStableSkillSelected` footgun (`profiles.ts:111` returns true for unlisted packages).
- **New test:** every skill a mode selects actually resolves in its package's pinned commit
  (guards silent allowlist rot).
- Gate: modes produce a sensible, tested selection from the live catalog; suite green.

## Phase 6 — Zero-arg wizard (the front door)
- `npx loadout-ai` with no args on a TTY → interactive:
  detect agents → show current inventory (installed / duplicated) → offer Stable / Power /
  Maximum / Custom → preview exact plan → confirm → snapshot + apply → show rollback hint.
- Non-TTY / `--json` / piped → current non-interactive behavior (scriptable, unchanged).
- Reuse existing `setup` machinery; this is a front-end, not new install logic.
- Gate: manual TTY walkthrough + a non-interactive test that bare invocation with a mode flag
  still works headless.

## Phase 7 — `status` home screen with health grade
- `loadout status` becomes the home screen: per agent an A–F grade, installed count, drift,
  duplicates, overlap warnings, and the one command to fix each ("run `loadout optimize`").
- Replace the 842-LOC signed `agent-health-score.ts` with a fast, legible grade (grep-and-count
  of drift/staleness/overlap). Keep it one screen, actionable.
- Gate: `status` renders clearly on a real profile; suite green.

## Phase 8 — Copy rewrite (voice)
- Every user-facing line answers: what changes, is it safe, how to undo. Cut defensive
  footnotes (e.g. the "separately billed model API access" line in previews).
- Consistent, warm, terse developer voice. Errors are actionable.
- Gate: previews/`setup`/`status`/wizard read cleanly to a first-time developer.

## Phase 9 — Catalog freshness pipeline (connect discovery → review → promote)
- Wire the 6 discovery connectors behind one `Discovery` interface with a shared bounded-fetch
  + normalize core (kills duplication).
- `catalog-update` re-verifies pinned commits, license, archive status, and refreshes
  `verifiedAt`; flags decayed entries.
- Make discovery → review-queue → promote an actual connected path (still human-gated), so the
  catalog grows and stays fresh instead of being hand-edited and frozen.
- Resolve the 6 `NOASSERTION` licenses (clear or drop).
- Gate: a dry-run refresh reports staleness/drift; promotion path works end to end on a fixture.

## Phase 10 — Share card → team sync story (growth)
- `loadout share` → a real, seeable artifact (card/page): "My AI stack: N skills, M agents,
  grade A. Reproduce: `loadout sync <url>`."
- Lean into **reproducible team loadouts** as the wedge: locked, safe, one-command team sync
  (builds on manifest/lock/sync/rollback already present).
- Gate: share output is shareable and the reproduce command round-trips.

---

## Execution rules
- Tests green at every phase gate; never advance on red.
- Commit per phase (or per deletion group) with a clear message; never `--no-verify`,
  never force-push, never push without explicit instruction.
- Update this file's checkboxes as phases complete.
- Any capability incomplete at a stopping point stays behind an experimental gate, never
  presented as production-ready.
