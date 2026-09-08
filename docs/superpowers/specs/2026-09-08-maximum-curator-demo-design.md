# Maximum + Curator flagship demo design

## Goal

Produce a terminal-only launch demo of no more than two minutes that proves Loadout's complete
lifecycle without exposing unrelated Claude Code or Codex projects. The video
uses the user's real agent setup only through terminal commands; it never opens
either agent's project or conversation UI.

## Audience and promise

The video is for developers who have multiple coding agents and too many skills
to manage. It demonstrates that Loadout can safely assemble a large reviewed
library, select a project-relevant working set, reverse a change, transfer
durable context, and let Claude Code and Codex make a bounded decision together.

## Recording environment

- Use a newly created, disposable TypeScript checkout fixture with no personal
  files or unrelated repositories.
- Use the published Loadout 0.9.4 CLI, not the older globally installed binary.
- Install Maximum into all detected real agent setups only after displaying its
  preview and safety findings and using the user's approved `--yes --approve-risk`
  command. This preserves the user's existing active skills across agents; the
  recorded curation and coordination scenes remain focused on Claude Code and Codex.
- Keep the capture to a single Terminal window. Do not open Claude Code, Codex,
  a browser, Finder, or any existing project during the take.
- Capture only the terminal rectangle and use text overlays in post-production.

## Two-minute narrative sequence

| Time | Scene | Proof on screen |
| --- | --- | --- |
| 0:00–0:08 | Hook | “One loadout. Every coding agent.” and the unified workflow image. |
| 0:08–0:22 | Maximum | Maximum preview summary: reviewed sources, quarantined units, deferred integrations, and the one blocked source. |
| 0:22–0:38 | Curator | A short time-compressed Maximum apply, then `recommend` and `optimize` selecting a focused TypeScript/Node/Vitest set. |
| 0:38–0:48 | Rollback | Status, one rollback command, and the restored prior state. |
| 0:48–1:03 | Handoff | A bundled checkout task with its verification criterion and durable inbox. |
| 1:03–1:20 | Coordinate | Backend/frontend ownership, a checkout contract, and Codex’s snapshot. |
| 1:20–1:48 | Discuss for real | One bounded, three-turn Claude Code ↔ Codex discussion. Their provider labels and actual terminal replies are visible; no provider app UI is opened. |
| 1:48–2:00 | Replay | Durable replay and a concise final payoff card. |

## Safety and truthfulness

- The Maximum preview must be visible before applying. State precisely that the
  current plan has quarantined and deferred components; do not imply every
  catalog record is installed.
- Never configure credentialed MCP services in the demo.
- Do not show private projects, account identifiers beyond the CLI's ordinary
  provider availability output, secrets, browser tabs, or notification banners.
- Do not claim a provider exchange is live unless the recorded command actually
  completed with both providers.
- Maximum writes a managed library and snapshot. The Curator's project-specific
  active set is the recommendation, not an assertion that all Maximum content is
  good for every project.

## Audio and edit

- Add a concise synthetic voice walkthrough that explains each proof point in
  plain language. It is narration, not a text-message-song treatment.
- Use no background track under the narration or provider output; clean terminal
  sound and subtitles take priority.
- Show real terminal output; compress only inactive install/provider wait time,
  with an explicit on-screen note when time is removed.

## Acceptance criteria

- No unrelated project or agent UI is visible in any frame.
- The final export is 1920×1080 H.264, has a maximum duration of two minutes,
  includes legible terminal text, captions, and synthetic voice narration.
- The recording shows Maximum, Curator, rollback, a bundled handoff,
  coordination ownership/contracts, a real bounded discussion, and replay.
- A clean published 0.9.4 CLI is used and the recorded commands succeed.
