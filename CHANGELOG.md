# Changelog

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
