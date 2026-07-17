# Changelog

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
