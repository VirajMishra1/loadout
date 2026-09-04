# Bounded Agent Discussions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude Code and Codex conduct a safe, bounded, auditable design discussion and record a final decision.

**Architecture:** Add one typed discussion event to the append-only coordination protocol and reconstruct thread state from those events. A provider-neutral orchestrator alternates two responders sequentially, while a thin Commander module starts or resumes concrete Claude/Codex sessions and enforces the paid-turn budget before any turn.

**Tech Stack:** TypeScript, Commander, Zod, Vitest, existing provider adapters and JSONL coordination store.

## Global constraints

- Exactly two participants and 1-8 rounds in the MVP.
- Required provider turns are `rounds * 2 + 1` and may never exceed `--max-turns`.
- Only explicit design-room responses are persisted; private reasoning is never requested or stored.
- Discussion prompts prohibit edits and command execution.
- Every provider turn is preceded by a kill-switch check.
- No new dependency.

---

### Task 1: Define the discussion protocol and state reader

**Files:**

- Modify: `src/core/coordination/events.ts`
- Create: `src/core/coordination/discussion.ts`
- Test: `tests/coordination-discussion.test.ts`

**Interfaces:**

- Produces: `discussionPayloadSchema`, `DiscussionPayload`,
  `listDiscussions(projectRoot)`, and `getDiscussion(projectRoot, threadId)`.

- [ ] Write schema/state tests for strict kinds, bounds, reply IDs, bounded lists,
      and reconstruction from real coordination events.
- [ ] Run `npx vitest run tests/coordination-discussion.test.ts` and confirm the
      missing exports fail.
- [ ] Add the event schema and minimal state reader.
- [ ] Re-run the focused test until green.

### Task 2: Implement the provider-neutral bounded orchestrator

**Files:**

- Modify: `src/core/coordination/discussion.ts`
- Modify: `src/core/coordination/adapters/types.ts`
- Test: `tests/coordination-discussion.test.ts`
- Test: `tests/coordination-adapters.test.ts`

**Interfaces:**

- Consumes: `emit(projectRoot, EmitOptions)` and participant `respond(prompt)`.
- Produces: `runDiscussion(projectRoot, options): Promise<DiscussionResult>` and
  public transcript formatting.

- [ ] Write failing tests for alternating turns, reply chains, safe prompts,
      exact turn counts, final synthesis, provider rejection, and kill switch.
- [ ] Run the focused tests and confirm behavioral failures.
- [ ] Implement the minimum sequential orchestration and discussion formatting.
- [ ] Re-run the focused suites until green.

### Task 3: Add the public CLI and provider-session bridge

**Files:**

- Create: `src/commands/coordination-discussions.ts`
- Modify: `src/commands/coordinate.ts`
- Modify: `src/core/coordination/session-manager.ts`
- Test: `tests/coordination-session-commands.test.ts`
- Test: `tests/coordination-discussion.test.ts`

**Interfaces:**

- Produces: `parseDiscussionAgents`, `parseDiscussionSessions`,
  `registerCoordinationDiscussions`, and a SessionManager-backed responder.

- [ ] Write failing parser and provider-composition tests.
- [ ] Reject invalid rounds, insufficient budgets, duplicate providers, and
      simultaneous `--agents`/`--sessions` before starting a provider session.
- [ ] Implement `start`, `list`, and `show` with JSON output.
- [ ] Run CLI and discussion focused suites until green.

### Task 4: Integrate visibility and documentation

**Files:**

- Modify: `src/core/coordination/replay.ts`
- Modify: `src/core/coordination/interrupt-policy.ts`
- Modify: `README.md`
- Modify: `docs/LIVE_COLLABORATION.md`
- Modify: `docs/USER_TEST_GUIDE.md`
- Create: `docs/decisions/003-bounded-agent-discussions.md`
- Test: `tests/coordination-replay.test.ts`
- Test: `tests/coordination-interrupt-policy.test.ts`
- Test: `tests/readme-product-flow.test.ts`

**Interfaces:**

- Consumes: additive `discussion` events.
- Produces: readable replay, safe-boundary delivery, and copy-paste user flows.

- [ ] Write failing formatting/policy/docs assertions.
- [ ] Add replay and injection visibility without changing existing semantics.
- [ ] Record why the design is bounded, sequential, and local-first.
- [ ] Run focused tests until green.

### Task 5: Release-quality verification and review

**Files:**

- Modify: `CHANGELOG.md`
- Modify: `tasks/plan.md`
- Modify: `tasks/todo.md`

- [ ] Run `npx vitest run 'tests/coordination*.test.ts'`.
- [ ] Run `npm run verify:full` and inspect every exit code and test count.
- [ ] Run `git diff --check`, inspect the complete diff for correctness,
      readability, architecture, security, and performance, and fix findings.
- [ ] Update the 0.9.0 changelog and task checklist with the verified behavior.
- [ ] Commit atomically and push the feature branch; do not tag or publish npm.
