# Release-readiness plan

The canonical implementation plan is
[`docs/superpowers/plans/2026-09-03-release-readiness.md`](../docs/superpowers/plans/2026-09-03-release-readiness.md).

Work order follows this dependency graph:

1. Network bounds and handoff validation establish safe external boundaries.
2. Derived CLI metadata and release gates establish trustworthy automation.
3. Metadata, community files, README conversion, and social preview establish the launch surface.
4. Module extraction occurs behind existing behavioral tests.
5. Full verification and a local package rehearsal gate the user's manual test.

No remote push, tag, release, or npm publication is part of this plan.
