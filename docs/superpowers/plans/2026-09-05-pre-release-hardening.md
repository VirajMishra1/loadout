# Pre-release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the new handoff and coordination workflows secure, cross-platform, truthful, documented, and proven through a real Claude Code ↔ Codex exercise before publishing Loadout 0.10.0.

**Architecture:** Keep the existing append-only handoff and coordination logs. Add validation and normalization at filesystem and CLI boundaries, make multi-write workflows preflighted and idempotent, and represent generated contracts as exact source declarations plus a source hash rather than placeholder stubs. Preserve dry-run defaults and require explicit approval for writes or provider turns.

**Tech Stack:** TypeScript ESM, Commander, Zod, Node.js standard library, Vitest, GitHub Actions.

## Global Constraints

- Node.js 20 or newer on Ubuntu and Windows.
- No new runtime dependencies.
- No shell execution for handoff verification.
- All mutating convenience commands remain preview-first.
- Handoff and coordination logs remain append-only.
- Do not publish npm, create a tag, or create a GitHub release until every gate is green.

---

### Task 1: Secure and complete handoff templates

**Files:**

- Modify: `src/core/delegation/handoff-templates.ts`
- Modify: `src/commands/catalog-workflows.ts`
- Test: `tests/handoff-templates.test.ts`
- Test: `tests/cli-handoff.test.ts`

**Interfaces:**

- Produces: validated template names for every read/write/delete operation.
- Produces: positional task words bound to `{{files}}` or `{{description}}`, with template bundle paths forwarded to handoff bundle creation.

- [ ] Add a regression test proving `deleteTemplate(root, "../../package")` rejects and preserves `package.json`.
- [ ] Run `npm test -- tests/handoff-templates.test.ts` and confirm that regression fails because deletion escapes the template directory.
- [ ] Validate names through the existing Zod name schema before constructing paths.
- [ ] Add CLI tests proving `--template write-tests src/auth.ts` sends `Write tests for src/auth.ts` and that template bundle paths reach the stored bundle reference.
- [ ] Run the CLI tests and confirm they fail with the current task override and unused `bundleGlobs` behavior.
- [ ] Bind positional words to the template's first recognized placeholder and merge explicit `--bundle` values ahead of template defaults.
- [ ] Run both focused files and confirm they pass.

### Task 2: Restore Windows portability

**Files:**

- Modify: `src/core/coordination/auto-contract.ts`
- Modify: `tests/auto-contract.test.ts`
- Modify: `tests/handoff-verification.test.ts`

**Interfaces:**

- Produces: project-relative paths normalized to `/` at the scanner boundary.
- Produces: cwd verification that compares filesystem identity rather than long-path spelling.

- [ ] Add tests for ownership and import resolution using normalized Windows-style paths.
- [ ] Confirm the new test fails because `relative()` output is consumed without normalization.
- [ ] Normalize scanned paths and scope inputs, deduplicate scoped results, and keep all resolved imports project-relative.
- [ ] Replace the short-path string equality assertion with a child-process filesystem identity check using a marker file in the project root.
- [ ] Run focused tests locally, then push only after the complete suite passes so GitHub Windows CI can supply the authoritative Windows result.

### Task 3: Publish exact contract candidates

**Files:**

- Modify: `src/core/coordination/auto-contract.ts`
- Modify: `src/commands/coordinate.ts`
- Test: `tests/auto-contract.test.ts`

**Interfaces:**

- Produces: `ContractCandidate` with exact `suggestedBody`, `sourceHash`, and coverage state `uncovered | current | stale`.

- [ ] Change tests to require exact exported declarations rather than `/* ... */` or `unknown` placeholders.
- [ ] Confirm they fail against the regex stub generator.
- [ ] Extract complete single-line declarations conservatively; mark unsupported multiline/runtime exports as manual rather than inventing a signature.
- [ ] Hash the canonical source declaration set and embed the source path/hash in generated contract metadata.
- [ ] Require `--publish --yes`; refuse candidates containing manual placeholders and report stale contracts rather than calling them covered.
- [ ] Test exact, stale, manual, preview, and approved-publication paths.

### Task 4: Make coordination setup reliable

**Files:**

- Modify: `src/core/coordination/quick-start.ts`
- Modify: `src/commands/coordinate.ts`
- Test: `tests/coordination-quick-start.test.ts`

**Interfaces:**

- Produces: normalized, non-overlapping ownership assignments and a preflight result that never partially applies.

- [ ] Add tests excluding generated directories, collapsing child paths beneath an assigned parent, rejecting empty agents/unknown split names, and refusing incomplete existing ownership with a clear preview.
- [ ] Confirm the tests fail against the current directory splitter.
- [ ] Normalize assignments, validate options, preflight all conflicts, and append claims only after every assignment is valid.
- [ ] Run focused coordination tests.

### Task 5: Repair Git-aware ownership semantics

**Files:**

- Modify: `src/core/coordination/git-ownership.ts`
- Modify: `src/commands/coordinate.ts`
- Test: `tests/git-ownership.test.ts`

**Interfaces:**

- Consumes: explicit mappings shaped as `agent=Git Author`.
- Produces: confidence calculated against all authors that touched a directory.

- [ ] Add tests showing unselected human commits remain in the confidence denominator and an explicit agent-author mapping returns the agent identity.
- [ ] Confirm both tests fail with author filtering.
- [ ] Scan all authors, map configured authors to agents after counting, validate depth/threshold/max-commits, and keep dry-run output explicit.
- [ ] Run focused ownership tests.

### Task 6: Close the discussion-to-implementation loop

**Files:**

- Modify: `src/core/coordination/discussion-pipeline.ts`
- Modify: `src/commands/coordination-discussions.ts`
- Test: `tests/discussion-pipeline.test.ts`

**Interfaces:**

- Produces: deterministic plan ID, handoff IDs, bundle paths, verification criteria, and an implementation event linking the discussion to created tasks.

- [ ] Add tests for idempotent reruns, bundles, verification criteria, unassigned-path refusal, and no partial writes after failed preflight.
- [ ] Confirm those tests fail against the current sequential sender.
- [ ] Build the complete plan before writing, reject unresolved ownership in approved mode, reuse the safe bundle builder, attach verification criteria, and record created task IDs.
- [ ] Make repeated execution return the existing recorded result rather than duplicate tasks.
- [ ] Run focused pipeline and coordination tests.

### Task 7: Avoid locking during verification processes

**Files:**

- Modify: `src/core/delegation/handoff-verification.ts`
- Test: `tests/handoff-verification.test.ts`

**Interfaces:**

- Produces: optimistic completion flow: locked read → unlocked process → locked compare-and-append.

- [ ] Add a test with a blocked verification runner proving another handoff can be sent while verification is running, plus a race test proving only one terminal completion wins.
- [ ] Confirm the send test times out/fails while the current implementation holds the lock.
- [ ] Snapshot the task verification definition under lock, run outside the lock, then reacquire and reject already-settled or changed tasks before appending evidence.
- [ ] Run handoff concurrency and verification tests.

### Task 8: Document, test as users, and release-gate

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/REFERENCE.md`
- Modify: `docs/LIVE_COLLABORATION.md`
- Modify: `docs/USER_TEST_GUIDE.md`
- Modify: `docs/FEATURE_TEST_MATRIX.md`
- Modify: `skills/loadout-handoff/SKILL.md`
- Modify: `tasks/plan.md`
- Modify: `tasks/todo.md`

**Interfaces:**

- Produces: one beginner workflow covering setup → contract detection → discussion → bundled verified handoffs.

- [ ] Document every new command, its preview/apply boundary, limitations, and exact examples.
- [ ] Update the agent skill so Claude Code and Codex use the convenience commands safely.
- [ ] Add documentation-claim tests for the workflow and update the release matrix.
- [ ] Run a disposable repository flow covering templates, bundles, coordination setup, exact contracts, decision implementation, verification failure, retry, and completion.
- [ ] Run an explicitly authorized bounded Claude Code ↔ Codex exercise and inspect its recorded transcript/task linkage without exposing private reasoning.
- [ ] Run `npm run verify:full`, push the branch, and require green GitHub Actions on Ubuntu and Windows.
- [ ] Review the entire diff across correctness, readability, architecture, security, and performance; leave publishing for a separate explicitly verified release action.
