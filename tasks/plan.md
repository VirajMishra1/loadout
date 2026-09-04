# Handoff reliability plan

Safe bundles are complete in commit `caa2019`. The active specification is
[`docs/specs/HANDOFF_VERIFICATION.md`](../docs/specs/HANDOFF_VERIFICATION.md)
and its implementation plan is
[`docs/superpowers/plans/2026-09-04-handoff-verification.md`](../docs/superpowers/plans/2026-09-04-handoff-verification.md).

Work order:

1. Extend the durable task contract with bounded criteria and evidence.
2. Add explicit, shell-free completion checks and nonterminal failures.
3. Wire safe CLI options and receiver-visible feedback.
4. Update user and agent documentation.
5. Run release-level verification and review before another commit.

This branch does not tag, publish, or merge itself.
