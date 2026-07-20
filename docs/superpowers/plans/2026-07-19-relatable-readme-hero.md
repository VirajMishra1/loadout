# Relatable README and Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Viraj's Loadout repository a relatable, evidence-bounded story and original GitHub-ready hero while correcting canonical repository metadata and preserving all existing truth gates.

**Architecture:** Keep the README human-authored around the existing six machine-owned fact blocks. Add one dependency-free SVG hero under `docs/assets/`, strengthen only the README and metadata contracts that intentionally change, and leave the required CI workflow untouched because its failed job was blocked before execution by GitHub account billing.

**Tech Stack:** Markdown, SVG/XML, TypeScript, Vitest, Node.js 20+, Prettier, Playwright, GitHub Actions.

## Global Constraints

- Base every change on `VirajMishra1/loadout` `main` at `194676910327176272ebe42982d13c6e8246f0aa`.
- Canonical repository identity is `VirajMishra1/loadout`; preserve dated historical fork evidence where it is explicitly historical.
- Keep exactly one ordered marker pair for `catalog-coverage`, `evidence-stages`, `daily-discovery`, `current-limits`, `support-summary`, and `verification-summary`.
- Preserve the unpublished `0.3.2` warning, preview/apply recomputation boundary, catalog evidence limits, native-host boundary, security statements, installation requirements, and existing executable product-flow proof.
- Do not claim the GitHub billing/spending-limit failure is reproducible locally; its job executed zero steps.
- Do not modify `.github/workflows/ci.yml`, delete/skip/weaken tests, add dependencies, copy Ponytail artwork, or add decorative badges.
- Deliver an unmerged ready pull request against Viraj's `main`.

---

### Task 1: Correct canonical repository identity

**Files:**

- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/evidence/live-checks.schema.json`
- Modify: `tests/live-evidence.test.ts`
- Modify: `tests/readme-product-flow.test.ts`

**Interfaces:**

- Consumes: canonical repository identity `VirajMishra1/loadout`.
- Produces: package metadata, README visitor links, schema identity, and regression expectations that agree on the canonical upstream.

- [ ] **Step 1: Add failing canonical-identity assertions**

  In `tests/readme-product-flow.test.ts`, load `package.json` and `docs/evidence/live-checks.schema.json` alongside the README and assert:

  ```ts
  expect(readme).toContain(
    "https://github.com/VirajMishra1/loadout/actions/workflows/ci.yml",
  );
  expect(readme).toContain(
    "git clone https://github.com/VirajMishra1/loadout.git",
  );
  expect(readme).toContain("https://github.com/VirajMishra1/loadout/issues");
  expect(readme).not.toContain("https://github.com/reddynitish/loadout");
  expect(packageJson.repository.url).toBe(
    "git+https://github.com/VirajMishra1/loadout.git",
  );
  expect(packageJson.homepage).toBe(
    "https://github.com/VirajMishra1/loadout#readme",
  );
  expect(packageJson.bugs.url).toBe(
    "https://github.com/VirajMishra1/loadout/issues",
  );
  expect(schema.$id).toBe(
    "https://github.com/VirajMishra1/loadout/docs/evidence/live-checks.schema.json",
  );
  ```

  Update the intentional `packageJson` fixture in `tests/live-evidence.test.ts` to Viraj only after observing the new repository-contract test fail; the fixture change follows production metadata and does not change live-check behavior.

- [ ] **Step 2: Run the focused test and confirm RED**

  Run:

  ```bash
  npm test -- --run tests/readme-product-flow.test.ts
  ```

  Expected: failure showing at least the current fork CI/clone/issue or package metadata URL.

- [ ] **Step 3: Apply the smallest canonical URL changes**

  Replace only current canonical fork destinations in the listed files. Do not change the historical fork observations or dated fork CI evidence in `docs/REPOSITORY_STABILIZATION.md`.

- [ ] **Step 4: Verify focused behavior and formatting**

  Run:

  ```bash
  npm test -- --run tests/readme-product-flow.test.ts tests/live-evidence.test.ts
  npm run readme:check
  npx prettier --check README.md package.json docs/evidence/live-checks.schema.json tests/live-evidence.test.ts tests/readme-product-flow.test.ts
  git diff --check
  ```

  Expected: both focused files pass; generated README blocks remain current; formatting and diff checks pass.

- [ ] **Step 5: Commit**

  ```bash
  git add README.md package.json docs/evidence/live-checks.schema.json tests/live-evidence.test.ts tests/readme-product-flow.test.ts
  git commit -m "fix: restore Viraj repository identity"
  ```

### Task 2: Create and render the original hero

**Files:**

- Create: `docs/assets/loadout-hero.svg`

**Interfaces:**

- Produces: accessible, dependency-free, theme-aware hero consumed by the README in Task 3.

- [ ] **Step 1: Draw the approved composition**

  Create a wide SVG with a developer choosing one extension tile between an unmanaged cluster and five organized loadout slots. Use original basic geometry and path-drawn symbols; include:

  ```xml
  role="img"
  aria-labelledby="loadout-hero-title loadout-hero-description"
  <title id="loadout-hero-title">Choose an intentional agent loadout</title>
  <desc id="loadout-hero-description">A developer moves an extension from scattered configuration tiles into organized managed equipment slots.</desc>
  ```

  Use `currentColor`, an internal dark-scheme color override, a wide `viewBox`, and no external content, fonts, scripts, raster images, gradients, or animation.

- [ ] **Step 2: Validate source structure**

  Run:

  ```bash
  xmllint --noout docs/assets/loadout-hero.svg
  xmllint --xpath 'count(/*[local-name()="svg"]/*[local-name()="title"]) = 1 and count(/*[local-name()="svg"]/*[local-name()="desc"]) = 1' docs/assets/loadout-hero.svg
  rg -n '<script|<image|<animate|<foreignObject|font-family|(?:href|src)="https?://' docs/assets/loadout-hero.svg
  ```

  Expected: XML and XPath checks succeed; the forbidden-content search has no matches.

- [ ] **Step 3: Render four visual contexts**

  Use the existing Playwright/Chromium dependency or an available SVG renderer to produce untracked PNG previews at approximately 720×225 and 360×113 on white and `#0d1117` backgrounds. Store previews under `/tmp/loadout-hero-preview/`, never in the repository.

- [ ] **Step 4: Inspect and iterate**

  Inspect all four images at original resolution. Confirm the unmanaged cluster, developer selection gesture, management boundary, five slots, and path-drawn symbols remain distinct; text/symbols are legible; no geometry clips; and contrast works in both themes. Iterate until every check passes.

- [ ] **Step 5: Format and commit**

  Run:

  ```bash
  npx prettier --parser html --check docs/assets/loadout-hero.svg
  git diff --check
  git add docs/assets/loadout-hero.svg
  git commit -m "docs: add intentional loadout hero"
  ```

### Task 3: Add the relatable story and stronger hero contract

**Files:**

- Modify: `README.md`
- Modify: `tests/readme-product-flow.test.ts`

**Interfaces:**

- Consumes: `docs/assets/loadout-hero.svg` from Task 2.
- Produces: first-visitor README hierarchy with a genuine loadout metaphor and verified hero reference.

- [ ] **Step 1: Add failing story/hero assertions**

  Replace the old mark assertion with:

  ```ts
  expect(readme).toContain("./docs/assets/loadout-hero.svg");
  expect(readme).toMatch(/skills, plugins, MCP servers, and agent settings/i);
  expect(readme).toMatch(
    /loadout is the deliberate set of tools chosen before a mission/i,
  );
  expect(readme).toMatch(
    /what is installed, where it came from, or how to undo it/i,
  );
  expect(readme).not.toMatch(/founder|revolutionary|game-changing/i);
  ```

  Also require the README hero alt text to mention a developer and organized loadout slots.

- [ ] **Step 2: Run the focused test and confirm RED**

  Run:

  ```bash
  npm test -- --run tests/readme-product-flow.test.ts
  ```

  Expected: failure on the absent hero reference or metaphor paragraph.

- [ ] **Step 3: Update only the intended README sections**

  Replace the top image with `./docs/assets/loadout-hero.svg`, a width appropriate for the wide asset, and meaningful alt text. Add the approved concise paragraph under `## Why Loadout`, followed by the existing three bullets. Do not change the verified journey, transcript, warnings, generated blocks, trust boundaries, installation requirements, or unrelated hierarchy.

- [ ] **Step 4: Refresh and verify README contracts**

  Run:

  ```bash
  npm run readme:update
  npm run readme:check
  npm run check:evidence
  npm test -- --run tests/readme-product-flow.test.ts tests/readme-facts-script.test.ts tests/readme-claims.test.ts
  npx prettier --check README.md tests/readme-product-flow.test.ts
  git diff --check
  ```

  Expected: generated blocks current, evidence gate reports zero contradictions, focused tests pass, and no unrelated README section moves.

- [ ] **Step 5: Commit**

  ```bash
  git add README.md tests/readme-product-flow.test.ts
  git commit -m "docs: explain the Loadout metaphor"
  ```

### Task 4: Verify failure boundary, render, links, and full repository

**Files:**

- Modify only files needed to resolve verified findings.

**Interfaces:**

- Produces: reviewed branch and unmerged upstream pull request.

- [ ] **Step 1: Reconfirm the failed Actions evidence**

  Use `gh` to confirm run `29708871932`, job `88250042904`, zero job steps, and the billing/spending-limit annotation. Record that no repository command ran and therefore the external failure cannot be reproduced locally.

- [ ] **Step 2: Run every intended required-job command locally**

  Run, separately and read each exit code:

  ```bash
  npm ci
  npm run format:check
  npm run lint
  npm run typecheck
  node scripts/check-catalog-attribution.mjs
  node scripts/check-discovery-artifacts.mjs
  npm test -- --run
  npm run test:e2e:cli
  npm run test:package
  npm run test:performance
  ```

  Expected: every command exits zero. `npm test -- --run` is the exact test command the blocked workflow intended to execute.

- [ ] **Step 3: Run repository verification entry points**

  Run:

  ```bash
  npm run verify
  npm run verify:full
  ```

  If the combined Playwright wrapper does not return a reliable completion code, run `npm run test:e2e:dashboard` separately and require its explicit success.

- [ ] **Step 4: Validate links, XML, and final renders**

  Check every README relative file target and heading fragment with a focused script, validate SVG XML/accessibility/forbidden content, re-render all four hero contexts, and inspect them. Confirm the README's canonical external links point to Viraj and all dated fork links outside canonical product metadata remain clearly historical.

- [ ] **Step 5: Obtain independent final review**

  Request independent factual/claim review, code/test review, and rendered first-visitor/accessibility review for the complete branch diff. Fix every Critical and Important finding test-first and re-review until clean.

- [ ] **Step 6: Push and open an unmerged PR**

  Push `codex/relatable-readme-hero` to `VirajMishra1/loadout` and open a ready PR against `main`. The PR body must report:

  - billing/spending-limit root cause and zero executed steps;
  - why no local reproduction of account billing is possible;
  - exact local commands and test counts;
  - hero render/accessibility evidence;
  - files changed and preserved truth boundaries.

  Do not merge the PR. Confirm its final state is `OPEN`, `isDraft: false`, and base branch `main`.
