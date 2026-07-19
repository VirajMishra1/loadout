# Loadout README Redesign

## Objective

Replace the current 411-line manual-style README with a concise GitHub front page
that explains Loadout in under one minute without weakening its evidence boundaries.
The approved identity is a compact loadout-slot mark containing a terminal prompt,
paired with the line **Agent extensions, under control.**

## Audience and first-minute outcome

The primary reader is a developer who uses one or more AI coding agents and wants to
understand, test, and control locally installed extensions. Above the fold, the reader
must learn what Loadout does, that preview and rollback are core behaviors, and that
the current install path is an authorized source checkout rather than unpublished npm
version `0.3.2`.

## Information architecture

The README will use this order:

1. Centered SVG mark, name, product line, bounded one-sentence definition, and three
   valid badges.
2. Compact navigation.
3. The five-stage journey: Choose -> Inspect -> Preview -> Apply -> Undo.
4. A shortened transcript taken from a real disposable Stable-profile run.
5. Three benefits: one managed inventory, preview by default, and snapshot-backed
   rollback with safety checks.
6. Source installation and the disposable `loadout demo` first success.
7. Normal Stable-profile workflow and a four-profile summary.
8. Compact trust model and limitations.
9. Compact supported-agent summary and command reference.
10. Development checks, documentation, contributing/security/attribution, and license.

The complete adapter matrix, catalog/evidence tables, discovery statistics,
architecture/persistence details, credential and executable boundaries, full
troubleshooting, release evidence, and stabilization history belong in linked docs.
README-only architecture and troubleshooting material will be moved before it is
removed.

## Visual identity

Create `docs/assets/loadout-mark.svg` as an original, dependency-free SVG. The mark is
a restrained inventory tray made from five outlined slots. One selected slot contains
the terminal prompt `>_`, connecting extension selection with explicit CLI control.
Use `currentColor`-compatible monochrome geometry where GitHub rendering permits it;
otherwise use neutral strokes that retain contrast on both white and near-black
backgrounds. No gradients, animation, external fonts, copied graphics, or simulated
product screenshot.

The asset must remain legible at approximately 48 px high, include an SVG `<title>`
and `<desc>`, and be referenced by descriptive README alt text. Render it against light
and dark backgrounds for visual inspection before acceptance.

## Truth and evidence boundaries

- Present-tense claims must trace to current code, tests, generated evidence, or live
  repository/registry checks.
- `loadout-ai@0.3.2` must appear only in a bounded statement explaining that it is not
  currently published; the source checkout is the working install path.
- Stable is policy-selected, not human-reviewed, benchmarked, universally best, or
  guaranteed safe.
- Pinned commits identify source bytes; they do not prove trustworthiness, licensing,
  usefulness, or ongoing compatibility.
- Adapter claims cover configured skill paths and disposable filesystem lifecycle
  evidence only. They do not claim native applications load or execute extensions.
- The local scan benchmark is a repository regression gate, not comparative product
  performance evidence.
- The terminal excerpt may omit repetitive fetch lines with a literal ellipsis, but
  every retained line must match a captured disposable run.

## Generated content

All six existing marker pairs must remain exactly once and in valid order:

- `catalog-coverage`
- `evidence-stages`
- `daily-discovery`
- `support-summary`
- `current-limits`
- `verification-summary`

The fact generator will be changed so the evidence-stage and support blocks render
compact summaries with links instead of large tables. Tests must prove marker
freshness and the new compact output.

## Validation

Acceptance requires SVG XML validation, light/dark renders, README marker freshness,
link and anchor checks, command and claim gates, the complete repository verification
suite including Playwright, `git diff --check`, a rendered Markdown preview, independent
factual/visual/accessibility review, GitHub Actions success, merge, branch cleanup, and
a final fresh clone of remote `main`.

