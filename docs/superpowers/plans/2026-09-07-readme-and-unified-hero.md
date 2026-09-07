# README and Unified Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Loadout's two competing product diagrams with one legible hero and rewrite the README so a new user understands the product in 30 seconds and reaches a verified first success in five minutes.

**Architecture:** Keep the README as the tutorial-first entry point and move detail into the existing reference guides. Enforce the public story with the existing Vitest README contract and evidence scripts. Store the accepted hero as one versioned WebP asset while retaining the old image files unreferenced.

**Tech Stack:** Markdown and HTML, Vitest, Node.js 20+, built-in image generation, WebP.

## Global Constraints

- The hero must use a 16:9 white-background hand-drawn infographic and remain legible at 960 pixels wide.
- Use the headline `YOUR TOOLS. YOUR AGENTS. ONE LOADOUT.`.
- Use the footer `Preview every change • Roll back anytime • Full audit trail`.
- Use the README value proposition `Manage skills for 12 coding agents. Hand off and coordinate work between Claude Code and Codex.`.
- Embed exactly one local product explainer image; badges and the remote YouTube preview are exempt.
- Keep every generated `loadout:*` marker pair unique, intact, ordered, and evidence-backed.
- Do not claim shared memory, merged context, continuous agent conversation, universal compatibility, or market uniqueness.
- Keep the README below 425 lines and aim below 350 lines.
- Do not modify runtime coordination behavior as part of this work.

---

### Task 1: Change the README contract to the approved story

**Files:**

- Modify: `tests/readme-product-flow.test.ts`
- Test: `tests/readme-product-flow.test.ts`

**Interfaces:**

- Consumes: the existing `webpDimensions()` and `expectOrderedReadmeStructure()` helpers.
- Produces: a test contract requiring `docs/assets/loadout-unified-workflow-v2.webp`, the new value proposition, tutorial-first headings, one product image, and no abridged transcript.

- [ ] **Step 1: Replace the two-image assertions with one-image assertions**

Use this test logic inside `presents the approved proof-first product journey`:

```ts
const productImages =
  readme.match(
    /<img\b[^>]*src="\.\/docs\/assets\/loadout-[^"]+\.webp"[^>]*>/gi,
  ) ?? [];
expect(productImages).toHaveLength(1);
expect(productImages[0]).toContain(
  'src="./docs/assets/loadout-unified-workflow-v2.webp"',
);
expect(productImages[0]).toContain("discovers, curates, and activates");
expect(productImages[0]).toContain("handoff and coordinate");

const image = await readFile(
  resolve(repositoryRoot, "docs/assets/loadout-unified-workflow-v2.webp"),
);
const { width, height } = webpDimensions(image);
expect(width / height).toBeGreaterThan(1.7);
expect(width / height).toBeLessThan(1.9);
expect(image.byteLength).toBeLessThan(500_000);
```

- [ ] **Step 2: Replace obsolete copy and order assertions**

Require the following copy and ordered headings:

```ts
expect(readme).toContain(
  "Manage skills for 12 coding agents. Hand off and coordinate work between Claude Code and Codex.",
);
expect(readme).toContain("Choose -> Inspect -> Preview -> Apply -> Undo");
expect(readme).not.toMatch(/abridged terminal transcript/i);
expect(readme).toContain("npm install --global loadout-ai");
expect(readme).toContain("loadout coord discuss start");
expect(readme).toContain("--verify-command npm");
expect(readme).toMatch(/bounded design discussion/i);
expect(readme.split(/\r?\n/).length).toBeLessThanOrEqual(425);

expectOrderedReadmeStructure(
  readme,
  [
    "## Try it in 30 seconds",
    "## What Loadout does",
    "## Use Claude Code and Codex together",
    "## Try these prompts",
    "## Install and choose your agent",
    "## Safety and trust",
    "## Demo",
    "## Why Loadout",
    "## Profiles",
    "## Catalog and discovery",
    "## Agent support",
    "## Command reference",
    "## Built with Claude and Codex",
    "## Development",
    "## Documentation",
    "## Contributing, security, and attribution",
    "## License",
  ],
  [
    "current-limits",
    "catalog-coverage",
    "evidence-stages",
    "daily-discovery",
    "support-summary",
    "verification-summary",
  ],
);
```

- [ ] **Step 3: Update section-slice tests**

Change the Why Loadout end boundary from `## Stable workflow` to `## Profiles`.
Change the first-party skill section boundaries to `## Try these prompts` and
`## Install and choose your agent`, preserving both skill-install assertions.

- [ ] **Step 4: Run the focused contract and confirm it fails for the intended reasons**

Run:

```bash
npx vitest run tests/readme-product-flow.test.ts
```

Expected: FAIL because the unified asset and new README headings do not exist yet; no TypeScript or helper error should appear.

- [ ] **Step 5: Commit the red contract**

```bash
git add tests/readme-product-flow.test.ts
git commit -m "test: define unified README product story"
```

### Task 2: Generate and validate the unified hero

**Files:**

- Create: `docs/assets/loadout-unified-workflow-v2.webp`
- Reference: `docs/assets/loadout-discover-activate.webp`
- Reference: `docs/assets/loadout-handoff-coordinate.webp`

**Interfaces:**

- Consumes: the two existing 1672×941 diagrams as visual references only.
- Produces: a lossy VP8 WebP between 1.7:1 and 1.9:1 and below 500 KB.

- [ ] **Step 1: Generate the first candidate with the built-in image tool**

Use this exact prompt:

```text
Use case: infographic-diagram
Asset type: GitHub README and X social-sharing hero
Primary request: Create one polished hand-drawn whiteboard infographic that explains the complete Loadout product in two related horizontal lanes.
Input images: Image 1 and Image 2 are style and composition references only; do not copy them pixel-for-pixel.
Scene/backdrop: clean white background with generous margins.
Subject: Top lane is the extension lifecycle, with three large connected panels: DISCOVER, CURATE, ACTIVATE. Bottom lane is agent collaboration, with Claude Code on the left, LOADOUT in the center, and Codex on the right, connected bidirectionally. Show HANDOFF and COORDINATE as two distinct collaboration mechanisms.
Style/medium: friendly hand-drawn marker illustration, strong dark lettering, rounded boxes, simple icons, restrained purple, blue, orange, and green accents.
Composition/framing: exact 16:9 landscape composition; readable at 960 px wide; two visually distinct lanes; no crowded microcopy.
Text (verbatim): "YOUR TOOLS. YOUR AGENTS. ONE LOADOUT."; "DISCOVER"; "skills • tools • MCP"; "CURATE"; "screened • pinned • reversible"; "ACTIVATE"; "right tools for this repo"; "Claude Code"; "LOADOUT"; "Codex"; "HANDOFF"; "durable tasks + bundled context"; "COORDINATE"; "ownership • contracts • decisions"; "Preview every change • Roll back anytime • Full audit trail".
Constraints: render every quoted phrase exactly once with exact spelling and capitalization; CURATE must visually contain a small curator/filter icon; handoff and coordinate must be visibly distinct; no claims about shared memory or continuous conversation.
Avoid: gradients, dark background, tiny paragraphs, fake screenshots, star counts, unsupported metrics, logos copied inaccurately, watermarks, third agent, extra text.
```

- [ ] **Step 2: Inspect the candidate at full resolution**

Reject the image if any exact phrase is misspelled, duplicated, missing, visibly clipped, or unreadable. Iterate with one targeted correction per generation.

- [ ] **Step 3: Save and convert the accepted candidate**

Copy the accepted generated bitmap into the workspace as a versioned source, then convert it without overwriting either historical diagram:

```bash
cwebp -quiet -q 88 accepted-generated-image.png -o docs/assets/loadout-unified-workflow-v2.webp
```

If `cwebp` is unavailable, use macOS `sips` to produce WebP and verify that the result uses lossy VP8 encoding before continuing.

- [ ] **Step 4: Validate dimensions, encoding, and size**

Run:

```bash
file docs/assets/loadout-unified-workflow-v2.webp
node -e 'const fs=require("fs");const b=fs.readFileSync("docs/assets/loadout-unified-workflow-v2.webp");if(b.toString("ascii",0,4)!=="RIFF"||b.toString("ascii",8,12)!=="WEBP"||b.toString("ascii",12,16)!=="VP8 ")process.exit(1);const w=b.readUInt16LE(26)&0x3fff,h=b.readUInt16LE(28)&0x3fff;console.log({w,h,ratio:w/h,bytes:b.length});if(w/h<=1.7||w/h>=1.9||b.length>=500000)process.exit(1)'
```

Expected: a WebP image, ratio strictly between 1.7 and 1.9, and fewer than 500,000 bytes.

- [ ] **Step 5: Commit the accepted asset**

```bash
git add docs/assets/loadout-unified-workflow-v2.webp
git commit -m "docs: add unified Loadout workflow hero"
```

### Task 3: Rewrite the README around one first-time-user path

**Files:**

- Modify: `README.md`
- Test: `tests/readme-product-flow.test.ts`
- Verify: `docs/evidence/readme-claims.json`

**Interfaces:**

- Consumes: `docs/assets/loadout-unified-workflow-v2.webp` and all existing generated marker blocks.
- Produces: one tutorial-first README below 425 lines with working commands and compact reference sections.

- [ ] **Step 1: Replace the top fold**

Use this exact opening copy and image element, retaining the existing badge row:

```html
<h1 align="center">Loadout</h1>

<p align="center">
  <strong
    >Manage skills for 12 coding agents.<br />Hand off and coordinate work
    between Claude Code and Codex.</strong
  >
</p>

<p align="center">
  <img
    src="./docs/assets/loadout-unified-workflow-v2.webp"
    alt="Loadout discovers, curates, and activates skills, tools, and MCP servers for coding agents, then helps Claude Code and Codex handoff and coordinate work through durable tasks, bundled context, ownership, contracts, and decisions."
    width="960"
  />
</p>
```

Update the top navigation to link to `#try-it-in-30-seconds`,
`#use-claude-code-and-codex-together`, `#try-these-prompts`,
`#safety-and-trust`, and `#command-reference`.

- [ ] **Step 2: Write the first-success path**

Use this exact core flow:

````markdown
## Try it in 30 seconds

You need Node.js 20 or newer and Git.

```bash
npm install --global loadout-ai
loadout setup --mode stable
```

The second command detects your coding agents and previews the 30-skill Stable
loadout. It does not change agent files. Review the plan, then apply it:

```bash
loadout setup --mode stable --yes
loadout status
```

Loadout saves a rollback snapshot before applying changes. Run
`loadout rollback` to restore the previous managed state.
````

- [ ] **Step 3: Add the five-capability overview**

Use one compact table with these exact rows:

```markdown
| Capability     | What you get                                                          |
| -------------- | --------------------------------------------------------------------- |
| **Discover**   | Find skills, tools, and MCP servers worth reviewing                   |
| **Curate**     | Inspect, screen, and pin sources before trusting them                 |
| **Activate**   | Install a focused set for this repository across your agents          |
| **Handoff**    | Pass durable tasks with bundled context between Claude Code and Codex |
| **Coordinate** | Share file ownership, contracts, decisions, and acknowledgements      |
```

- [ ] **Step 4: Consolidate two-agent usage**

Under `## Use Claude Code and Codex together`, retain one complete handoff
command containing `--bundle`, `--verify`, `--verify-command npm`, and
`--verify-args '["test"]'`. Follow it with one coordination block containing
`loadout coord start`, `loadout coord snapshot codex`, and one bounded
`loadout coord discuss start` command. Include this exact clarification:

```markdown
Coordination is structured shared project state, not shared memory or a merged
context window. Events reach an agent at safe turn boundaries or when it checks
its snapshot; Loadout does not interrupt a turn in progress.
```

- [ ] **Step 5: Put skill installation before pasteable prompts**

Under `## Try these prompts`, show both first-party skill installation commands
before the existing three quoted natural-language prompts. Keep the explanation
to one sentence before and one sentence after the blockquotes.

- [ ] **Step 6: Consolidate installation, trust, demo, and reference detail**

Create `## Install and choose your agent` with the pinned 0.9.2 install command,
the recommended Stable workflow, and links to `docs/REFERENCE.md` and
`docs/USER_TEST_GUIDE.md`. Create `## Safety and trust` and move the
`current-limits` marker block into it. Move the existing YouTube thumbnail under
`## Demo`. Remove `## Stable workflow` and `### Abridged terminal transcript`.
Preserve the Why Loadout story, profiles table, catalog marker blocks, support
marker block, command reference, authorship, development marker block,
documentation links, community links, and license.

- [ ] **Step 7: Run formatting and the focused README tests**

Run:

```bash
npx prettier README.md tests/readme-product-flow.test.ts --write
npx vitest run tests/readme-product-flow.test.ts tests/readme-claims.test.ts tests/readme-facts-script.test.ts
npm run test:e2e:readme
npm run check:evidence
```

Expected: all commands exit 0 and the README journey reports success.

- [ ] **Step 8: Commit the README rewrite**

```bash
git add README.md tests/readme-product-flow.test.ts
git commit -m "docs: simplify README around one Loadout workflow"
```

### Task 4: Final visual and repository verification

**Files:**

- Verify: `README.md`
- Verify: `docs/assets/loadout-unified-workflow-v2.webp`
- Verify: repository test and evidence configuration

**Interfaces:**

- Consumes: the completed hero, README, and test contract.
- Produces: evidence that the documentation change is visually legible, truthful, formatted, and regression-free.

- [ ] **Step 1: Inspect the hero at README scale**

Render or resize a temporary 960-pixel-wide preview and visually confirm all
required labels remain readable. Do not commit the temporary preview.

- [ ] **Step 2: Check documentation integrity**

Run:

```bash
npm run format:check
npm run readme:check
npm run check:readme-claims
npm run test:e2e:readme
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 3: Run the full verification gate**

Run:

```bash
npm run verify
```

Expected: exit 0 with formatting, lint, typecheck, audit, evidence, unit,
integration, package, and performance checks passing.

- [ ] **Step 4: Confirm the final diff is scoped**

Run:

```bash
git status --short
git diff origin/main...HEAD -- README.md tests/readme-product-flow.test.ts docs/assets/loadout-unified-workflow-v2.webp
```

Expected: implementation changes are limited to the README, its contract test,
and the new hero asset, in addition to the already committed design and plan.
