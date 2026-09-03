# Loadout 0.9.0 release candidate

Version **0.9.0** is prepared locally and is not published yet. This file tracks
the release and launch steps and should be updated as each external step is
verified.

## Before publishing

1. Run the complete [user test guide](./docs/USER_TEST_GUIDE.md) on a disposable
   profile, then the small real-profile path you are comfortable approving.
2. Run `npm run verify:full` from a clean checkout and inspect `npm pack --dry-run`.
3. Review `CHANGELOG.md`, then replace `Unreleased` with the actual release date.
4. Merge the release candidate and create GitHub release `v0.9.0`. The release
   workflow verifies the tag, runs the full gate, and publishes with provenance.
5. Confirm `npm view loadout-ai@0.9.0 version` succeeds before announcing it.

## Repository launch setup

- Upload `docs/assets/loadout-social-preview.png` in GitHub **Settings → General →
  Social preview**. The checked-in asset is 1280×640 and centers the Claude Code
  ↔ Codex handoff.
- Enable GitHub private vulnerability reporting so the links in `SECURITY.md`
  and the issue chooser resolve to a private report form.
- Confirm Discussions is enabled only if you intend to answer questions there.
- Re-record the demo from `docs/DEMO_SCRIPT.md`; keep the current README video
  until the replacement has been watched in a signed-out browser.

## Launch claims

Lead with what the tool actually does: discover, inspect, preview, install,
activate, hand off, and roll back agent extensions. Handoff is an append-only
local task log checked at session boundaries—not a live channel. Do not claim
quota detection, automatic model switching, guaranteed safety, or independent
human review that has not happened.

## After 0.9.0

- Prototype the opt-in [live collaboration coordinator](./docs/LIVE_COLLABORATION.md).
- Start with typed contracts, ownership, cursors, and acknowledgements before
  integrating either provider SDK.
- Keep `.handoff/messages.jsonl` as the readable audit trail and preserve the
  current zero-daemon workflow for users who prefer it.
