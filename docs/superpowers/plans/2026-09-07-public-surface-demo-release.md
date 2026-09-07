# Public Surface, Demo, and 0.9.3 Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Loadout's GitHub, npm, README, social preview, and recorded demo tell the same accurate Discover → Curate → Activate → Handoff → Coordinate story.

**Architecture:** Codex updates the GitHub repository metadata and produces the social-card variant from the approved unified visual. Claude Code updates README copy and owns the patch release. The release is verified from the public npm registry before the real-provider demo is recorded from an isolated home directory.

**Tech Stack:** Markdown, Vitest, GitHub CLI, Loadout coordination/handoff, npm, built-in image generation, macOS `screencapture`, FFmpeg.

## Global Constraints

- Keep claims bounded to the currently proven local, same-repository Claude Code/Codex workflow.
- Explain that `coord discuss start` invokes both providers from one user command and spends provider quota.
- Remove the personal "Built with Claude and Codex" attribution section.
- Preserve preview-first, reversible, and audit-trail language.
- Do not publish over `0.9.2`; create patch release `0.9.3`.
- Do not include `.handoff/` runtime files in commits or release artifacts.
- Record only genuine CLI and provider output; remove idle waiting only and label that edit.

---

### Task 1: Align the README collaboration story

**Files:**
- Modify: `README.md`
- Test: `tests/readme-product-flow.test.ts`

**Interfaces:**
- Consumes: existing `loadout coord discuss start` CLI and provider-turn limits.
- Produces: a prominent README explanation of one-command bounded discussion.

- [ ] **Step 1: Add a failing README assertion**

  Require the collaboration section to include the phrases `prompt once`, `calls both providers`, and `paid provider turns`, and require `## Built with Claude and Codex` to be absent.

- [ ] **Step 2: Run the focused test and confirm it fails**

  Run: `npm test -- --run tests/readme-product-flow.test.ts`

  Expected: FAIL because the README has only a bare discussion command and still contains the attribution heading.

- [ ] **Step 3: Make the minimum README edit**

  Add a short `Let Claude and Codex debate one decision` subsection immediately after the coordination example. State that the user prompts once, Loadout calls both providers in bounded turns, records the decision, cannot inject into an in-progress turn, and consumes configured provider quota. Remove the complete attribution section; retain any non-duplicated quota warning in the collaboration subsection.

- [ ] **Step 4: Run focused README tests**

  Run: `npm test -- --run tests/readme-product-flow.test.ts tests/readme-claims.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit the README change**

  Commit message: `docs: explain one-command agent discussions`

---

### Task 2: Align GitHub metadata and social preview

**Files:**
- Modify: `docs/assets/loadout-social-preview.png`

**Interfaces:**
- Consumes: `docs/assets/loadout-unified-workflow-v2.webp` as the approved content and style reference.
- Produces: a 1280×640 GitHub social card with the same lifecycle and collaboration story.

- [ ] **Step 1: Inspect the existing hero and social card**

  Confirm the hero contains Discover, Curate, Activate, Handoff, and Coordinate and that the existing social card does not.

- [ ] **Step 2: Generate the social-card edit non-destructively**

  Use the built-in image-generation tool with the unified hero as the reference/edit target. Require exact 2:1 composition, high contrast, minimal text, and visible `HANDOFF` and `COORDINATE` labels. Save the approved result as `docs/assets/loadout-social-preview-v2.png`, inspect at full size and at GitHub card size, then replace `docs/assets/loadout-social-preview.png` only after validation.

- [ ] **Step 3: Update repository About metadata**

  Run:

  ```bash
  gh repo edit VirajMishra1/loadout \
    --description "Discover, curate, and activate skills across 12 coding agents—then hand off and coordinate work between Claude Code and Codex."
  ```

  Preserve the npm homepage and existing topics.

- [ ] **Step 4: Upload the social preview in GitHub Settings**

  Open `https://github.com/VirajMishra1/loadout/settings` and upload `docs/assets/loadout-social-preview.png` under Social preview. Verify the displayed image matches the new asset. The committed file alone does not change GitHub's link card.

- [ ] **Step 5: Commit the social card**

  Commit message: `docs: align social preview with Loadout workflow`

---

### Task 3: Verify and publish 0.9.3 through Claude Code

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: verified documentation commits on `main`.
- Produces: npm package and GitHub release `0.9.3` whose README matches GitHub main.

- [ ] **Step 1: Confirm release state**

  Verify `main` matches `origin/main`, only `.handoff/` runtime files are dirty, `0.9.2` is the latest registry version, and `v0.9.2` is the latest Git tag.

- [ ] **Step 2: Prepare the patch version**

  Update package metadata to `0.9.3` and add a changelog entry describing the unified README, clearer one-command discussion documentation, and aligned social preview. Do not claim runtime feature changes.

- [ ] **Step 3: Run the complete release gate**

  Run: `npm run verify`

  Expected: all unit, product-flow, package-smoke, cross-platform simulation, claim, and performance gates pass.

- [ ] **Step 4: Publish through the existing release workflow**

  Commit and push the release preparation, tag the exact verified commit as `v0.9.3`, and use the repository's release workflow so npm provenance can be attached. If GitHub/npm requires a user authentication confirmation, stop only for that confirmation and never record credentials in `.handoff/` or terminal logs.

- [ ] **Step 5: Verify public artifacts**

  Verify `npm view loadout-ai@0.9.3 version dist.attestations --json`, inspect the README inside `npm pack loadout-ai@0.9.3`, perform a clean `npx loadout-ai@0.9.3 --version`, and confirm the GitHub release points to the same commit.

---

### Task 4: Record and encode the real demo

**Files:**
- Create outside Git: `/tmp/loadout-demo-raw.mov`
- Create outside Git: `/tmp/loadout-demo-final.mp4`

**Interfaces:**
- Consumes: public `loadout-ai@0.9.3`, authenticated Claude Code and Codex provider sessions, isolated demo home/project.
- Produces: a 75–90 second 1920×1080 H.264 demonstration suitable for GitHub and X.

- [ ] **Step 1: Prepare an isolated demo environment**

  Create a disposable home and checkout fixture. Install or invoke exactly `loadout-ai@0.9.3`. Ensure no real user agent configuration is modified.

- [ ] **Step 2: Rehearse the genuine sequence**

  Rehearse Stable setup preview/apply/status, bundled handoff and receiver inbox, backend/frontend coordination and contract snapshot, one three-turn Claude/Codex discussion, and coordination replay.

- [ ] **Step 3: Record a native Terminal window**

  Position a 960×540 logical-point Terminal window in region `276,221,960,540`, then run:

  ```bash
  /usr/sbin/screencapture -x -v -V240 \
    -R276,221,960,540 /tmp/loadout-demo-raw.mov
  ```

- [ ] **Step 4: Trim idle provider waits and encode**

  Retain all substantive real output. Add the visible caption `Real Claude + Codex turns · waiting time removed`. Encode:

  ```bash
  ffmpeg -i /tmp/loadout-demo-raw.mov \
    -vf "fps=30,scale=1920:1080" \
    -c:v libx264 -crf 18 -preset medium \
    -pix_fmt yuv420p -movflags +faststart \
    /tmp/loadout-demo-final.mp4
  ```

- [ ] **Step 5: Review before public posting**

  Confirm version consistency, text legibility, absence of secrets and private paths, truthful provider output, 75–90 second duration, and playable H.264/yuv420p output. Show the final video to the user; do not post it automatically.
