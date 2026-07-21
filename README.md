<p align="center">
  <img src="./docs/assets/loadout-workflow.png" alt="Loadout workflow: choose extensions, inspect sources, preview changes, apply through a managed snapshot, and undo safely across supported AI coding agents." width="960">
</p>

<h1 align="center">Loadout</h1>

<p align="center"><strong>Agent extensions, under control.</strong></p>

<p align="center">
  One CLI to discover, install, update, and undo skills and tools across your AI coding agents.
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
> Installation is version-pinned so the code you test matches these docs. The commands below target `loadout-ai@0.5.6`; review the preview before every apply.

```bash
npm install --global loadout-ai@0.5.6
loadout setup --mode stable
```

That second command is a preview. It detects your agents and shows what Stable would
install. Nothing enters Claude Code, Codex, Cursor, or another agent until you approve
it with `--yes`.

## How it works

**Choose -> Inspect -> Preview -> Apply -> Undo**

1. **Choose** Stable, Power, Maximum, or your own package list.
2. **Inspect** where each extension comes from and what it can do.
3. **Preview** every planned change without changing agent files.
4. **Apply** with `--yes`; Loadout saves a rollback snapshot first.
5. **Undo** with `loadout rollback` if you change your mind.

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

Preview may fill Loadout's private download cache, but it does not change your agent
files. Review the summary and warnings before approving an apply command.

## Why Loadout

Skills, plugins, MCP servers, and agent settings tend to accumulate one experiment at a time. Eventually it becomes hard to remember what is installed, where it came from, or how to undo it. In a game, a loadout is the deliberate set of tools chosen before a mission. Loadout brings that same discipline to AI coding agents: inspect the available equipment, choose intentionally, apply it through managed changes, and remove or roll it back later.

- **One inventory.** See what is installed, where it came from, and which files
  Loadout manages across your agents.
- **Safe by default.** Setup, updates, MCP configuration, removal, and uninstall show
  a preview first.
- **Easy to undo.** Every supported change creates a snapshot, while later manual
  edits are protected from accidental overwrite.

## Install

You need Node.js 20 or newer and Git.

```bash
npm install --global loadout-ai@0.5.6
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

For your first preview, run:

```bash
loadout setup --mode stable
```

Nothing is installed until you approve the preview. If a command is not found or a
network check fails, use the [user test guide](./docs/USER_TEST_GUIDE.md).

## Stable workflow

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

Stable selects 30 useful skill directories from four public sources fixed to exact
GitHub commits with identified licenses. It is Loadout's recommended everyday
starting point, not a claim that one setup is best for every person or project.

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

| Profile     | Scope                                                                |
| ----------- | -------------------------------------------------------------------- |
| **Stable**  | Recommended: 30 active skills for everyday development               |
| **Power**   | 50 active skills per agent for people who want a broader toolkit     |
| **Maximum** | The broad screened library, stored disabled; activate only what fits |
| **Custom**  | Install only the packages you name                                   |

Run `loadout profiles` to compare them. Stable is the normal starting point. Power
keeps more skills active. Maximum downloads the broad library without exposing it all
to every prompt; `loadout optimize --project .` proposes a project-specific active
set. MCP servers always use a separate approval step.

## MCP integrations

Profiles never start MCP servers silently. First list the available recipes and see
which ones need credentials:

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

Configuration alone does not start the server. Test a real connection separately
with `--connect --approve-risk`. Loadout can reference credentials from environment
variables or the OS keychain without printing their values.

## Optional runtime tools

[Graphify](https://github.com/Graphify-Labs/graphify) is an optional codebase graph
tool. It installs both a command and an agent skill, so Loadout keeps it separate from
the normal profiles. It does not require an OpenAI or Anthropic API key:

```bash
loadout tool graphify --agents codex,claude-code
loadout tool graphify --agents codex,claude-code --yes --approve-risk
loadout tool graphify --remove --agents codex,claude-code --yes --approve-risk
```

Executable tools remain an explicit choice instead of hiding inside a profile.

## Catalog and discovery

<!-- loadout:catalog-coverage:start -->

The bundled catalog currently contains **53 credited public repositories** across **39 categories**: **34 have skill components** and **19 are MCP-only**. All 53 are technically screened and pinned; 4 sources are selected by the bounded Stable policy. See every linked source, license status, component type, and pinned commit in **[Catalog and upstream credits](./docs/CATALOG.md)**.

<!-- loadout:catalog-coverage:end -->

<!-- loadout:evidence-stages:start -->

Catalog maturity: **53 sourced**, **53 technically inspected**, and **4 selected for Stable**. Independent human-review attestations and signed comparative benchmarks are not yet published, so Loadout does not pretend static inspection proves usefulness. The pinned catalog remains usable today, and local outcomes can be recorded to improve later rankings. Definitions and promotion rules are in the [catalog policy](./docs/CATALOG_POLICY.md).

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

| What you want                      | Command                              |
| ---------------------------------- | ------------------------------------ |
| Start with guidance                | `loadout guide`                      |
| Install the recommended setup      | `loadout setup --mode stable`        |
| See installed and existing skills  | `loadout status`; `loadout scan`     |
| Manage skills you already had      | `loadout reconcile --refresh`        |
| Choose skills for the current repo | `loadout optimize --project .`       |
| Find newly launched projects       | `loadout discover --source all`      |
| Check for updates                  | `loadout update`                     |
| Undo a change                      | `loadout rollback`                   |
| Configure an MCP server            | `loadout mcp-recipe`                 |
| Install or remove Graphify         | `loadout tool graphify [--remove]`   |
| Remove all Loadout-managed data    | `loadout uninstall`                  |
| See every advanced command         | `loadout advanced`; `loadout --help` |

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
- [Changelog](./CHANGELOG.md)

## Contributing, security, and attribution

Keep changes scoped, add regression coverage for behavior changes, and run `npm run verify:full`. Report vulnerabilities through [SECURITY.md](./SECURITY.md), without credentials, private source, or unredacted state. General bugs and proposals belong in the [issue tracker](https://github.com/VirajMishra1/loadout/issues).

The catalog contains 53 credited public repositories. Inclusion records discovery and attribution; it does not transfer ownership, imply endorsement, or relicense upstream work.

## License

Loadout is licensed under the [MIT License](./LICENSE). Catalog entries retain their upstream licenses and terms.
