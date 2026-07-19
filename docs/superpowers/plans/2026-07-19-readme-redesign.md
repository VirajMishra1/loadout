# Loadout README Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Loadout's manual-style README with a concise, original, evidence-bounded GitHub front page and slot-plus-terminal visual identity.

**Architecture:** Keep the README human-authored but retain six machine-owned fact blocks. Compact the two table-heavy generated blocks at their source, move README-only operational detail into existing docs, and render a dependency-free SVG hero asset. Existing evidence and command gates remain the authority for claims.

**Tech Stack:** Markdown, SVG 1.1-compatible XML, TypeScript, Node.js 20+, Vitest, Prettier, GitHub Actions.

## Global Constraints

- Product line: `Agent extensions, under control.`
- Journey: `Choose -> Inspect -> Preview -> Apply -> Undo` in that order.
- Use only a private source-checkout installation; `loadout-ai@0.3.2` is not currently published.
- Do not claim universal safety, production readiness, native-agent execution, human review, benchmarked catalog sources, or that pins prove trust.
- Keep exactly one ordered marker pair for `catalog-coverage`, `evidence-stages`, `daily-discovery`, `support-summary`, `current-limits`, and `verification-summary`.
- Preserve useful information in linked docs before shortening the README.
- No copied artwork, generated fake screenshot, animation, external font, or new runtime dependency.

---

### Task 1: Compact generated README facts

**Files:**
- Modify: `scripts/update-readme-facts.mjs`
- Modify: `tests/readme-facts-script.test.ts`

**Interfaces:**
- Consumes: catalog coverage, adapter conformance, package scripts.
- Produces: the same five named marker bodies, with evidence and support rendered as concise linked summaries instead of tables.

- [ ] Add failing expectations that the evidence-stage block links to catalog policy and contains no Markdown table, and the support block contains `**12 agents**`, links to the complete matrix, states the configured-path/native-execution boundary, and contains no per-agent table rows.
- [ ] Run `npm test -- --run tests/readme-facts-script.test.ts` and confirm the new expectations fail against the table renderers.
- [ ] Replace only the evidence-stage and support renderers with compact prose derived from the same source facts.
- [ ] Run the focused test, `npm run readme:update`, and `npm run readme:check`.
- [ ] Commit as `docs: compact generated README facts`.

### Task 2: Preserve operational detail in deeper documentation

**Files:**
- Modify: `docs/TESTING.md`
- Modify: `docs/USER_TEST_GUIDE.md`
- Modify: `docs/REPOSITORY_STABILIZATION.md`
- Modify: `tests/readme-product-flow.test.ts`

**Interfaces:**
- Consumes: the current README harness, troubleshooting, and historical README-research prose.
- Produces: stable destinations the new README can link to without losing useful detail.

- [ ] Add the mixed core-integration/CLI verification scope to `docs/TESTING.md`, including isolated build, disposable state, offline fixture, direct core calls, CLI subprocesses, and explicit limits.
- [ ] Add source-link/PATH, risk approval, rollback refusal, network, diagnostics, and complete-uninstall troubleshooting to `docs/USER_TEST_GUIDE.md`.
- [ ] Add the eight immutable README research references and note that the complete adapter table moved out of the front page.
- [ ] Change `tests/readme-product-flow.test.ts` to require the concise README link to `docs/TESTING.md` while keeping its executable outcome assertions.
- [ ] Run `npm test -- --run tests/readme-product-flow.test.ts` and commit as `docs: preserve README reference detail`.

### Task 3: Create and verify the visual identity

**Files:**
- Create: `docs/assets/loadout-mark.svg`

**Interfaces:**
- Produces: one accessible, dependency-free, monochrome loadout-slot plus terminal-prompt mark referenced by the README.

- [ ] Draw five compact outlined inventory slots and put `>_` in the selected slot; add `<title>` and `<desc>`.
- [ ] Validate the XML and render PNG previews on white and near-black backgrounds using an available SVG renderer.
- [ ] Inspect both previews at hero and small sizes for clipping, contrast, and legibility.
- [ ] Run Prettier against the SVG and commit as `docs: add Loadout visual identity`.

### Task 4: Rewrite the README around the product journey

**Files:**
- Modify: `README.md`
- Modify if required by exact claim wording: `docs/evidence/readme-claims.json`

**Interfaces:**
- Consumes: captured disposable Stable output, generated fact blocks, the new mark, and deeper documentation from Task 2.
- Produces: the concise GitHub front page defined by the design specification.

- [ ] Replace the opening with the centered mark/name, product line, bounded definition, three badges, and compact navigation.
- [ ] Add the five-stage journey and an explicitly abridged terminal transcript whose retained lines match the disposable `--agents codex` Stable preview/apply/rollback output; explain that preview may populate Loadout cache but leaves agent files unchanged.
- [ ] Add three benefits, source installation, `loadout demo`, Stable workflow, compact profiles, trust/limits, support, commands, development, docs, contributing/security/attribution, and license sections.
- [ ] Preserve all required marker pairs and required bounded claim-gate phrases, including the unavailable `npm install --global loadout-ai@0.3.2` target.
- [ ] Run `npm run readme:update`, `npm run readme:check`, `npm run check:evidence`, and focused README tests.
- [ ] Compare `wc -l -w -c README.md` against the 411-line/2,511-word baseline and commit as `docs: redesign README front page`.

### Task 5: Verify, review, and integrate

**Files:**
- Modify only files required to resolve review or verification findings.

**Interfaces:**
- Produces: reviewed remote `main` with no temporary branch.

- [ ] Validate every local Markdown link and heading anchor, README commands against built help, SVG XML, generated marker freshness, and both rendered SVG contexts.
- [ ] Run `npm ci`, `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run check:evidence`, `npm test -- --run`, `npm run test:e2e:cli`, `npm run test:e2e:readme`, `npm run test:package`, `npm run test:performance`, `npm run verify:full`, and `git diff --check`.
- [ ] Obtain independent factual, hierarchy/concision, link/command, accessibility, and rendered-visual review; fix every Critical and Important finding and re-review.
- [ ] Remove the temporary design/implementation plan files if they no longer have current value; preserve their history and retain `docs/README_RESEARCH.md`.
- [ ] Push `codex/readme-redesign`, open a ready PR with rendered previews, wait for Actions, resolve remote failures, and merge only when green.
- [ ] Delete the local/remote feature branch, clone final remote `main` into a new directory, rerun README/evidence/full verification, and report final evidence.

