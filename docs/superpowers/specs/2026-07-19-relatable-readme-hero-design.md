# Relatable README and Hero Design

## Objective

Make Viraj's current Loadout README more memorable to a first-time visitor without weakening its evidence boundaries. Replace the small slot mark with a clearly stronger original hero, add a concise human explanation of the loadout metaphor, correct canonical repository links, and document the actual GitHub Actions failure without pretending it is a code defect.

## Verified starting point

- Source: `VirajMishra1/loadout` default branch `main` at merge commit `194676910327176272ebe42982d13c6e8246f0aa`.
- The README already presents the verified `Choose -> Inspect -> Preview -> Apply -> Undo` flow and bounded warnings about unpublished `0.3.2`, preview/apply identity, catalog evidence, native-agent execution, security, and persistence.
- The failed upstream Actions job `88250042904` in run `29708871932` executed zero steps. Its sole annotation says the job did not start because recent account payments failed or the spending limit must be increased.
- Because no runner step started, there is no failing repository command to reproduce locally. Verification must instead run the workflow's intended commands locally and report that this validates the code but cannot reproduce GitHub account billing state.
- Canonical README/package links still point to the temporary `reddynitish/loadout` fork and must point to `VirajMishra1/loadout`.

## README story

Keep `## Why Loadout` in its current location after the verified product journey. Add one short paragraph before the existing evidence-backed benefits:

> Skills, plugins, MCP servers, and agent settings tend to accumulate one experiment at a time. Eventually it becomes hard to remember what is installed, where it came from, or how to undo it. In a game, a loadout is the deliberate set of tools chosen before a mission. Loadout brings that same discipline to AI coding agents: inspect the available equipment, choose intentionally, apply it through managed changes, and remove or roll it back later.

The final copy may be tightened for rhythm but must preserve these facts and must not introduce a founder narrative, generic marketing superlatives, universal safety, native-host execution, or stronger rollback guarantees than the implementation proves. Retain the three existing bullets for managed inventory, preview-first operations, and recoverable managed changes.

## Hero composition

Create `docs/assets/loadout-hero.svg` as a wide, dependency-free, theme-aware SVG and replace the README's small `loadout-mark.svg` reference only after rendered comparison shows the hero is materially stronger.

The composition reads left to right:

1. **Unmanaged edge:** a restrained cluster of loose extension/config tiles, crossing paths, and small labels sits outside a dashed management boundary. It is visibly disorganized but not cartoonishly chaotic.
2. **Developer choice:** a simple, original geometric developer figure at a compact workbench reaches toward one extension tile. The figure is symbolic rather than a detailed character, avoiding any resemblance to Ponytail's artwork or composition.
3. **Managed loadout:** five aligned equipment slots sit inside a clear rail. Selected slots use recognizable code-native symbols such as `>_`, a plug, linked nodes, or braces; the remaining slot can be empty. A small directional cue connects the chosen tile to the rail.
4. **Outcome:** the organized rail is visually calmer and more regular than the unmanaged edge. The image communicates selection and control, not an unsupported claim that every external tool is safe.

Use a wide `viewBox` suitable for a GitHub README hero, approximately 960 by 300. Use SVG paths and basic shapes only, with no raster content, scripts, animation, gradients, external fonts, remote references, or copied assets. Every visible symbol should remain legible when the hero is rendered near 720 pixels wide and at a smaller mobile width.

Use `currentColor` plus an internal `prefers-color-scheme` fallback so strokes and restrained fills have adequate contrast on GitHub light and dark themes. Include one meaningful `<title>` and `<desc>`, `role="img"`, and matching `aria-labelledby`. The README `<img>` needs concise alt text describing the developer moving extension tiles from a messy group into organized loadout slots.

The existing `docs/assets/loadout-mark.svg` remains available as a compact mark unless repository cleanup later proves it unused and removal is explicitly covered by tests and links. The task does not need to delete it.

## Canonical repository corrections

Update current canonical product metadata and visitor destinations from `reddynitish/loadout` to `VirajMishra1/loadout`:

- README CI workflow badge and image URL.
- README clone command.
- README issue-tracker link.
- `package.json` repository, homepage, and bugs URLs.
- `docs/evidence/live-checks.schema.json` `$id`.
- Tests/fixtures that intentionally assert canonical package metadata.

Do not rewrite historical evidence that accurately identifies the fork or dated fork CI runs. Historical links in `docs/REPOSITORY_STABILIZATION.md` remain historical evidence, not canonical product metadata.

## Check failure handling

No workflow bypass is allowed. Do not delete, skip, weaken, or condition the required verification job. The smallest correct repository action is to leave CI logic intact and accurately report the external billing/spending-limit root cause.

Before PR creation:

- Reconfirm the failed check annotation and absence of job steps.
- Run each intended required job command locally, including the exact `npm test -- --run` invocation.
- Run `npm run verify`.
- Run `npm run verify:full` because Playwright dependencies are available locally.
- Treat any local failure as a real defect and fix it test-first; do not call the external billing annotation a locally reproduced failure.

## Regression and rendering coverage

Update README-focused tests only for intended structure/content changes:

- require the new hero reference and genuine metaphor language;
- require canonical Viraj badge/clone/issue destinations;
- reject canonical README/package links to the temporary fork;
- preserve all six generated marker pairs, current hierarchy, executable offline product flow, warnings, and truth-boundary assertions.

Update package metadata tests for Viraj's canonical repository. Do not add a test that pretends GitHub billing can be reproduced locally.

Validate all README relative targets and heading fragments, SVG XML/accessibility structure, forbidden external SVG content, and light/dark renders at desktop and mobile sizes. Review the complete README as a first-time visitor for hierarchy, clarity, and unsupported implications.

## Delivery

Commit implementation on `codex/relatable-readme-hero`, push it to Viraj's repository, and open a ready pull request against `main`. Include the Actions billing root cause, local command evidence, rendered hero evidence, and truth boundaries in the PR body. Do not merge the pull request.
