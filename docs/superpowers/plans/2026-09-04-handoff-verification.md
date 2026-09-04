# Handoff Verification Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make handoff completion evidence-backed while keeping execution explicit, bounded, redacted, and shell-free.

**Architecture:** Extend the JSONL message contract additively, then put command execution and state transitions in a dedicated verification module. The CLI validates option combinations and invokes verification only on an explicit completion command. Failed checks write a nonterminal status event, so the original task remains actionable.

**Tech Stack:** TypeScript, Node.js child processes, Zod, Commander, Vitest.

## Global constraints

- No shell strings, automatic retries, provider turns, or new dependencies.
- A stored command requires explicit `--run-verification` approval at completion.
- Preserve legacy handoff behavior.
- Bound and redact every persisted output.
- Every behavior follows a red-green test cycle.

### Task 1: Add typed verification and evidence fields

**Files:** `src/core/delegation/handoff.ts`, `tests/handoff.test.ts`

- [ ] Write a failing round-trip test for verification and evidence.
- [ ] Add strict bounded optional schemas and types.
- [ ] Render criteria and command argv in the task inbox.
- [ ] Verify legacy logs still parse.

### Task 2: Implement explicit completion verification

**Files:** `src/core/delegation/handoff-verification.ts`,
`tests/handoff-verification.test.ts`

- [ ] Write a failing passing-command test with an injected runner.
- [ ] Implement pass → `done` and fail → nonterminal `status` transitions.
- [ ] Add red-green cases for manual evidence, missing evidence, nonzero exit,
      timeout, spawn error, output truncation, and secret redaction.
- [ ] Keep `markDone` compatible for tasks without criteria and make it refuse
      to bypass criteria.

### Task 3: Wire and document the CLI

**Files:** `src/commands/catalog-workflows.ts`, `tests/cli-handoff.test.ts`,
`README.md`, `docs/REFERENCE.md`, `docs/USER_TEST_GUIDE.md`,
`skills/loadout-handoff/SKILL.md`, `CHANGELOG.md`

- [ ] Test and add `--verify`, `--verify-command`, `--verify-timeout`, and
      `--evidence`.
- [ ] Validate incompatible combinations before writing a task.
- [ ] Show pass/fail evidence in text and JSON output.
- [ ] Document the exact trust boundary and lack of autonomous retries.

### Task 4: Verify and commit

- [ ] Run focused tests, formatting, lint, typecheck, `npm run verify:full`, and
      a five-axis review.
- [ ] Commit and push the isolated incremental change without publishing.
