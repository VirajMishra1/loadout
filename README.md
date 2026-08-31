<p align="center">
  <img src="./docs/assets/loadout-workflow.png" alt="Loadout discovers skills, tools, and MCP servers, keeps them in a screened library, matches an active set to each project, and manages them across AI coding agents." width="960">
</p>

<h1 align="center">Loadout</h1>

<p align="center"><strong>Agent extensions, under control.</strong></p>

<p align="center">
  <strong>The package manager for your AI coding setup.</strong><br>
  Install skills across 12 agents. Route each task to the right model.<br>
  Hand work between Claude Code and Codex. Undo any of it.
</p>

<p align="center">
  <a href="https://github.com/VirajMishra1/loadout/actions/workflows/ci.yml"><img src="https://github.com/VirajMishra1/loadout/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://www.npmjs.com/package/loadout-ai"><img src="https://img.shields.io/npm/v/loadout-ai?color=cb3837&amp;logo=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/loadout-ai"><img src="https://img.shields.io/npm/dm/loadout-ai?color=cb3837&amp;label=downloads" alt="npm downloads"></a>
  <a href="https://github.com/VirajMishra1/loadout"><img src="https://img.shields.io/github/stars/VirajMishra1/loadout?style=flat&amp;logo=github" alt="GitHub stars"></a>
  <a href="./package.json"><img src="https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&amp;logoColor=white" alt="Node.js 20 or newer"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
</p>

<p align="center">
  <a href="#what-it-looks-like">See it</a> ·
  <a href="#install">Install</a> ·
  <a href="#use-it-from-inside-your-agent">Use it in your agent</a> ·
  <a href="#working-across-two-agents">Two agents</a> ·
  <a href="#why-loadout">Why</a> ·
  <a href="#trust-and-limits">Trust</a> ·
  <a href="#command-reference">Commands</a>
</p>

## What it looks like

```console
$ loadout status
Loadout — grade A: Healthy and up to date

✓ Claude Code
  ~/.claude/skills
  582 items | supports: skill, command, agent, mcp, plugin, root
✓ Codex
  ~/.agents/skills
  83 items | supports: skill, command, agent, mcp, plugin, root

$ loadout route implement the payment webhook handler
Phase:    implement
Tier:     Standard (balanced)
Models:   Claude Sonnet 5 ($3/$15)
          GPT-5.6 Terra ($2/$12)
Agents:   claude-code, codex
Why:      Implementation is high-volume; standard models score within 5% of frontier

Conserve: drop to fast tier (GPT-5.6 Luna at $0.2/$1.2)
          May need more iterations on complex logic; fine for CRUD and boilerplate

Hand off:
  loadout handoff send codex 'implement the payment webhook handler'
```

Three things most agent tools do not do: it knows which agents you actually have,
it prices the tradeoff before you spend the tokens, and every mutating command
previews first and snapshots before it writes.

## Install

You need Node.js 20 or newer and Git.

```bash
npm install --global loadout-ai
loadout setup --mode stable
```

The second command detects your agents and previews the 30-skill Stable loadout.
Nothing changes until you approve it. If anything goes wrong, start with the
[user test guide](./docs/USER_TEST_GUIDE.md).

For a reproducible install, pin the release: `npm install --global loadout-ai@0.6.0`.

## Use it from inside your agent

A CLI you have to leave your agent to run is a context switch. Loadout ships its
own skill so you do not have to:

```bash
loadout skills install loadout-router --yes
```

Start a new agent session and just ask, in the conversation you are already in:

> _"Which model should I use to refactor this auth module?"_
> _"I'm running low on usage — what should I switch to?"_
> _"Hand the test writing to Codex."_

The skill teaches your agent to call `loadout route` and `loadout handoff` and act
on the results. It wraps the CLI rather than embedding a copy of the model table,
so pricing and model coverage update when Loadout updates instead of going stale
in a markdown file.

`loadout skills list` shows what ships with Loadout and what is already installed.

## Working across two agents

If you pay for both Claude and a ChatGPT plan, the two agents cannot see each
other. Loadout gives them a shared, append-only task log:

```bash
loadout handoff init
loadout handoff send codex "write unit tests for auth" --context "see src/auth.ts"
loadout handoff pickup --yes
```

`pickup` writes a small managed block into `CLAUDE.md` and `AGENTS.md` telling each
agent to check `loadout handoff inbox <agent>` at the start of a session. Only the
text between the `loadout:handoff` markers is managed; the rest of your file is left
alone, and re-running replaces that block instead of duplicating it.

## How it works

**Choose -> Inspect -> Preview -> Apply -> Undo**

1. **Choose** Stable, Power, Maximum, or your own package list.
2. **Inspect** where each extension comes from and what it can do.
3. **Preview** every planned change without changing agent files.
4. **Apply** with `--yes`; Loadout saves a rollback snapshot first.
5. **Undo** with `loadout rollback` if you change your mind.

### Abridged terminal transcript

This is an explicitly abridged transcript from a disposable Stable run. A literal `…` marks omitted fetch output; `<snapshot-id>` is a variable placeholder because snapshot IDs vary. Loadout auto-detects installed agents; `--agents` narrows the selection when needed.

```console
$ loadout setup --mode stable
…
Loadout: Stable Boost
Detected agents: Claude Code, Cursor, Codex
Catalog selection: 4 repositories
Ready to install: 4 skill repositories (30 agent skill directories)
Preview complete; nothing was changed. Re-run with --yes to install this exact screened plan.

$ loadout setup --mode stable --yes
…
Loadout installed 4 repositories for 3 agent(s). Snapshot: <snapshot-id>

$ loadout rollback
Restored snapshot <snapshot-id>

$ loadout route design the authentication system
Phase:    plan
Tier:     Frontier (deep reasoning)
Models:   Claude Opus 5 ($5/$25)
          GPT-5.6 Sol ($5/$30)
Agents:   claude-code
Why:      Architecture and decomposition need deep reasoning to avoid costly rework

$ loadout doctor
loadout doctor — HEALTHY
Platform:   darwin
State:      ~/.loadout ✓ writable
Agents:     3 detected, 9 available
```

The final preview sentence above is captured CLI wording. A later `--yes` invocation recomputes the plan from pinned sources and current agent and filesystem state; it does not persist or prove identity with the earlier preview.

Preview may fill Loadout's private download cache, but it does not change your agent
files. Review the summary and warnings before approving an apply command.

## Why Loadout

Loadout started with a frustrating question: **why does improving an AI coding agent
still mean opening twenty GitHub tabs?**

Useful skills, plugins, MCP servers, and settings arrive one experiment at a time.
Soon it is hard to remember what is installed, where it came from, whether something
better launched yesterday, or how to undo a change. The name comes from games, where
your loadout is the set of tools you choose for the mission. This does the same for AI
coding agents without making you rebuild the setup for every agent and every project.

Most extension tools begin with a repo you already know. Loadout begins one step
earlier: **what is actually worth knowing?** It stays with you after installation.

Everything on this page is enforced. `docs/evidence/readme-claims.json` records
each material claim with the code or command that proves it, and CI fails the
build when the README and the implementation disagree — including the pinned
version in the install line above. A README that cannot drift is a strange thing
to build, and it is the reason the rest of this page is worth believing.

Loadout watches a much wider catalog than it activates. You can keep thousands of
technically screened skill copies in the disabled Maximum library, discover new projects as
they appear, and let each codebase pull a focused active set instead of dumping
everything into every prompt.

| The usual workflow                                             | The Loadout workflow                                             |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| Find recommendations across feeds and bookmarks                | Watch one growing discovery catalog                              |
| Open every repo and guess whether to trust it                  | Inspect pinned sources, licenses, components, and risk findings  |
| Copy skills separately into Claude, Codex, Cursor, and friends | Apply one reviewed selection across detected agents              |
| Let every skill compete for context forever                    | Keep a bounded daily set or activate skills for this project     |
| Hope updates do not break anything                             | Preview updates and protect every managed change with a snapshot |
| Manually remember what was changed                             | Scan, reconcile, remove, roll back, or completely uninstall      |

Loadout is local, open source, and preview-first. It does not need an LLM API key
to manage skills. MCP servers and executable tools stay behind their own explicit
setup and permission steps.

### Demo

<p align="center">
  <a href="https://www.youtube.com/watch?v=opNqJKX7xMw">
    <img src="https://img.youtube.com/vi/opNqJKX7xMw/maxresdefault.jpg" alt="Watch the 72-second Loadout demo" width="880">
  </a>
</p>

**[Watch the 72-second Loadout demo on YouTube](https://www.youtube.com/watch?v=opNqJKX7xMw).**
It shows the real CLI product, including profiles, project-aware selection,
discovery, explicit integrations, and snapshot-backed rollback. The exact
[recording and voiceover script](./docs/DEMO_SCRIPT.md) is public.

The [end-to-end acceptance guide](./docs/USER_TEST_GUIDE.md) contains the commands
you can run yourself.

## Stable workflow

### Stable Boost: install the essentials and start building

Stable is the recommended daily driver: **30 selected skill directories from four
pinned public sources**, installed into each agent you choose. It covers planning,
implementation, debugging, testing, documentation, code review, frontend work,
performance, Git, shipping, and more without turning every discovered skill on.

| Included source                                                        | What Stable takes from it                                     | GitHub                                                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Superpowers](https://github.com/obra/superpowers)                     | Planning, execution, testing, review, verification            | [![GitHub stars](https://img.shields.io/github/stars/obra/superpowers?style=flat&label=stars)](https://github.com/obra/superpowers)               |
| [Context7](https://github.com/upstash/context7)                        | Current documentation and MCP workflows                       | [![GitHub stars](https://img.shields.io/github/stars/upstash/context7?style=flat&label=stars)](https://github.com/upstash/context7)               |
| [Addy Osmani Agent Skills](https://github.com/addyosmani/agent-skills) | Engineering, frontend, debugging, performance, docs, shipping | [![GitHub stars](https://img.shields.io/github/stars/addyosmani/agent-skills?style=flat&label=stars)](https://github.com/addyosmani/agent-skills) |
| [Agent Skills Marketplace](https://github.com/wshobson/agents)         | Architecture, review, error handling, JavaScript, Python      | [![GitHub stars](https://img.shields.io/github/stars/wshobson/agents?style=flat&label=stars)](https://github.com/wshobson/agents)                 |

Every row links directly to the upstream project. Loadout does not claim ownership
or endorsement; it pins, credits, screens, and selects from their public work.

```bash
# Preview for detected agents
loadout setup --mode stable

# Recompute from current state and apply after reviewing the preview
loadout setup --mode stable --yes

# Inspect managed state, then undo the install if needed
loadout status
loadout scan
loadout rollback
```

Stable is Loadout's strongest general starting point, not a claim that one setup is
best for every person or project. Run `loadout profiles stable --json` when you want
the machine-readable selection.

## Manage skills you already have

Already have skills? Loadout can compare them with exact catalog copies and manage
the ones it can identify confidently:

```bash
# Read-only inventory and source/update comparison
loadout scan
loadout reconcile --refresh

# Record ownership only for exact byte-for-byte matches; files are not rewritten
loadout reconcile --yes

# Preview old copies that have one unambiguous reviewed source
loadout reconcile --replace-outdated
```

Unknown or ambiguous copies stay untouched. Replacing an old copy is a separate,
previewed transaction with its own rollback snapshot. Managed copies can then be
checked by `loadout update` without moving them to a different agent path.

## Profiles

Loadout is opinionated when you want it to be and precise when you do not.

### Power Boost: a larger cross-project toolkit

Power draws a skill-level allowlist from eight major collections. The prepared set
is deduplicated and invalid units are quarantined, so the final count can be lower
than the raw allowlist. In current acceptance testing it prepared about 50 active
skills per agent.

| Included source                                                          | Focus                                                     | GitHub                                                                                                                                                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Anthropic Skills](https://github.com/anthropics/skills)                 | Documents, frontend, MCP building, web testing            | [![GitHub stars](https://img.shields.io/github/stars/anthropics/skills?style=flat&label=stars)](https://github.com/anthropics/skills)                                       |
| [OpenAI Skills](https://github.com/openai/skills)                        | CLI, docs, browser work, images, security                 | [![GitHub stars](https://img.shields.io/github/stars/openai/skills?style=flat&label=stars)](https://github.com/openai/skills)                                               |
| [Vercel Agent Skills](https://github.com/vercel-labs/agent-skills)       | React, web design, composition, deployment                | [![GitHub stars](https://img.shields.io/github/stars/vercel-labs/agent-skills?style=flat&label=stars)](https://github.com/vercel-labs/agent-skills)                         |
| [Superpowers](https://github.com/obra/superpowers)                       | Planning, debugging, testing, collaboration               | [![GitHub stars](https://img.shields.io/github/stars/obra/superpowers?style=flat&label=stars)](https://github.com/obra/superpowers)                                         |
| [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | UI systems, slides, styling, product design               | [![GitHub stars](https://img.shields.io/github/stars/nextlevelbuilder/ui-ux-pro-max-skill?style=flat&label=stars)](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) |
| [Context7](https://github.com/upstash/context7)                          | Current documentation and MCP workflows                   | [![GitHub stars](https://img.shields.io/github/stars/upstash/context7?style=flat&label=stars)](https://github.com/upstash/context7)                                         |
| [Agent Skills Marketplace](https://github.com/wshobson/agents)           | Architecture, testing, APIs, TypeScript, Python           | [![GitHub stars](https://img.shields.io/github/stars/wshobson/agents?style=flat&label=stars)](https://github.com/wshobson/agents)                                           |
| [Awesome Copilot](https://github.com/github/awesome-copilot)             | Codebase knowledge, plans, browser and security workflows | [![GitHub stars](https://img.shields.io/github/stars/github/awesome-copilot?style=flat&label=stars)](https://github.com/github/awesome-copilot)                             |

```bash
loadout setup --mode power
```

### Maximum Library: download broadly, activate intelligently

Maximum is for explorers. It downloads every non-archived, technically screened
skill component in the catalog into Loadout's **disabled local library**. Disabled
means cached and available, not injected into agent context. Then let the current
project choose a focused active set:

```bash
loadout setup --mode maximum
loadout recommend --project .
loadout optimize --project . --limit 30
loadout optimize --project . --limit 30 --yes
```

This is the difference between “install everything” and “have everything ready.”
The first overloads agents; the second gives you a large library with a small,
relevant active loadout.

### Custom: take exact control

Use `setup` when the listed packages should become the complete managed profile for
the selected agents. Packages from the previous managed profile that are not listed
will be retired, and the preview names every retirement:

```bash
loadout setup --mode custom --package superpowers --package context7
```

Use `install` when you only want to add a package without replacing the current
managed profile:

```bash

# Install the reviewed Humanizer writing skill
loadout install --mode custom --package humanizer

# Install the reviewed Obsidian skills for specific agents
loadout install --mode custom --package obsidian-skills --agents claude-code,cursor
```

Run `loadout profiles` to compare every mode. MCP servers always use a separate
approval step. Obsidian skills are also proposed automatically when `recommend` or
`optimize` detects an Obsidian vault; they are not added to the universal Stable set.

## MCP integrations

Profiles never start MCP servers silently. First list the available recipes and see
which ones need credentials:

```bash
loadout mcp-recipe
loadout mcp-recipe --credential-free
```

Preview and configure one for the host you use:

```bash
loadout mcp-recipe playwright --agent claude-code
loadout mcp-recipe playwright --agent claude-code --yes
loadout mcp-recipe playwright --agent claude-code --verify
```

Configuration alone does not start the server. Test a real connection separately
with `--connect --approve-risk`. Loadout can reference credentials from environment
variables or the OS keychain without printing their values.

## Optional runtime tools

[Graphify](https://github.com/Graphify-Labs/graphify) is an optional codebase graph
tool. It installs both a command and an agent skill, so Loadout keeps it separate from
the normal profiles. It does not require an LLM API key:

```bash
loadout tool graphify
loadout tool graphify --yes --approve-risk
loadout tool graphify --remove --yes --approve-risk
```

Executable tools remain an explicit choice instead of hiding inside a profile.

## Catalog and discovery

### GitHub moves every day. Your loadout should not stand still.

The catalog is not a frozen “top 50” list. Loadout separates **discovery** from
**installation** so a viral repo can be noticed quickly without being trusted
blindly. Candidates enter a review queue; catalog entries are pinned and inspected;
only the bounded Stable policy gets the strongest automatic recommendation.

```bash
# Find candidates across configured discovery sources
loadout discover --source all --queue

# Inspect the queue and one candidate before promotion
loadout review-queue
loadout candidate inspect owner/repository

# Check whether managed active or disabled-library sources changed
loadout update
loadout health --updates
```

Daily checks are opt-in and read-only. They tell you what changed; they do not
silently rewrite your agents:

```bash
loadout autopilot --yes
loadout autopilot --status
```

<!-- loadout:catalog-coverage:start -->

The bundled catalog currently contains **53 credited public repositories** across **39 categories**: **34 have skill components** and **19 are MCP-only**. All 53 are technically screened and pinned; 4 sources are selected by the bounded Stable policy. See every linked source, license status, component type, and pinned commit in **[Catalog and upstream credits](./docs/CATALOG.md)**.

<!-- loadout:catalog-coverage:end -->

<!-- loadout:evidence-stages:start -->

Catalog maturity: **53 sourced**, **53 technically inspected**, and **4 selected for Stable**. Independent human-review attestations are not yet published, so Loadout does not pretend static inspection proves usefulness. The pinned catalog remains usable today, and local outcomes can be recorded to improve later rankings. Definitions and promotion rules are in the [catalog policy](./docs/CATALOG_POLICY.md).

<!-- loadout:evidence-stages:end -->

Loadout does not claim there is one universally “best” configuration. Recommendations are bounded, rule-based proposals; stars and discovery results are signals for review, not quality proof.

<!-- loadout:daily-discovery:start -->

**Discovery snapshot (generated 2026-08-31):** [238 repositories observed](./docs/DISCOVERED.md), including 219 uncataloged review candidates and 19 repositories already in the inspected catalog.
<!-- loadout:daily-discovery:end -->

The checked-in discovery report proves only its dated snapshot, not the success of every scheduled run. Use `loadout discover --source all --queue`, `loadout review-queue`, and `loadout candidate inspect owner/repository` to inspect candidates before catalog promotion.

## Trust and limits

- A pinned commit identifies source bytes; it does not prove safety, correct licensing, usefulness, or future compatibility.
- Static inspection reports scripts, hooks, binaries, domains, credential references, and unsupported components. It is not a security audit.
- No bundled source is called proven until human review and recorded local outcomes support it; static inspection alone never earns that label.
- Project recommendations read bounded local metadata. The documented local flow does not upload project source.
- Catalog fetches, discovery, update checks, and optional live checks use the network where stated.
- MCP servers and executable tools have separate preview and approval paths because they can use credentials, start processes, or contact services.
- Shared manifests hold environment-variable or OS-keychain references, not secret values.

<!-- loadout:current-limits:start -->

- **4 catalog records** currently have `NOASSERTION` license status and need upstream-license review before a public release decision.

<!-- loadout:current-limits:end -->

The four records have an explicit public-release decision rather than an assumed
license. Read [Upstream license decisions](./docs/UPSTREAM_LICENSE_DECISIONS.md) for
the source-by-source record and the boundary applied to Power, Maximum, and Custom.

Read the [security policy](./SECURITY.md), [catalog policy](./docs/CATALOG_POLICY.md), and [credential and update policy](./docs/CREDENTIAL_AND_UPDATE_POLICY.md) before trusting third-party content.

## Agent support

<!-- loadout:support-summary:start -->

Loadout's adapter capability matrix currently covers **12 agents**: Claude Code, Cline, Codex, Cursor, Gemini CLI, GitHub Copilot, Hermes, Junie, Kiro CLI, OpenCode, Roo Code, Windsurf. See the [complete feature matrix](./docs/FEATURE_TEST_MATRIX.md) for configured paths, filesystem lifecycle, platform, and native-host evidence.

`tests/adapter-conformance.test.ts` plans, applies, inspects, disables, re-enables, and rolls back one skill for every configured target when the suite runs. A configured target path does not prove that the native application recognizes or executes it. Native application execution is not inferred from filesystem simulation.

Configured platform evidence: Linux (CI configured), macOS (CI configured), Windows (CI configured).

Platform evidence source: `.github/workflows/ci.yml (cross-platform job)`.

Configured CI platforms describe a manually triggered workflow, not evidence that a current run passed.

<!-- loadout:support-summary:end -->

Configured paths and disposable filesystem lifecycle tests do not prove that native applications recognize or execute installed skills. Use `loadout capabilities --inspect` for the local component matrix.

## Command reference

Start at the top and stop whenever Loadout does everything you need.

| Priority | What it does                                                    | Command                                                      |
| -------: | --------------------------------------------------------------- | ------------------------------------------------------------ |
|        1 | Opens the beginner-friendly guided path                         | `loadout guide`                                              |
|        2 | Previews the recommended 30-skill daily setup                   | `loadout setup --mode stable`                                |
|        3 | Previews the broader Power setup                                | `loadout setup --mode power`                                 |
|        4 | Downloads the broad screened library, disabled by default       | `loadout setup --mode maximum`                               |
|        5 | Shows Loadout-managed packages and active skills                | `loadout status`; `loadout library`                          |
|        6 | Inventories skills across detected agents without changing them | `loadout scan`                                               |
|        7 | Explains what fits the current repository                       | `loadout recommend --project .`                              |
|        8 | Previews a bounded project-specific active set                  | `loadout optimize --project . --limit 30`                    |
|        9 | Compares existing skills with reviewed catalog copies           | `loadout reconcile --refresh`                                |
|       10 | Checks managed active and disabled-library sources for changes  | `loadout update`                                             |
|       11 | Finds newly launched or newly popular candidates                | `loadout discover --source all --queue`                      |
|       12 | Shows candidates waiting for deeper review                      | `loadout review-queue`                                       |
|       13 | Lists MCP recipes and credential needs                          | `loadout mcp-recipe`; `loadout mcp-recipe --credential-free` |
|       14 | Previews an MCP configuration                                   | `loadout mcp-recipe playwright --agent claude-code`          |
|       15 | Installs Loadout's own skill into your agents                   | `loadout skills install loadout-router --yes`                |
|       16 | Recommends the right model and agent for a task                 | `loadout route design the auth system`                       |
|       17 | Shows the full model catalog with pricing                       | `loadout route --models`; `loadout route --cost`             |
|       18 | Sends a task to another agent via file-based handoff            | `loadout handoff send codex "write tests for auth"`          |
|       19 | Checks agent health, permissions, and setup                     | `loadout doctor`; `loadout doctor --verbose`                 |
|       20 | Lists and installs isolated runtime tools such as Graphify      | `loadout tool`; `loadout tool graphify`                      |
|       21 | Lists snapshots or restores the latest managed change           | `loadout rollback --list`; `loadout rollback`                |
|       22 | Previews removal of one managed package                         | `loadout remove <package-id>`                                |
|       23 | Previews complete removal of Loadout-managed state              | `loadout uninstall`                                          |
|       24 | Enables read-only daily discovery and update checks             | `loadout autopilot --yes`                                    |
|       25 | Shows the complete CLI                                          | `loadout --help`; `loadout advanced`                         |

Most mutating commands are dry runs first. After reading the preview, add `--yes` to
apply. Commands with executable or connection risk require the additional approval
shown in their output.

## Built with Claude

Loadout was designed and built by [Viraj Mishra](https://github.com/VirajMishra1) with Claude Code.

Loadout itself does **not** call any LLM API and does not require an LLM API key
to manage skills. Claude helped build the tool; it is not a hidden runtime dependency.

## Development

```bash
npm ci
npm run verify
npm run verify:full
```

<!-- loadout:verification-summary:start -->

`verify` invokes `format:check`, `lint`, `typecheck`, `check:evidence`, `test`, `test:e2e:cli`, `test:e2e:readme`, `test:package`, `test:performance` in that order. `npm run verify:full` is an alias for the same complete CLI release gate.

<!-- loadout:verification-summary:end -->

The repository's mixed README product-flow test uses an isolated build, disposable state, an offline fixture, direct core calls, and CLI subprocesses. It does not prove live-network availability or behavior inside native agent applications. The [testing guide](./docs/TESTING.md) documents the exact checks and their boundaries.

## Documentation

- [Catalog and upstream credits](./docs/CATALOG.md)
- [Catalog evidence policy](./docs/CATALOG_POLICY.md)
- [Feature and evidence matrix](./docs/FEATURE_TEST_MATRIX.md)
- [Testing contract](./docs/TESTING.md)
- [User test and troubleshooting guide](./docs/USER_TEST_GUIDE.md)
- [Daily discovery snapshot](./docs/DISCOVERED.md)
- [Candidate inspection and promotion](./docs/CANDIDATE_INTELLIGENCE.md)
- [Credential and update policy](./docs/CREDENTIAL_AND_UPDATE_POLICY.md)
- [Upstream license decisions](./docs/UPSTREAM_LICENSE_DECISIONS.md)
- [Changelog](./CHANGELOG.md)

## Contributing, security, and attribution

Keep changes scoped, add regression coverage for behavior changes, and run `npm run verify:full`. Report vulnerabilities through [SECURITY.md](./SECURITY.md), without credentials, private source, or unredacted state. General bugs and proposals belong in the [issue tracker](https://github.com/VirajMishra1/loadout/issues).

The catalog contains 53 credited public repositories. Inclusion records discovery and attribution; it does not transfer ownership, imply endorsement, or relicense upstream work.

## License

Loadout is licensed under the [MIT License](./LICENSE). Catalog entries retain their upstream licenses and terms.
