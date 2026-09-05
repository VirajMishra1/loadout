# Pre-release coordination hardening

The active implementation plan is
[`docs/superpowers/plans/2026-09-05-pre-release-hardening.md`](../docs/superpowers/plans/2026-09-05-pre-release-hardening.md).

Work order:

1. Close security and Windows portability gaps.
2. Make convenience workflows exact, idempotent, and preview-first.
3. Update user and installed-agent documentation.
4. Run disposable and real-provider coordination exercises.
5. Require the full local gate and green GitHub Actions before release.

No tag or npm publication occurs until the release gate is green.
