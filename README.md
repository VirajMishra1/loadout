<p align="center">
  <img src="./docs/assets/loadout-workflow.png" alt="Loadout workflow: choose extensions, inspect sources, preview changes, apply through a managed snapshot, and undo safely across supported AI coding agents." width="960">
</p>

<h1 align="center">Loadout</h1>

<p align="center"><strong>Agent extensions, under control.</strong></p>

<p align="center">
  A local CLI for inspecting, previewing, installing, and undoing managed extensions for AI coding agents.
</p>

<p align="center">
  <a href="https://github.com/VirajMishra1/loadout/actions/workflows/ci.yml"><img src="https://github.com/VirajMishra1/loadout/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="./package.json"><img src="https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&amp;logoColor=white" alt="Node.js 20 or newer"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
</p>

<p align="center">
  <a href="#how-it-works">How it works</a> ·
  <a href="#install">Install</a> ·
  <a href="#profiles">Profiles</a> ·
  <a href="#trust-and-limits">Trust</a> ·
  <a href="#command-reference">Commands</a> ·
  <a href="#development">Development</a>
</p>

> [!IMPORTANT]
> Installation is version-pinned so the code you test matches these docs. The commands below target `loadout-ai@0.5.2`; review the preview before every apply.

## How it works

**Choose -> Inspect -> Preview -> Apply -> Undo**

1. **Choose** a bounded profile or explicit packages.
2. **Inspect** pinned source and catalog metadata separately before setup.
3. **Preview** detected agents, aggregate repository, directory, and collision counts, warnings, skipped entries, and package IDs needing approval without changing agent target files.
4. **Apply** by rerunning with `--yes`; Loadout recomputes from current state before using a snapshot-backed transaction.
5. **Undo** the latest supported mutation with drift checks that protect later edits.

### Abridged terminal transcript

This is an explicitly abridged transcript from a disposable, single-Codex Stable run. A literal `…` marks omitted fetch output; `<snapshot-id>` is a variable placeholder because snapshot IDs vary.

```console
$ loadout setup --mode stable --agents codex
…
Loadout: Stable Boost
Detected agents: Codex
Catalog selection: 4 repositories
Ready to install: 4 skill repositories (30 agent skill directories)
Preview complete; nothing was changed. Re-run with --yes to install this exact screened plan.

$ loadout setup --mode stable --agents codex --yes
…
Loadout installed 4 repositories for 1 agent(s). Snapshot: <snapshot-id>

$ loadout rollback
Restored snapshot <snapshot-id>
```

The final preview sentence above is captured CLI wording. A later `--yes` invocation recomputes the plan from pinned sources and current agent and filesystem state; it does not persist or prove identity with the earlier preview.

Preview may populate Loadout's own cache; it leaves agent target files unchanged. Review its aggregate counts, warnings, skipped entries, and package IDs needing approval before deciding whether to run a later apply command.

## Why Loadout

Skills, plugins, MCP servers, and agent settings tend to accumulate one experiment at a time. Eventually it becomes hard to remember what is installed, where it came from, or how to undo it. In a game, a loadout is the deliberate set of tools chosen before a mission. Loadout brings that same discipline to AI coding agents: inspect the available equipment, choose intentionally, apply it through managed changes, and remove or roll it back later.

- **One managed inventory.** List installed packages, inspect drift, and track what Loadout owns across configured agent paths.
- **Preview by default.** Setup, updates, removal, MCP recipes, and uninstall expose a plan before their supported writes.
- **Recoverable changes.** Snapshots and managed-file hashes support rollback while refusing to overwrite later user edits.

## Install

You need Node.js 20 or newer and Git.

```bash
npm install --global loadout-ai@0.5.2
loadout --version
loadout guide
```

For source development instead:

```bash
git clone https://github.com/VirajMishra1/loadout.git
cd loadout
npm ci
npm run build
npm link
loadout --version
```

For a first read-only preview, run:

```bash
loadout setup --mode stable
```

Nothing is installed until you explicitly approve the preview. See the [user test guide](./docs/USER_TEST_GUIDE.md) if linking, `PATH`, networking, risk approval, or rollback needs attention.

## Stable workflow

```bash
# Preview for detected agents
loadout setup --mode stable

# Recompute from current state and apply after reviewing the preview
loadout setup --mode stable --yes

# Inspect managed state, then undo the latest supported mutation
loadout list
loadout health --explain
loadout rollback
```

Stable currently selects 30 skill directories from four pinned, SPDX-identified, policy-selected public sources. Selection policy is evidence, not a claim that the sources are safe, trusted, human-reviewed, benchmarked, or the right choice for every user.

## Profiles

| Profile     | Scope                                                                 |
| ----------- | --------------------------------------------------------------------- |
| **Stable**  | 30 active everyday skills from four pinned sources                    |
| **Power**   | A deliberately larger active toolkit from eight pinned collections    |
| **Maximum** | Every screened skill in a disabled library; activate relevant subsets |
| **Custom**  | Only package IDs explicitly supplied by the user                      |

Run `loadout profiles` to compare them and `loadout setup --mode <profile>` to preview one. Stable limits context. Power trades more context for broader always-available capability. Maximum gives you the largest library without injecting thousands of skills into every prompt; `loadout optimize --project .` chooses a relevant working set. MCP-only entries stay on a separate approval path.

## MCP integrations

MCP servers are not silently started by Stable, Power, or Maximum. List the reviewed recipes and their credential requirements:

```bash
loadout mcp-recipe
loadout mcp-recipe --credential-free
```

Preview and configure one for the host you use:

```bash
loadout mcp-recipe playwright --agent codex
loadout mcp-recipe playwright --agent codex --yes
loadout mcp-recipe playwright --agent codex --verify

loadout mcp-recipe playwright --agent claude-code
loadout mcp-recipe playwright --agent claude-code --yes
```

Configuration does not launch the server. A real bounded handshake requires the separate `--connect --approve-risk` action. Credentialed recipes accept environment or keychain references, never secret values in command output.

## Optional runtime tools

[Graphify](https://github.com/Graphify-Labs/graphify) is available as a separate,
reviewed local runtime recipe because it installs an executable as well as an agent
skill. It does not need an OpenAI or Anthropic API key. Loadout previews the pinned
artifact, permissions, targets, and rollback scope before doing anything:

```bash
loadout tool graphify --agents codex,claude-code
loadout tool graphify --agents codex,claude-code --yes --approve-risk
loadout tool graphify --remove --agents codex,claude-code --yes --approve-risk
```

Graphify is intentionally not hidden inside Stable, Power, or Maximum: executable
tools always remain an explicit choice.

## Catalog and discovery

<!-- loadout:catalog-coverage:start -->

The bundled catalog currently contains **51 credited public repositories** across **38 categories**: **32 have skill components** and **19 are MCP-only**. All 51 are technically screened and pinned; 4 sources are selected by the bounded Stable policy. See every linked source, license status, component type, and pinned commit in **[Catalog and upstream credits](./docs/CATALOG.md)**.

<!-- loadout:catalog-coverage:end -->

<!-- loadout:evidence-stages:start -->

Catalog maturity: **51 sourced**, **51 technically inspected**, and **4 selected for Stable**. Independent human-review attestations and signed comparative benchmarks are not yet published, so Loadout does not pretend static inspection proves usefulness. The pinned catalog remains usable today, and local outcomes can be recorded to improve later rankings. Definitions and promotion rules are in the [catalog policy](./docs/CATALOG_POLICY.md).

<!-- loadout:evidence-stages:end -->

Loadout does not claim there is one universally “best” configuration. Recommendations are bounded, rule-based proposals; stars and discovery results are signals for review, not quality proof.

<!-- loadout:daily-discovery:start -->

**Discovery snapshot (generated 2026-07-21):** [240 repositories observed](./docs/DISCOVERED.md), including 216 uncataloged review candidates and 24 repositories already in the inspected catalog.
<!-- loadout:daily-discovery:end -->

The checked-in discovery report proves only its dated snapshot, not the success of every scheduled run. Use `loadout discover --source all --queue`, `loadout review-queue`, and `loadout candidate inspect owner/repository` to inspect candidates before catalog promotion.

## Trust and limits

- A pinned commit identifies source bytes; it does not prove safety, correct licensing, usefulness, or future compatibility.
- Static inspection reports scripts, hooks, binaries, domains, credential references, and unsupported components. It is not a security audit.
- No bundled source is called benchmarked until isolated real trials, signed evidence, and human approval exist.
- Project recommendations read bounded local metadata. The documented local flow does not upload project source.
- Catalog fetches, discovery, update checks, and optional live checks use the network where stated.
- MCP servers and executable tools have separate preview and approval paths because they can use credentials, start processes, or contact services.
- Shared manifests hold environment-variable or OS-keychain references, not secret values.

<!-- loadout:current-limits:start -->

- **6 catalog records** currently have `NOASSERTION` license status and need upstream-license review before a public release decision.

<!-- loadout:current-limits:end -->

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

| Job                                | Command                                     |
| ---------------------------------- | ------------------------------------------- |
| Guided read-only path              | `loadout guide`                             |
| Preview or apply a profile         | `loadout setup --mode stable [--yes]`       |
| List and inspect managed state     | `loadout list`; `loadout health --explain`  |
| Browse or search                   | `loadout catalog`; `loadout search <words>` |
| Recommend for a project            | `loadout recommend --project .`             |
| Preview or apply updates           | `loadout update [--yes]`                    |
| Undo the latest supported mutation | `loadout rollback`                          |
| Remove one managed package         | `loadout remove <package>`                  |
| Preview complete removal           | `loadout uninstall`                         |
| List reviewed MCP integrations     | `loadout mcp-recipe`                        |
| Discover the full surface          | `loadout --help`; `loadout advanced`        |

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
- [Repository stabilization record](./docs/REPOSITORY_STABILIZATION.md)
- [Engineering plan](./MASTER_PLAN.md) and [changelog](./CHANGELOG.md)

## Contributing, security, and attribution

Keep changes scoped, add regression coverage for behavior changes, and run `npm run verify:full`. Report vulnerabilities through [SECURITY.md](./SECURITY.md), without credentials, private source, or unredacted state. General bugs and proposals belong in the [issue tracker](https://github.com/VirajMishra1/loadout/issues).

The catalog contains 51 credited public repositories. Inclusion records discovery and attribution; it does not transfer ownership, imply endorsement, or relicense upstream work.

## License

Loadout is licensed under the [MIT License](./LICENSE). Catalog entries retain their upstream licenses and terms.
