# Safe Handoff Context Bundles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit, bounded, secret-redacted file snapshots to durable handoff tasks without breaking existing logs or callers.

**Architecture:** A focused `handoff-bundle` module validates and snapshots files before the task is appended. `handoff.ts` stores only a typed reference in JSONL, while the versioned bundle lives in `.handoff/bundles/` and is loaded for receiver display or direct inspection. Commander composes both operations and preserves the existing no-bundle path.

**Tech Stack:** TypeScript, Node.js filesystem/crypto/path APIs, Commander, Zod, Vitest.

## Global constraints

- No new runtime dependencies.
- Maximum 20 files, 32 KiB stored content per file, and 50 KiB total.
- Never follow symlinks, leave the repository, read binary files, or bundle `.git/`/`.handoff/`.
- Redact before persistence; write owner-only bundle files atomically.
- Keep existing handoff messages and callers backward compatible.

---

### Task 1: Define and persist safe bundles

**Files:**

- Create: `src/core/delegation/handoff-bundle.ts`
- Create: `tests/handoff-bundle.test.ts`

**Interfaces:**

- Produces: `createHandoffBundle(projectRoot, taskId, requestedPaths)`
- Produces: `readHandoffBundle(projectRoot, reference)`
- Produces: bundle types and exported limits

- [ ] Write the failing happy-path test and observe the missing module failure.
- [ ] Implement strict schemas, path validation, bounded UTF-8 reads, redaction,
      atomic persistence, and validated reads.
- [ ] Add red-green tests for path escapes, internal state, symlinks,
      directories, binary/missing files, limits, Unicode, and corruption.
- [ ] Run `npm test -- tests/handoff-bundle.test.ts`.

### Task 2: Extend the message protocol and receiver output

**Files:**

- Modify: `src/core/delegation/handoff.ts`
- Modify: `tests/handoff.test.ts`

**Interfaces:**

- Consumes: `HandoffBundleReference`
- Produces: optional `bundle` on messages and send options
- Produces: resolved bundle summaries in inbox output

- [ ] Write a failing round-trip test for a bundle reference plus a legacy task.
- [ ] Add the optional strict field and run the test.
- [ ] Write a failing output test for bundle metadata and trust warning.
- [ ] Implement async inbox display loading while preserving old output.
- [ ] Run both focused suites.

### Task 3: Add the public CLI option

**Files:**

- Modify: `src/commands/catalog-workflows.ts`
- Create or modify: `tests/cli-handoff.test.ts`

**Interfaces:**

- Consumes: `--bundle <paths...>`
- Produces: bundle metadata in JSON and concise text confirmation

- [ ] Write and observe a failing CLI happy-path test.
- [ ] Add the variadic option and compose bundle creation before task append.
- [ ] Remove a newly created orphan bundle if message persistence fails.
- [ ] Add an invalid-path test proving there is no partial task.
- [ ] Run CLI and handoff focused suites.

### Task 4: Document receiver behavior and manual testing

**Files:**

- Modify: `README.md`
- Modify: `docs/REFERENCE.md`
- Modify: `docs/USER_TEST_GUIDE.md`
- Modify: `skills/loadout-handoff/SKILL.md`
- Modify: `src/core/delegation/handoff.ts`

**Interfaces:**

- Documents: exact command, limits, local persistence, and trust model

- [ ] Add the command near the existing handoff quick start.
- [ ] Document limits and failure modes in the reference.
- [ ] Add a disposable-repository test for redaction and pickup.
- [ ] Teach agents to inspect the bundle as untrusted project data.
- [ ] Run documentation and first-party skill checks.

### Task 5: Verify and review

**Files:**

- Modify: `tasks/plan.md`
- Modify: `tasks/todo.md`

- [ ] Run formatting, lint, typecheck, full verification, and inspect exits.
- [ ] Review correctness, security, maintainability, performance, and tests.
- [ ] Fix findings through new failing tests.
- [ ] Run `loadout handoff codex` per repository instructions.
- [ ] Commit the verified branch without tagging or publishing.
