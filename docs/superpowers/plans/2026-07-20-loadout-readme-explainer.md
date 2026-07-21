# Loadout README Explainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and integrate an original Loadout workflow infographic that accurately explains the preview-first, recoverable extension lifecycle.

**Architecture:** A single project-owned PNG becomes the README hero while the existing SVG remains available. The README product-flow test locks the asset path and accessible description, and the normal verification suite guards product claims and repository integrity.

**Tech Stack:** Built-in image generation, PNG asset, Markdown/HTML README, Vitest, npm verification scripts, GitHub Actions.

## Global Constraints

- Use the exact five-stage order: Choose, Inspect, Preview, Apply, Undo.
- Name only checked-in supported agents: Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode, Windsurf, plus “+ 5 more adapters”.
- Use the exact footer: “Preview first · Managed changes · Snapshot-backed undo”.
- Do not add numerical safety, performance, popularity, or compatibility claims.
- Preserve `docs/assets/loadout-hero.svg`; create `docs/assets/loadout-workflow.png`.
- Use the exact alt text from the approved design spec.

---

### Task 1: Lock the README integration contract

**Files:**

- Modify: `tests/readme-product-flow.test.ts`
- Test: `tests/readme-product-flow.test.ts`

**Interfaces:**

- Consumes: the current README hero assertion.
- Produces: a test contract for `./docs/assets/loadout-workflow.png` and the approved alt text.

- [ ] **Step 1: Update the hero assertion**

```ts
expect(readme).toContain(
  '<img src="./docs/assets/loadout-workflow.png" alt="Loadout workflow: choose extensions, inspect sources, preview changes, apply through a managed snapshot, and undo safely across supported AI coding agents." width="960">',
);
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `npx vitest run tests/readme-product-flow.test.ts`

Expected: FAIL because `README.md` still references `loadout-hero.svg`.

### Task 2: Generate and validate the infographic

**Files:**

- Create: `docs/assets/loadout-workflow.png`
- Preserve: `docs/assets/loadout-hero.svg`

**Interfaces:**

- Consumes: `docs/superpowers/specs/2026-07-20-loadout-readme-explainer-design.md` and the three supplied visual references.
- Produces: a wide, readable, original PNG suitable for a 960-pixel README presentation.

- [ ] **Step 1: Generate the project artwork**

Use built-in image generation with the supplied images as style references and this content contract: title “Your Agent Extensions, Under Control”; Choose → Inspect → Preview → Apply → Undo; a Loadout inventory card; the seven named agents; “+ 5 more adapters”; footer “Preview first · Managed changes · Snapshot-backed undo”; warm white hand-drawn infographic; no unsupported claims, logos, watermarks, gradients, shadows, or garbled text.

- [ ] **Step 2: Save the selected output**

Copy the generated artifact to `docs/assets/loadout-workflow.png` without modifying `docs/assets/loadout-hero.svg`.

- [ ] **Step 3: Inspect the saved PNG**

Open the workspace asset at original detail and verify every required label, composition, padding, and legibility. If any required text is wrong, perform one targeted image edit and inspect again.

### Task 3: Integrate and verify the README

**Files:**

- Modify: `README.md`
- Test: `tests/readme-product-flow.test.ts`

**Interfaces:**

- Consumes: `docs/assets/loadout-workflow.png` and the test contract from Task 1.
- Produces: the rendered README hero reference and accessible description.

- [ ] **Step 1: Replace the README hero reference**

```html
<img
  src="./docs/assets/loadout-workflow.png"
  alt="Loadout workflow: choose extensions, inspect sources, preview changes, apply through a managed snapshot, and undo safely across supported AI coding agents."
  width="960"
/>
```

- [ ] **Step 2: Run the focused test and verify green**

Run: `npx vitest run tests/readme-product-flow.test.ts`

Expected: 9 passed and 1 skipped, with zero failures.

- [ ] **Step 3: Run the complete local gate**

Run: `npm run verify`

Expected: formatting, lint, type checking, evidence gates, 114 test files, CLI flow, README flow, package smoke, and performance checks all pass.

- [ ] **Step 4: Commit and push**

```bash
git add README.md docs/assets/loadout-workflow.png tests/readme-product-flow.test.ts docs/superpowers/plans/2026-07-20-loadout-readme-explainer.md
git commit -m "docs: add Loadout workflow explainer"
git push origin main
```

- [ ] **Step 5: Verify remote CI**

Run the normal push CI, then dispatch the full CI workflow on the final commit. Confirm the fast gate, Playwright diagnostics, and all six native OS/Node jobs complete successfully.
