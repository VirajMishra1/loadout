# Maximum + Curator demo recording implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record, narrate, and export a truthful two-minute Loadout flagship demo to the user’s Desktop.

**Architecture:** A disposable TypeScript fixture and a local copy of the published 0.9.4 CLI provide deterministic terminal output. The Maximum install intentionally targets every detected real agent after the approved risk acknowledgement so pre-existing active skills are preserved; the recorded curation and coordination scenes remain focused on Claude Code and Codex. All visible work remains in one clean Terminal window. Screen capture, voice narration, captions, and H.264 export are produced outside the repository.

**Tech Stack:** Node.js 20+, npm, Loadout 0.9.4, macOS Terminal, `screencapture`, macOS `say`, FFmpeg, Claude Code CLI, Codex CLI/SDK.

## Global Constraints

- Final video duration: 120 seconds or less.
- Final output: `/Users/viraj/Desktop/loadout-demo-maximum-curator-1080p.mp4`.
- Capture one terminal rectangle only; do not show any Claude, Codex, browser, Finder, or existing-project UI.
- Show the real Maximum preview before using `--yes --approve-risk`.
- Do not enable credentialed MCP integrations.
- Use real Claude Code and Codex replies for the bounded discussion; label removed idle wait time.
- Do not commit demo recordings, temporary scripts, audio, or fixture data to this repository.

---

### Task 1: Prepare the isolated recording workspace and published CLI

**Files:**

- Create: `/Users/viraj/Desktop/.loadout-demo-2026-09-08/package.json`
- Create: `/Users/viraj/Desktop/.loadout-demo-2026-09-08/fixture/src/api/checkout.ts`
- Create: `/Users/viraj/Desktop/.loadout-demo-2026-09-08/fixture/src/frontend/checkout.ts`
- Create: `/Users/viraj/Desktop/.loadout-demo-2026-09-08/fixture/package.json`
- Create: `/Users/viraj/Desktop/.loadout-demo-2026-09-08/output/raw/`
- Create: `/Users/viraj/Desktop/.loadout-demo-2026-09-08/output/final/`

**Interfaces:**

- Consumes: npm registry package `loadout-ai@0.9.4`.
- Produces: `node_modules/.bin/loadout` resolving to 0.9.4 and a small backend/frontend checkout fixture.

- [ ] **Step 1: Create the workspace and fixture files with no personal content.**

  The fixture API file must export `CheckoutRequest`, `CheckoutResult`, and
  `submitCheckout`. The frontend file must import `CheckoutRequest` from the
  API file, making the contract detector and ownership split meaningful.

- [ ] **Step 2: Install exactly the published CLI.**

  Run:

  ```bash
  npm install --prefix /Users/viraj/Desktop/.loadout-demo-2026-09-08 loadout-ai@0.9.4
  /Users/viraj/Desktop/.loadout-demo-2026-09-08/node_modules/.bin/loadout --version
  ```

  Expected: `0.9.4`.

- [ ] **Step 3: Preflight the recording dependencies.**

  Run:

  ```bash
  command -v ffmpeg
  command -v /usr/sbin/screencapture
  /Users/viraj/Desktop/.loadout-demo-2026-09-08/node_modules/.bin/loadout recommend --project /Users/viraj/Desktop/.loadout-demo-2026-09-08/fixture
  ```

  Expected: FFmpeg and macOS screen capture are available; the fixture is
  recognized as a TypeScript/Node project.

### Task 2: Apply Maximum, curate a focused set, and prove rollback

**Files:**

- Create: `/Users/viraj/Desktop/.loadout-demo-2026-09-08/scripts/prepare-state.sh`
- Create: `/Users/viraj/Desktop/.loadout-demo-2026-09-08/transcript/setup.txt`

**Interfaces:**

- Consumes: the published CLI from Task 1 and the user's approved real agent setup.
- Produces: a verified Maximum library, a curated fixture-specific active set, and rollback evidence.

- [ ] **Step 1: Run and retain the Maximum preview.**

  Run:

  ```bash
  /Users/viraj/Desktop/.loadout-demo-2026-09-08/node_modules/.bin/loadout setup --mode maximum --agents claude-code,codex --api-access none --details
  ```

  Expected: a summary containing reviewed sources, installable repositories,
  quarantined units, deferred integrations, and the Docker preparation failure.

- [ ] **Step 2: Apply the approved Maximum plan to every detected agent.**

  Run:

  ```bash
  /Users/viraj/Desktop/.loadout-demo-2026-09-08/node_modules/.bin/loadout setup --mode maximum --agents claude-code,codex,cursor,gemini-cli,windsurf --api-access none --yes --approve-risk
  ```

  Expected: a managed library and rollback snapshot for every detected agent;
  Docker MCP Gateway is explicitly skipped after its preparation failure, and no
  credentialed MCP setup is enabled.

- [ ] **Step 3: Curate and apply the fixture working set.**

  Run:

  ```bash
  cd /Users/viraj/Desktop/.loadout-demo-2026-09-08/fixture
  /Users/viraj/Desktop/.loadout-demo-2026-09-08/node_modules/.bin/loadout recommend --project .
  /Users/viraj/Desktop/.loadout-demo-2026-09-08/node_modules/.bin/loadout optimize --project . --agents claude-code,codex --limit 30
  /Users/viraj/Desktop/.loadout-demo-2026-09-08/node_modules/.bin/loadout optimize --project . --agents claude-code,codex --limit 30 --yes
  ```

  Capture concise `status` output after the `--yes` activation transaction.

- [ ] **Step 4: Prove reversibility.**

  Run:

  ```bash
  /Users/viraj/Desktop/.loadout-demo-2026-09-08/node_modules/.bin/loadout rollback --list
  /Users/viraj/Desktop/.loadout-demo-2026-09-08/node_modules/.bin/loadout rollback
  /Users/viraj/Desktop/.loadout-demo-2026-09-08/node_modules/.bin/loadout status
  /Users/viraj/Desktop/.loadout-demo-2026-09-08/node_modules/.bin/loadout optimize --project . --agents claude-code,codex --limit 30 --yes
  ```

  Expected: the first rollback restores the Maximum-library state that preceded
  the project activation. The final optimize reuses the same deterministic
  project rules so handoff and coordination scenes retain their curated set.

- [ ] **Step 5: Verify the real setup remains healthy.**

  Run:

  ```bash
  /Users/viraj/Desktop/.loadout-demo-2026-09-08/node_modules/.bin/loadout status
  /Users/viraj/Desktop/.loadout-demo-2026-09-08/node_modules/.bin/loadout health
  ```

  Expected: managed state is readable and no credentialed integration was
  enabled inadvertently.

### Task 3: Capture handoff, coordination, and a real bounded discussion

**Files:**

- Create: `/Users/viraj/Desktop/.loadout-demo-2026-09-08/scripts/demo-scenes.sh`
- Create: `/Users/viraj/Desktop/.loadout-demo-2026-09-08/transcript/coordination.txt`

**Interfaces:**

- Consumes: checkout fixture, Loadout 0.9.4, real Claude Code/Codex credentials.
- Produces: durable handoff and coordination events including a real three-turn discussion.

- [ ] **Step 1: Record a bundled verified handoff.**

  Set `LOADOUT_BIN` to
  `/Users/viraj/Desktop/.loadout-demo-2026-09-08/node_modules/.bin/loadout` and
  run from the fixture:

  ```bash
  "$LOADOUT_BIN" handoff codex "Review checkout validation and add edge-case tests" --from claude-code --bundle src/api/checkout.ts --verify "Unit tests cover empty cart IDs"
  "$LOADOUT_BIN" handoff codex
  ```

  Expected: durable inbox entry with bundle metadata and verification criterion.

- [ ] **Step 2: Record ownership and contract coordination.**

  Run:

  ```bash
  "$LOADOUT_BIN" coord start --agents claude-code,codex --split backend/frontend
  "$LOADOUT_BIN" coord start --agents claude-code,codex --split backend/frontend --yes
  "$LOADOUT_BIN" coord contract checkout-api --agent claude-code --format typescript --body 'export interface CheckoutAPI { submit(input: CheckoutRequest): Promise<CheckoutResult>; }'
  "$LOADOUT_BIN" coord snapshot codex
  ```

  Expected: explicit ownership, a TypeScript contract, and a Codex-readable snapshot.

- [ ] **Step 3: Record one real three-turn provider exchange.**

  Run:

  ```bash
  "$LOADOUT_BIN" coord discuss start "Should checkout validation live in the API handler or domain service?" --agents claude-code,codex --rounds 1 --max-turns 3 --timeout 120 --thread-id demo-checkout-architecture
  "$LOADOUT_BIN" coord replay
  ```

  Expected: visible provider labels and actual Claude Code/Codex replies, followed
  by a durable replay. If a provider is unavailable, stop the recording and
  report the exact adapter error rather than substituting simulated output.

### Task 4: Record, narrate, and edit the final two-minute video

**Files:**

- Create: `/Users/viraj/Desktop/.loadout-demo-2026-09-08/audio/narration.txt`
- Create: `/Users/viraj/Desktop/.loadout-demo-2026-09-08/audio/narration.aiff`
- Create: `/Users/viraj/Desktop/.loadout-demo-2026-09-08/output/raw/loadout-demo.mov`
- Create: `/Users/viraj/Desktop/loadout-demo-maximum-curator-1080p.mp4`

**Interfaces:**

- Consumes: real terminal capture and scene timestamps from Tasks 2–3.
- Produces: an H.264 1920×1080 video no longer than 120 seconds.

- [ ] **Step 1: Prepare the clean terminal framing.**

  Use one Terminal window, hide unrelated panes, set a large monospace font, and
  size the window to a 960×540-point rectangle. Only that rectangle may be
  recorded.

- [ ] **Step 2: Start macOS region capture and run the prepared scene script.**

  Run:

  ```bash
  /usr/sbin/screencapture -x -v -V120 -R276,221,960,540 /Users/viraj/Desktop/.loadout-demo-2026-09-08/output/raw/loadout-demo.mov
  ```

  Capture real scenes, cutting only idle Maximum-install and provider-wait time.
  Add visible cards reading `Maximum install — elapsed time removed` and `Real
Claude + Codex turns — waiting time removed` at those cuts.

- [ ] **Step 3: Generate concise synthetic narration.**

  Write a 100–120 second narration matching the timed sequence exactly. Generate
  it with an installed macOS synthetic voice, review it for intelligibility, and
  keep it lower than the terminal output during provider turns.

- [ ] **Step 4: Export the video.**

  Run FFmpeg with H.264 video, AAC narration, `yuv420p`, and `+faststart` to
  create `/Users/viraj/Desktop/loadout-demo-maximum-curator-1080p.mp4`.

- [ ] **Step 5: Verify the final artifact.**

  Run:

  ```bash
  ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 /Users/viraj/Desktop/loadout-demo-maximum-curator-1080p.mp4
  ```

  Expected: a duration at or below `120.0`. Open the exported file once and
  verify terminal text, captions, narration, and privacy constraints visually.
