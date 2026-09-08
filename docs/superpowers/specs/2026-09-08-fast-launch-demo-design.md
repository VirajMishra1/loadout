# Fast Launch Demo Design

## Goal

Produce a polished 60–75 second Loadout launch video that demonstrates Maximum,
Optimize/Curator, bundled Handoff, Coordination, and a genuine Claude Code ↔
Codex Discussion without recording network or provider wait time.

## Story

The cut opens with Loadout's one-line value proposition, then moves through five
proof points: the screened Maximum library, project-aware optimization, a
context-bundled handoff, explicit ownership/contracts, and a previously completed
real two-provider discussion. Rollback is omitted to protect pace.

## Capture model

Slow read-only commands and demo-state mutations run before screen capture and
write their real terminal output into a disposable directory. During capture,
the script displays the exact command followed by that saved output. The video
labels removed setup or provider waiting time. No agent response is invented.

## Audio and timing

Kokoro `af_heart` narrates seven short clips generated before capture. Each scene
remains visible for the corresponding clip duration, and the clips are assembled
automatically into the final audio track. The recording is capped at 75 seconds.

## Privacy and output

The user records from a fresh full-screen Terminal window. The export is H.264,
1920×1080, AAC audio, `yuv420p`, and Fast Start, written to
`/Users/viraj/Desktop/loadout-demo-1080p.mp4`.

## Acceptance criteria

- Final duration is between 45 and 75 seconds.
- Maximum, Optimize, Handoff, Coordination, and Discussion are visible.
- Discussion output comes from a genuinely completed Claude Code ↔ Codex thread.
- No rollback scene, live network wait, paid-provider wait, or unrelated project
  UI appears.
- The MP4 contains one video stream and one audible AAC audio stream.
