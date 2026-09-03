# Loadout Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve every actionable weakness from the 2026-09-03 audit and leave a locally testable, release-ready Loadout tree without publishing it.

**Architecture:** Centralize bounded JSON HTTP handling, validate handoff data at its boundary, and derive CLI metadata from the Commander tree instead of parallel lists. Keep landing-page material concise while moving detailed reference content into focused documents. Reduce the two largest implementation files by extracting cohesive command and discovery responsibilities without changing their public behavior.

**Tech Stack:** TypeScript, Node.js 20+, Commander, Zod, Vitest, GitHub Actions, npm.

## Global Constraints

- Do not push, publish, tag, or create a GitHub Release; the user will test first.
- Preserve current user changes, including the pre-existing deletion of `loadout-ai-0.8.0.tgz`.
- Add no runtime dependency; use Node web streams and the existing Zod dependency.
- Every behavior change follows red-green TDD.
- Preserve Node 20, macOS, Linux, and Windows compatibility.
- Keep mutating CLI behavior preview-first and reversible.

---

### Task 1: Bound JSON network responses

**Files:**

- Create: `src/core/runtime/bounded-json.ts`
- Create: `tests/bounded-json.test.ts`
- Modify: `src/core/catalog/registry.ts`
- Modify: `src/core/agents/model-config.ts`
- Modify: `src/core/discovery/community.ts`
- Modify: `src/core/discovery/github-discovery.ts`
- Modify: `src/core/discovery/private-discovery.ts`
- Modify: `src/core/runtime/github.ts`
- Test: the existing tests for each consumer above

**Interfaces:**

- Produces: `boundedJson(fetcher, input, init, limits): Promise<{ response: Response; value: unknown }>` with required timeout and byte limits.
- Consumes: standard `fetch`, `AbortSignal.timeout`, and `ReadableStreamDefaultReader`.

- [ ] Add tests proving declared oversize, streamed oversize, malformed JSON, timeout signal composition, and exact-limit success.
- [ ] Run `npx vitest run tests/bounded-json.test.ts tests/security-regressions.test.ts` and confirm the new cases fail for the missing helper/old full-buffer behavior.
- [ ] Implement incremental stream reads that cancel above the cap and parse only after the bounded byte array is complete.
- [ ] Route every listed JSON request through the helper with endpoint-appropriate caps and 30-second defaults.
- [ ] Run all affected unit tests and confirm they pass.

### Task 2: Validate every handoff log entry

**Files:**

- Modify: `src/core/delegation/handoff.ts`
- Modify: `tests/handoff.test.ts`

**Interfaces:**

- Produces: a strict internal Zod schema matching `HandoffMessage`, including the terminal type enum and ISO timestamp.
- Consumes: existing `readMessagesDetailed` corrupt-line reporting.

- [ ] Add tests for missing timestamp/from/to/description, unsupported type, malformed resolves, and valid legacy terminal context.
- [ ] Run `npx vitest run tests/handoff.test.ts` and confirm malformed-but-valid JSON reaches the old unsafe path.
- [ ] Parse with the complete schema and report schema failures as corrupt lines without hiding valid neighbors.
- [ ] Run the handoff suite and a CLI inbox formatting test.

### Task 3: Generate complete shell command metadata

**Files:**

- Modify: `src/core/reporting/completion.ts`
- Modify: `src/cli.ts`
- Modify: `tests/completion.test.ts`
- Modify: `scripts/check-documented-commands.mjs`
- Create: `tests/documented-commands-script.test.ts`

**Interfaces:**

- Produces: recursive `CommandTree` nodes and shell completion output for every registered parent/child pair.
- Produces: a machine-readable CLI command-path mode consumed by the documentation gate.

- [ ] Add tests requiring `skills list/install/remove` in all four shells and rejecting invalid documented parent-child combinations.
- [ ] Run the focused tests and capture the expected failures.
- [ ] Render nested cases from the command tree rather than hard-coded parent names.
- [ ] Change the documentation gate to compare full command paths extracted from executable snippets against registered paths.
- [ ] Reset completion registry state per test and run focused tests green.

### Task 4: Make release verification match the release promise

**Files:**

- Modify: `package.json`
- Modify: `.github/workflows/release.yml`
- Modify: `tests/package-release.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Produces: `verify:full` that runs `verify` plus `test:coverage`.
- Consumes: release workflow tag/version and npm provenance checks.

- [ ] Add tests requiring the release job to call `verify:full` and requiring that script to include coverage.
- [ ] Run `npx vitest run tests/package-release.test.ts` and confirm failure against the old release command.
- [ ] Update scripts/workflow, and document the post-0.8 removal of model routing under Unreleased with a 0.9 migration note.
- [ ] Run release contract tests green.

### Task 5: Replace stale planning and package metadata

**Files:**

- Modify: `MASTERPLAN.md`
- Modify: `package.json`
- Modify: `tests/package-release.test.ts`

**Interfaces:**

- Produces: one current roadmap that contains no fixed vulnerabilities, removed paths, or routing feature claims.
- Produces: npm metadata aligned with GitHub positioning and search terms.

- [ ] Add metadata assertions for the canonical description and keywords.
- [ ] Run the package contract test red.
- [ ] Rewrite `MASTERPLAN.md` around remaining post-audit work and align npm description/keywords.
- [ ] Run metadata and README claim tests green.

### Task 6: Complete open-source contribution scaffolding

**Files:**

- Create: `CONTRIBUTING.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/pull_request_template.md`
- Create or modify: `tests/community-health.test.ts`
- Modify: `README.md`

**Interfaces:**

- Produces: a contributor path with exact setup, verification, security, and PR expectations.

- [ ] Add file/content contract tests and run them red.
- [ ] Add concise community files and link contribution guidance from the README.
- [ ] Run community and README tests green.

### Task 7: Make the README convert quickly

**Files:**

- Modify: `README.md`
- Create: `docs/REFERENCE.md`
- Modify: `tests/readme-product-flow.test.ts`
- Modify: `scripts/readme-product-flow.mjs`

**Interfaces:**

- Produces: a proof-first README under 400 lines with hero, first win, demo, install, handoff, trust, concise reference links, and contributor CTA.
- Produces: detailed material moved without loss to `docs/REFERENCE.md`.

- [ ] Change README structure assertions to require the demo before deep explanation and enforce the line budget.
- [ ] Run focused README tests red.
- [ ] Move detailed profiles, discovery, MCP, runtime tools, and long command tables into the reference document.
- [ ] Keep all material claims and generated marker blocks valid, then run README/evidence tests green.

### Task 8: Prepare a social preview asset

**Files:**

- Create: `docs/assets/loadout-social-preview.png`
- Modify: `tests/readme-product-flow.test.ts`

**Interfaces:**

- Produces: solid-background 1280x640 PNG under 1 MB for manual upload in GitHub Settings.

- [ ] Add dimension, format, and size assertions and run them red while the asset is absent.
- [ ] Generate a concise social card using the established visual language and handoff differentiator.
- [ ] Optimize without reducing readability and run asset tests green.

### Task 9: Split oversized modules along existing responsibilities

**Files:**

- Modify: `src/commands/catalog.ts`
- Create: `src/commands/catalog-skills.ts`
- Create: `src/commands/catalog-discovery.ts`
- Modify: `src/core/discovery/candidate-intelligence.ts`
- Create: `src/core/discovery/candidate-signals.ts`
- Create: `src/core/discovery/candidate-report.ts`
- Test: existing catalog, discovery, candidate, CLI help, and completion suites

**Interfaces:**

- Produces: command registration functions imported by `catalog.ts` with no CLI contract change.
- Produces: pure candidate signal/report helpers imported by candidate intelligence.

- [ ] Record current CLI/help and candidate JSON fixtures through existing behavior tests.
- [ ] Extract command groups without changing option names, output, or action wiring.
- [ ] Extract pure candidate scoring/reporting groups and keep exported compatibility.
- [ ] Require each former 1,000-line hotspot to fall below 850 lines.
- [ ] Run all catalog/discovery/CLI suites green and scan for orphaned exports.

### Task 10: Final review and local release rehearsal

**Files:**

- Review: every changed file
- Modify only defects found by review

**Interfaces:**

- Consumes: all previous task outputs.
- Produces: a local release candidate for the user to test.

- [ ] Run Prettier, lint, typecheck, dependency audit, documentation/evidence gates, all unit tests, E2E flows, package smoke, performance benchmark, and coverage.
- [ ] Run `npm pack --dry-run --json` and install the resulting local package in a disposable directory.
- [ ] Review correctness, readability, architecture, security, and performance; fix every required finding with red-green coverage.
- [ ] Run `loadout handoff codex`, verify no pending tasks, and report exact remaining manual steps without publishing.

## Risks and Mitigations

| Risk                                                    | Impact | Mitigation                                                                                   |
| ------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| Shared working tree edits collide                       | High   | Assign agents disjoint file sets and integrate only after reviewing diffs.                   |
| README claim markers break during shortening            | High   | Move content around marker blocks intact and run both claim gates after each edit.           |
| Generic fetch helper changes mock behavior              | Medium | Preserve injectable fetchers and test standard Response streams plus mocked consumers.       |
| Command extraction changes Commander registration order | Medium | Snapshot public help/command paths before extraction and assert exact equivalence.           |
| Social preview is not automatically active              | Low    | Deliver the validated file and clearly leave GitHub Settings upload as the only manual step. |

## Self-Review

- Every audit weakness maps to Tasks 1–9.
- No task publishes or mutates remote repository state.
- Each behavior change includes an explicit failing-test step and focused verification.
- Shared interfaces are named before parallel implementation.
- No placeholders or deferred implementation steps remain.
