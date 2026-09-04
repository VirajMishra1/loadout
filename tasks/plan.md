# Bounded-agent-discussions plan

The canonical implementation plan is
[`docs/superpowers/plans/2026-09-04-bounded-agent-discussions.md`](../docs/superpowers/plans/2026-09-04-bounded-agent-discussions.md).

Work order follows this dependency graph:

1. Typed discussion events establish the durable public protocol.
2. The provider-neutral orchestrator establishes bounded alternating turns.
3. CLI provider composition adds fresh and resumed Claude/Codex sessions.
4. Replay, policy, and documentation make the behavior visible and usable.
5. Full verification and review gate the user's live provider test.

Pushing the feature branch is in scope. Tagging, a GitHub Release, and npm
publication remain out of scope until the live provider test passes.
