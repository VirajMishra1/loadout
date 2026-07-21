# Loadout README Explainer Design

## Purpose

Create one original README infographic that lets a first-time visitor understand Loadout in a few seconds: it turns a deliberate extension selection into a previewed, managed, and recoverable setup across supported AI coding agents.

The illustration may take broad inspiration from the supplied `code-review-graph` references—white space, hand-drawn lines, rounded cards, arrows, and a restrained multicolor palette—but must not reproduce their composition, wording, icons, or product claims.

## Selected Direction

Use a horizontal control-loop composition titled **“Your Agent Extensions, Under Control”**.

The center of the image contains five connected stages, in this exact order:

1. **Choose** — select a profile or packages.
2. **Inspect** — check pinned source and metadata.
3. **Preview** — see the plan before agent files change.
4. **Apply** — install through a managed snapshot.
5. **Undo** — roll back while protecting later edits.

The stages form a gentle left-to-right arc, with a return arrow from Undo toward Choose to suggest an intentional, repeatable lifecycle rather than a one-way installer.

Below the control loop, a single **Loadout** inventory card fans out to compact agent cards. Use only names supported by the checked-in adapter matrix: **Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode, and Windsurf**. A final small card reading **“+ 5 more adapters”** represents the remaining supported targets without overcrowding the graphic.

The footer contains the short summary **“Preview first · Managed changes · Snapshot-backed undo”**. Do not include numerical safety, performance, popularity, or compatibility claims.

## Visual Language

- Wide README-friendly raster infographic, approximately 16:9.
- Warm white background with generous breathing room.
- Loose hand-drawn marker lines and slightly imperfect rounded rectangles.
- Dark charcoal headings and outlines.
- Blue for selection and agent destinations, purple for inspection, orange for preview, green for apply, and coral for undo.
- Soft pastel fills with high-contrast text.
- No logos, mascots, screenshots, terminal chrome, photorealism, gradients, shadows, watermarks, or decorative clutter.
- All text must be legible at a README display width of 960 pixels.

## Repository Integration

- Save the final project asset as `docs/assets/loadout-workflow.png`.
- Keep the existing `docs/assets/loadout-hero.svg`; do not overwrite or delete it.
- Replace the top README image reference with the new PNG.
- Use this alt text: **“Loadout workflow: choose extensions, inspect sources, preview changes, apply through a managed snapshot, and undo safely across supported AI coding agents.”**
- Keep the existing centered 960-pixel presentation.

## Validation

The finished work is acceptable only if:

- the five stage labels and their order are accurate and readable;
- every named agent appears in the checked-in adapter capability matrix;
- no unsupported safety or performance claim is introduced;
- the PNG exists in the repository and the README references it with the specified alt text;
- visual inspection confirms a clean, original composition without clipped or garbled text;
- README product-flow tests, formatting, linting, type checking, evidence gates, unit tests, CLI flow, README flow, package smoke, performance checks, and remote CI all pass after integration.
