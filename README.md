# Loadout

Loadout is a universal upgrade manager for AI coding agents. It discovers, installs,
synchronizes, and updates trusted skills and MCP tools across Claude Code, Codex,
Cursor, Gemini CLI, OpenCode, Hermes, and other compatible agents.

The project is being built for the OpenAI Build Week **Developer Tools** category.

## Status

The first working vertical slice is now implemented: Loadout detects installed agents,
fetches a real public GitHub repository at its current commit, finds its `SKILL.md`
packages, creates a preview plan, installs into agent-specific directories, and records
a rollback snapshot. Nitish's branch also includes a validated shareable manifest,
lockfile generation, safe managed-file removal, drift-aware health reports, tested
profiles, local project recommendations, transactional multi-package sync, applied
updates with risk approval, and an evidence-first improvement proposal command.

See [NITISH_MASTER_PLAN.md](./NITISH_MASTER_PLAN.md) for the expanded implementation
plan and [SIMPLE_PLAN.md](./SIMPLE_PLAN.md) for the short plain-language version. The
original hackathon baseline remains in [MASTER_PLAN.md](./MASTER_PLAN.md).

## Supported platforms

| Platform | Detection | Skill target roots | Verification |
| --- | --- | --- | --- |
| macOS | `PATH` executable or existing agent directory | Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Hermes | CI matrix + local smoke tests |
| Linux | `PATH` executable or existing agent directory | Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Hermes | CI matrix + local smoke tests |
| Windows | `PATH` executable/`.cmd` resolution or existing agent directory | Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Hermes | CI matrix; native install coverage remains in progress |
| WSL | Linux executable and POSIX `$HOME` only | Linux-side agent directories only | Deterministic boundary tests + Linux CI |

Loadout writes to the detected agent's documented user directory and supports
`LOADOUT_USER_HOME` for an isolated test or demo profile. It does not claim that every
agent supports every component: `loadout capabilities` reports each adapter as native,
adapted, or unsupported before installation.

WSL is deliberately treated as Linux: when a Linux-side CLI runs under WSL, Loadout
uses its POSIX `$HOME` and never translates `USERPROFILE` into `/mnt/c`. Run Loadout
from native Windows if you want to manage the Windows-side agent profile.

## Nitish branch commands

```bash
# Create and validate a shareable desired-state file.
node dist/src/cli.js init --name my-team
node dist/src/cli.js sync --manifest loadout.json       # dry run
node dist/src/cli.js sync --manifest loadout.json --yes # apply as one transaction

# Understand and maintain the current setup.
node dist/src/cli.js list
node dist/src/cli.js health
node dist/src/cli.js capabilities
node dist/src/cli.js recommend --project .
node dist/src/cli.js profiles
node dist/src/cli.js improve
node dist/src/cli.js improve --write
node dist/src/cli.js improve-feedback --id <cycle-id> --outcome partial --note "What remains"
node dist/src/cli.js search playwright
node dist/src/cli.js audit --manifest loadout.json --lock loadout.lock
node dist/src/cli.js keygen --private-key ~/.loadout/signing-private.pem --public-key ./loadout-public.pem
node dist/src/cli.js catalog-sign --catalog catalog/packages.json --private-key ~/.loadout/signing-private.pem --output catalog.signed.json
node dist/src/cli.js catalog-verify --snapshot catalog.signed.json --public-key ./loadout-public.pem
node dist/src/cli.js export team.loadout.json --manifest loadout.json --lock loadout.lock
node dist/src/cli.js import team.loadout.json                         # dry run
node dist/src/cli.js import team.loadout.json --yes                  # refuses existing files
node dist/src/cli.js import team.loadout.json --yes --overwrite      # snapshots first

# Create and publish an immutable package to the local registry.
node dist/src/cli.js create ./my-package --name my-package
node dist/src/cli.js pack ./my-package
node dist/src/cli.js publish ./my-package --local
node dist/src/cli.js add my-package --registry my-package@0.1.0

# Run the same immutable protocol locally, then publish/fetch remotely.
LOADOUT_REGISTRY_TOKEN='<secret>' node dist/src/cli.js registry-serve --port 7331
LOADOUT_REGISTRY_TOKEN='<secret>' node dist/src/cli.js publish ./my-package --registry-url http://127.0.0.1:7331
node dist/src/cli.js add my-package --registry my-package@0.1.0 --remote-registry http://127.0.0.1:7331

# Safe package lifecycle.
node dist/src/cli.js remove <package-id>                # dry run
node dist/src/cli.js remove <package-id> --yes
node dist/src/cli.js update
node dist/src/cli.js update --package <package-id> --apply
node dist/src/cli.js lock
```

`improve` is deliberately read-only. It selects the next improvement from health
evidence and produces acceptance tests; it never edits, installs, publishes, merges,
or grants permissions autonomously. `--write` stores an owner-only JSON record and
reusable Markdown loop prompt. Human-reviewed success, partial, or failure outcomes can
be recorded locally and are summarized into later cycles; secret-like notes are refused.

MCP packages are configured explicitly in `loadout.json`; Loadout never guesses a
configuration path. A package can select all discovered servers or a named subset:

```json
{
  "id": "docs-mcp",
  "source": { "type": "github", "repository": "owner/docs-mcp" },
  "mcp": {
    "config": "/absolute/path/to/agent-mcp.json",
    "servers": ["docs"]
  }
}
```

`sync --yes` still refuses MCP changes until `--approve-risk` is also provided. MCP
ownership is recorded by fingerprint, health/audit detect drift, removal preserves
unrelated keys and servers, and rollback restores both configuration and Loadout state.

Project or global root files also require explicit scoped exports. Relative source and
target paths cannot escape the package or allowed project/home scope:

```json
"rootFiles": [
  { "source": "AGENTS.md", "target": "AGENTS.md" }
]
```

Claude plugin manifests are detected during inspection. Their skills, rules, commands,
and agents are normalized through the ordinary compatibility planner; Loadout does not
claim that copying a native plugin manifest itself converts plugin-only behavior.

`loadout capabilities` is the source of truth for every agent/component claim. Each
cell is `native`, `adapted`, or `unsupported`; the planner consults the same matrix, so
the documentation cannot quietly claim more than the installer enables. Detection uses
either an executable on `PATH` or an existing agent configuration directory.

## Try the real install path

```bash
npm install
npm run build
node dist/src/cli.js status
node dist/src/cli.js doctor
node dist/src/cli.js catalog
node dist/src/cli.js mcp --repository upstash/context7
node dist/src/cli.js plan --repository obra/superpowers --package obra-superpowers --agents codex
node dist/src/cli.js install --repository obra/superpowers --package obra-superpowers --agents codex --yes
node dist/src/cli.js rollback
```

Repository installs are currently public GitHub repositories only. Loadout clones a
shallow snapshot, records the resolved commit, never runs repository lifecycle scripts,
and copies only discovered `SKILL.md` directories into the selected agent roots.

## Catalog provenance and attribution

The bundled catalog contains 18 public repositories selected for inspectable skills,
plugins, or MCP tooling. Every record pins the GitHub HEAD commit observed on
2026-07-14 and records the exact repository-relative paths used as component evidence.
It also records the SPDX identifier GitHub returned; `NOASSERTION` means GitHub did
not report an SPDX license, not that Loadout inferred one. The catalog is a discovery
index, not a redistribution of any upstream package: the source, license, and current
upstream terms always remain authoritative.

`loadout catalog --refresh` refreshes mutable metadata such as stars and topics, but
does not rewrite the reviewed commit evidence. A future catalog-review update must
verify a new commit and its paths before changing those fields.

## Two-minute hackathon demo

This is a live-data demo: the package is fetched from GitHub at the time you run it,
and the catalog can be refreshed from the GitHub API. It does not rely on seeded
install results. The install below uses a disposable profile so a demo cannot alter a
developer's existing agent configuration.

In terminal 1, build and open the local dashboard:

```bash
npm install
npm run build
npm run dashboard
```

Open <http://127.0.0.1:4173>. The page reads the detected agents and the real catalog
from this checkout. It also shows health, updates, local project recommendations,
tested profiles, and locally published registry packages. The dashboard can preview
and apply plans that require no risk override, then undo that exact dashboard change.
Mutations require a private same-origin session token; risky plans remain CLI-only.

In terminal 2, run the story in this order:

```bash
# Keep all demo writes in a temporary home and Loadout state directory.
DEMO_HOME="$(mktemp -d)"
export LOADOUT_USER_HOME="$DEMO_HOME"
export LOADOUT_HOME="$DEMO_HOME/.loadout"

# 1. Detect the agents available on this machine and check prerequisites.
node dist/src/cli.js status
node dist/src/cli.js doctor

# 2. Show the curated, real-repository catalog (refresh is optional but compelling).
node dist/src/cli.js catalog --refresh

# 3. Inspect a real MCP repository without starting its server or running scripts.
node dist/src/cli.js mcp --repository upstash/context7

# 4. Preview, then apply, a real skill package from GitHub.
node dist/src/cli.js plan --repository obra/superpowers --package obra-superpowers --agents codex
node dist/src/cli.js install --repository obra/superpowers --package obra-superpowers --agents codex --yes

# 5. Show commit-aware update status, then demonstrate one-command recovery.
node dist/src/cli.js update
node dist/src/cli.js rollback
```

The narrative is: one catalog replaces repository-hopping; the plan makes every file
change visible; the installer records the exact Git commit; and rollback restores the
previous state. For a presentation, leave the dashboard visible between steps 1 and 2
and show the generated snapshot identifier after step 4.

On Windows PowerShell, use these equivalent setup commands before running the same
`node dist/src/cli.js` commands:

```powershell
$env:LOADOUT_USER_HOME = Join-Path $env:TEMP ("loadout-demo-" + [guid]::NewGuid())
$env:LOADOUT_HOME = Join-Path $env:LOADOUT_USER_HOME ".loadout"
New-Item -ItemType Directory -Force $env:LOADOUT_USER_HOME | Out-Null
```

## How it works

```mermaid
flowchart LR
  A[CLI or dashboard] --> B[Detect installed agents]
  B --> C[Curated catalog]
  C --> D[GitHub shallow snapshot]
  D --> E[Resolve SKILL.md and MCP manifests]
  E --> F[Plan files and configuration]
  F --> G{User confirmation}
  G -->|yes| H[Transactional install + hash state]
  H --> I[Update check and rollback snapshot]
  G -->|no| J[Dry-run output]
```

Discovery and planning are read-only. Installation writes only the selected package's
managed directories, and the current implementation never executes third-party
repository lifecycle scripts. The loopback API and dashboard expose status, health,
catalog, updates, recommendations, and authenticated safe sync/rollback actions.

## Current demo boundaries

- Public GitHub repositories are supported; private-repository OAuth is planned.
- The install path currently handles skill directories containing `SKILL.md`.
- MCP manifests can be inspected and MCP JSON configuration changes can be planned or
  applied, but MCP processes are not launched by Loadout.
- The catalog is curated rather than an index of every repository on the internet.
- Updates are reported and installs are transactional; autonomous background updates
  and signed catalog releases are not yet enabled.
- The manifest currently resolves catalog, public GitHub refs/subpaths, generic HTTPS
  or SSH Git sources, and local sources. Manifest dependencies are ordered and missing,
  disabled, or cyclic dependencies are rejected. Registry package descriptors resolve
  exact transitive production dependencies; development dependencies require explicit
  `includeDevDependencies: true`. Cycles and incompatible versions are blocked, and the
  expanded dependency graph is recorded in the lockfile. Skills, conventional rule directories,
  command directories, and agent directories are normalized; unsupported targets are
  skipped rather than falsely converted. Plugin/root-file application, automated MCP
  targeting for non-JSON agent formats and native plugin-only behavior remain planned.
  Loadout now includes a small authenticated
  registry protocol: exact versions are immutable, downloaded files and package digests
  are verified, publishing uses `LOADOUT_REGISTRY_TOKEN`, and non-loopback clients require
  HTTPS. The included server is suitable for local development or self-hosting; no public
  Loadout hosting service is claimed or deployed yet.

Portable exports contain the validated manifest and, when requested, its exact lockfile.
Absolute local package paths are refused because another machine cannot reproduce them.
Import is a dry run by default, will not silently replace files, snapshots destinations
before writing, and can be undone with the reported snapshot id.

## Core promise

Run one command, let Loadout detect the agents on your computer, and choose either a
stable or maximum universal boost. Loadout handles platform-specific installation,
keeps a record of every change, and can roll back to the last working configuration.
