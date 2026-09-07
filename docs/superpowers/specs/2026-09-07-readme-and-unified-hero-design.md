# README and unified hero design

## Goal

Make Loadout understandable to a first-time visitor in under 30 seconds, give
that visitor a safe first success in under five minutes, and provide one
shareable product image that explains the complete workflow.

The target reader is a developer who uses at least one AI coding agent and may
use Claude Code and Codex together. The README should assume no knowledge of
Loadout's internal terminology.

## Reference lessons

- [Graphify](https://github.com/Graphify-Labs/graphify) leads with one concrete
  outcome, reaches the install command immediately, shows what the command
  produces, and moves detail below the first success.
- [Wander Agent](https://github.com/VirajMishra1/wander-agent) uses plain
  language, copyable examples, visible outcomes, and setup paths organized by
  the tool the reader already uses.

Loadout will adopt those information-design principles without copying their
text or structure verbatim.

## Unified hero image

Create one 16:9, white-background, hand-drawn infographic in the visual style
of the two current product diagrams. It must remain legible when rendered at
960 pixels wide on GitHub and when used as an X link preview.

The layout has two related lanes:

1. The extension lifecycle: **Discover -> Curate -> Activate**.
   - Discover: `skills • tools • MCP`
   - Curate: `screened • pinned • reversible`
   - Activate: `right tools for this repo`
   - The curator skill is represented inside the Curate stage, not as a sixth
     unrelated product concept.
2. The two-agent workflow: **Claude Code <-> Loadout <-> Codex**.
   - Handoff: `durable tasks + bundled context`
   - Coordinate: `ownership • contracts • decisions`

Use the exact headline `ONE LOADOUT. EVERY CODING AGENT.` and the exact footer
`Preview every change • Roll back anytime • Full audit trail`.

Use restrained purple, blue, orange, and green accents with dark readable
lettering. Avoid gradients, tiny explanatory prose, fake UI screenshots,
unsupported metrics, star counts, and absolute novelty claims. The image
should communicate the combined workflow rather than claim that no related
project exists.

Generate the bitmap with the built-in image generator, inspect it for text and
layout accuracy, and save the accepted result as a new versioned asset under
`docs/assets/`. Preserve the existing two images as historical assets unless a
later cleanup explicitly removes them.

## README information architecture

The README is a tutorial-first front page with reference material below it.
Use this order:

1. Centered project name, one-sentence value proposition, badges, and the
   unified hero.
2. **Try it in 30 seconds**: install Loadout, preview the Stable loadout, and
   explain what the user will see before anything changes.
3. **What Loadout does**: five short capabilities—discover, curate, activate,
   handoff, coordinate—with one outcome each.
4. **Use Claude Code and Codex together**: a minimal handoff example followed
   by a minimal coordination example. State clearly that this is structured
   shared project state, not a merged context window or uninterrupted model
   conversation.
5. **Try these prompts**: plain-language requests a user can paste into an
   agent after installing the curator and handoff skills.
6. **Install and choose your agent**: the recommended npm installation first,
   then concise agent-specific guidance with links to detailed documentation.
7. **Safety and trust**: preview-first behavior, pinned sources, secret-redacted
   bounded bundles, snapshots, rollback, and the audit trail.
8. **Proof and demo**: keep the clickable YouTube thumbnail because it is a
   playable demonstration, not a second product explainer. Keep factual claims
   tied to the existing evidence manifest and generated discovery block.
9. **Reference**: compact command table, supported agents, profiles, and links
   to full guides.
10. **Community**: contribution, security, attribution, and license links.

The README will use only the new unified product infographic. Existing product
diagrams will no longer be embedded. The YouTube preview and small status
badges are exempt because they serve navigation and proof rather than explain
the product architecture.

## Writing rules

- Lead with the outcome, then show the command, then explain the machinery.
- Use short sentences and familiar words.
- Keep the recommended path visible; move edge cases to linked guides.
- Prefer one realistic command block over several near-duplicates.
- Explain `handoff` and `coordinate` separately before contrasting them.
- Do not describe coordination as shared memory, a merged context window, or
  agents talking continuously.
- Do not use hype words such as revolutionary, game-changing, or first-ever.
- Keep the README within the existing 425-line test budget and aim materially
  below it.

## Validation

- Update README tests to require exactly one local product explainer image and
  its complete alt text while allowing the remote YouTube thumbnail and badges.
- Preserve generated README marker pairs and evidence-backed claims.
- Run the focused README test, README end-to-end journey, documented-command
  check, evidence check, formatting check, and full project verification.
- Render or inspect the new hero at full size and at the README display width;
  reject it if any required text is misspelled or visually cramped.
- Verify every documented command against the current CLI before publishing.

## Out of scope

- Changing Loadout runtime behavior or the coordination protocol.
- Claiming market uniqueness or adding unverified benchmarks.
- Removing detailed guides that advanced users already rely on.
- Publishing a release or social post as part of this documentation change.
