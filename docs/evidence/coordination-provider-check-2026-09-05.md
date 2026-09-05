# Bounded provider coordination check — 2026-09-05

This release check used the locally installed Claude Code 2.1.245 and the
bundled Codex adapter. It intentionally consumed real provider quota. No source
file was edited by either provider.

## Design discussion

- Thread: `prerelease-contract-validation-20260905`
- Budget: three turns; used: three turns
- Lifecycle: Claude proposal → Codex critique → Claude synthesis → closed
- Decision: publish exact source declarations as a labeled convenience
  snapshot while keeping the canonical source path and export name authoritative.
- Persisted result: five public discussion events, including the decision,
  rationale, alternatives, and unresolved evidence gaps.

## Durable handoff pickup

The test ran in a disposable repository and sent Claude Code a task with one
bundled text fixture and manual verification criteria.

- Task ID: `baeceff7`
- Expected fixture token: `cobalt-otter-47`
- First print-mode run: Claude recovered the task and token, but the native
  permission gate denied the completion command.
- Least-privilege rerun: `--allowedTools='Bash(node /absolute/path/to/loadout handoff *),Read'`
- Result: Claude appended a `done` message resolving `baeceff7`, with passed
  manual evidence `cobalt-otter-47`; the inbox then reported zero pending tasks.
- Integrity check: the fixture content was unchanged.

This proves the maintained build can transfer bounded source context from Codex
to Claude Code and receive a verified completion. It does not claim hidden
reasoning sharing, mid-turn provider injection, or universal host compatibility.
