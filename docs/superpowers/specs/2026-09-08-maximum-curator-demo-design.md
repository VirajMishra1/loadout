# Maximum + Curator flagship demo design

## Goal

Produce a 4–5 minute, terminal-only launch demo that proves Loadout's complete
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
- Install Maximum into the real agent setup only after displaying its preview and
  safety findings and using the user's approved `--yes --approve-risk` command.
- Keep the capture to a single Terminal window. Do not open Claude Code, Codex,
  a browser, Finder, or any existing project during the take.
- Capture only the terminal rectangle and use text overlays in post-production.

## Narrative sequence

1. **Discover Maximum** — show the Maximum summary: reviewed sources, installable
   repositories, quarantined units, deferred credentialed integrations, and the
   one preparation failure. Explain that the library is large but not blindly
   activated.
2. **Install and curate** — apply the approved Maximum plan, then run
   `recommend` and `optimize` for the fixture. Show the curator choosing a small
   TypeScript/Node/Vitest-relevant working set from the large library.
3. **Reversibility** — show the curated active state, invoke rollback, and show
   that the previous managed state is restored. Re-apply only the already
   reviewed curated plan if needed for following scenes.
4. **Handoff** — send a bundled checkout task from Claude Code to Codex with a
   verification criterion, then show the durable inbox entry.
5. **Coordinate** — set backend/frontend ownership, publish a TypeScript
   checkout contract, and show Codex's snapshot.
6. **Discuss for real** — run one bounded, three-turn Claude Code ↔ Codex
   architecture discussion in the terminal. The edit may remove idle waiting,
   but must label the exchange as real and may not fabricate provider output.
7. **Replay** — end on the durable event replay and a concise payoff card.

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

- Use crisp captions and restrained ambient instrumental audio at low volume.
- Lower or remove background audio while provider output is on screen.
- Do not use text-message-song audio; it competes with code and ages quickly.
- Show real terminal output; compress only inactive install/provider wait time,
  with an explicit on-screen note when time is removed.

## Acceptance criteria

- No unrelated project or agent UI is visible in any frame.
- The final export is 1920×1080 H.264 with legible terminal text.
- The recording shows Maximum, Curator, rollback, a bundled handoff,
  coordination ownership/contracts, a real bounded discussion, and replay.
- A clean published 0.9.4 CLI is used and the recorded commands succeed.
