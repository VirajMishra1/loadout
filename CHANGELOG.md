# Changelog

## Unreleased

### Added

- Add the pinned MIT-licensed Obsidian Skills collection and recommend it only when an
  Obsidian vault is detected.
- Add host-aware reviewed MCP setup, verification, health, rollback, and removal for
  Codex and Claude Code.

### Changed

- Remove the dashboard and disposable demo commands so the CLI is the single
  authoritative product surface.
- Define Stable as the bounded 30-skill default, Power as the intentionally larger
  active toolkit, and Maximum as the broad disabled library with project activation.
- Group Maximum quarantine, deferral, and risk output by default; retain every unit
  under `setup --details`.
- Refresh the dated GitHub discovery feed locally and present sourced, inspected,
  Stable-selected, and future evidence stages without the misleading `0 discovered`
  headline.
- Gate project-aware activation by detected language, framework, provider, and
  project role before scoring generic CLI, MCP, package, publish, or schema words.
- Keep explicit skill pins as a deliberate override while treating the active-set
  limit as a ceiling rather than filling it with ecosystem-mismatched candidates.

### Fixed

- Add human-readable rollback history with timestamps, mutation labels, affected
  roots, effective change counts, and explicit no-op guidance.
- Report an empty managed installation as `not configured` rather than healthy.
- Configure reviewed MCP recipes directly for Codex TOML or Claude Code JSON, track
  their fingerprints, include ownership state in the same rollback transaction, and
  remove only the managed server entry.
- Prevent substring matches such as `npm` inside `pnpm` and arbitrary `*-cli`
  names from receiving unrelated Node CLI or Commander relevance scores.
- Stop non-.NET, non-Python, non-Elixir, non-frontend, and non-backend projects
  from automatically activating domain-specific guidance for those ecosystems.

## 0.4.1 - 2026-07-20

### Added

- Detect local Node CLI, npm package, release, Vitest, Commander, Zod, MCP,
  and security signals when recommending project tooling.
- Label recommendations as skill libraries, explicit MCP/runtime setup, or
  unavailable instead of presenting every catalog record as automatically
  activatable.

### Changed

- Calculate project activation capacity separately for each agent and count
  both Loadout-managed and pre-existing unmanaged skills toward `--limit`.
- Prefer compact, diverse project skill sets and reject mismatched Jest-only
  guidance for Vitest-only repositories.

### Fixed

- Allow project activation through recursively empty directories restored by
  rollback while continuing to block files, symlinks, unreadable paths, and
  unsupported entries.
- Re-check per-agent capacity and target occupancy inside the activation
  transaction so filesystem changes after preview abort without partial edits.

## 0.4.0 - 2026-07-20

### Added

- Add generated, test-enforced README facts and bounded release claims so public
  documentation cannot silently drift away from the shipped catalog, profiles,
  adapters, commands, or verification surface.
- Add disposable filesystem lifecycle conformance coverage for all 12 configured
  agent adapters and an offline README product journey covering library install,
  activation, inspection, privacy-safe sharing, and rollback.
- Add a new Loadout visual identity and a proof-first README organized around the
  Choose -> Inspect -> Preview -> Apply -> Undo workflow.

### Changed

- Make CI and claim-generation paths portable on Windows, fetch the repository
  history needed by evidence checks, and pin third-party Actions by immutable commit.
- Consolidate active planning in `MASTER_PLAN.md` and retain completed implementation
  documents only as historical evidence.

### Fixed

- Refuse explicit rollback when managed paths changed after a mutation, including
  dashboard restores and unsupported filesystem entries, while retaining automatic
  failed-transaction recovery.
- Bind adoption to the complete safe skill tree, reject drift and forged plans, and
  record ownership only after verifying the final bytes.
- Record installed-profile state inside the setup transaction so Stable and other
  profile changes can be rolled back consistently.

## 0.3.2 - 2026-07-18

### Fixed

- Treat recursively empty skill directories left by an older removal as unoccupied,
  while continuing to block every directory containing a file, symlink, or other
  unmanaged entry.
- Re-check target occupancy immediately before copying or replacing files to close the
  preview/apply race.
- Remove recursively empty managed skill directories during complete uninstall so a
  clean reinstall does not encounter false conflicts.

## 0.3.1 - 2026-07-18

### Fixed

- Distinguish separately billed AI/model API keys from unrelated service credentials.
  The no-model-key MCP view now correctly includes GitHub read-only while clearly
  disclosing its GitHub token requirement; `--credential-free` retains the stricter
  zero-credential filter.

## 0.3.0 - 2026-07-18

### Added

- Add a preview-first `loadout uninstall` that removes managed packages, runtime
  tools, native daily jobs, library/cache/state, and optionally the global npm CLI.
- Save the installed Stable, Power, Maximum, or Custom profile and evaluate it on
  every `loadout update` check.
- Add explicit whole-profile `loadout update --yes` for reviewed profile drift and
  safe active-package updates, holding disabled or risky changes for review.
- Add a pinned Chrome DevTools MCP recipe and `mcp-recipe --no-key` alongside
  Playwright MCP.

### Changed

- Daily update jobs use the unified profile-and-package update check while remaining
  read-only.
- Bound large update checks to four repositories at a time and 30 seconds per network
  operation, with readable progress in interactive CLI output.

## 0.2.3 - 2026-07-17

### Fixed

- Validate large rollback snapshots in linear, constant-stack time so project-aware activation can safely snapshot large reviewed skills.
- Preserve strict malformed-base64 rejection without relying on a stack-intensive regular expression.
- Rewrite every generated Graphify top-level lookup, repair, and optional Gemini install to the reviewed hashed artifact instead of leaving unpinned package fallbacks.

## 0.2.2 - 2026-07-17

### Fixed

- Reconcile Stable and Power to their exact managed skill sets instead of leaving skills from the previous profile active.
- Preview every managed skill that profile setup will retire and reject an apply if managed state changed after the preview.
- Snapshot retired skills in the same transaction, preserve unmanaged skills, and refuse to retire locally changed managed content.

## 0.2.1 - 2026-07-17

### Fixed

- Make Stable and Power setup safe to rerun when Loadout already owns some target skills.
- Preserve unmanaged skills and refuse to replace managed skills that changed outside Loadout.
- Verify every replacement byte and keep mixed existing/new-agent installs rollback-safe.

## 0.2.0 - 2026-07-17

### Added

- Subscription-aware onboarding with a non-secret `--api-access` declaration.
- Per-skill quarantine in Maximum Library so safe siblings remain available.
- Stored static-assessment evidence for the explainable Agent Health Score.
- Credential-gated MCP host configuration using resolved environment references only.

### Fixed

- Preserve matching active Stable units when downloading the broader Maximum Library.
- Scope collection-repository updates to the exact managed skill units.
- Prevent unrelated repository scripts from creating false update warnings or being installed.
- Reject plaintext MCP environment values during configuration verification.
- Redact accidental key-like values from setup and credential-mapping errors.

### Security

- Chat product subscriptions are no longer presented as provider API access.
- MCP-only and executable records remain explicit; broad setup still runs no third-party installer.
- Missing credentials, changed revisions, missing active units, and invalid environment references fail closed.
