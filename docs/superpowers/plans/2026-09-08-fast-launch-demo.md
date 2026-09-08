# Fast Launch Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five-minute demo script with a deterministic 60–75 second narrated launch cut.

**Architecture:** Prepare genuine CLI outputs and Kokoro narration before capture, replay those artifacts on a fixed scene timeline, then mux and verify one 1080p MP4. The completed discussion thread `a71874c7-5ac` supplies real Claude Code and Codex output without paid-turn waiting.

**Tech Stack:** Bash, Loadout CLI, Kokoro, macOS `screencapture`, FFmpeg, FFprobe.

## Global Constraints

- Preserve Maximum, Optimize, Handoff, Coordination, and Discussion scenes.
- Omit rollback.
- Do not fabricate provider output.
- Cap the final video at 75 seconds.
- Write the result to `/Users/viraj/Desktop/loadout-demo-1080p.mp4`.

---

### Task 1: Precompute genuine demo artifacts

**Files:**

- Modify: `/Users/viraj/Desktop/run-loadout-demo.sh`

**Interfaces:**

- Consumes: current Loadout build, isolated demo state, completed discussion `a71874c7-5ac`.
- Produces: disposable text outputs and seven Kokoro WAV clips under `.loadout-demo-tmp`.

- [ ] **Step 1:** Replace live in-capture commands with preflight commands whose stdout is stored under `.loadout-demo-tmp/output`.
- [ ] **Step 2:** Generate seven concise `af_heart` narration clips before capture.
- [ ] **Step 3:** Verify `bash -n /Users/viraj/Desktop/run-loadout-demo.sh` succeeds.

### Task 2: Record a hard-bounded scene timeline

**Files:**

- Modify: `/Users/viraj/Desktop/run-loadout-demo.sh`

**Interfaces:**

- Consumes: Task 1 text and WAV artifacts.
- Produces: `.loadout-demo-tmp/raw.mov` and `.loadout-demo-tmp/narration.wav`.

- [ ] **Step 1:** Render seven scenes using saved real output and sleep only for the associated narration duration.
- [ ] **Step 2:** Use the completed discussion transcript instead of starting paid provider turns.
- [ ] **Step 3:** Set `screencapture` to a 75-second safety cap and finalize it with `SIGINT`.

### Task 3: Export and verify the launch MP4

**Files:**

- Modify: `/Users/viraj/Desktop/run-loadout-demo.sh`
- Create at runtime: `/Users/viraj/Desktop/loadout-demo-1080p.mp4`

**Interfaces:**

- Consumes: Task 2 video and narration tracks.
- Produces: one verified H.264/AAC 1920×1080 MP4.

- [ ] **Step 1:** Concatenate narration clips with short pauses and mux them with the captured video.
- [ ] **Step 2:** Scale and pad to exactly 1920×1080 with `yuv420p` and Fast Start.
- [ ] **Step 3:** Fail if FFprobe reports a duration outside 45–75 seconds or missing video/audio streams.
