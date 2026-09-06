# Pre-release hardening checklist

- [x] Secure template filesystem boundaries and wire template inputs/bundles.
- [x] Normalize contract detection and verification tests for Windows.
- [x] Generate exact contract candidates with current/stale state.
- [x] Normalize quick-start assignments and Git author mappings.
- [x] Keep handoff writes available during long verification processes.
- [x] Make discussion implementation linked, bundled, and idempotent.
- [x] Complete documentation and automated user-flow coverage.
- [x] Run bounded real Claude Code ↔ Codex discussion and handoff exercises.
- [x] Pass `npm run verify:full` and green Ubuntu/Windows GitHub Actions.
- [x] Review, version, tag, publish, and create the GitHub release.

## Post-0.9.1 audit

- [x] Audit Claude's post-release changes against the current source and tests.
- [x] Fix native Claude/Codex cancellation and discussion timeout propagation.
- [x] Fix read-only directory snapshot restore and permission validation.
- [x] Keep compacted coordination event sequences monotonic.
- [x] Correct shared-repository catalog drift detection and Maximum preview copy.
- [x] Apply default time bounds to generic Git sources.
- [x] Replace the stale threat-model draft with verified controls and residual risks.
- [x] Pass the complete local release gate on the audit branch.
- [x] Pass Ubuntu and Windows GitHub Actions on the audit branch.
- [x] Dogfood the packed artifact through setup, rollback, bundled handoff,
      coordination, daemon lifecycle, and a bounded real-provider release gate.
- [x] Fix and regression-test duplicate multi-path ownership output and Claude
      subprocess stdin handling found during dogfooding.
- [ ] Cut and publish a follow-up version so npm contains the post-0.9.1 fixes.
