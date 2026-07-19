# Loadout

**One CLI to inspect, install, update, and roll back extensions for AI coding agents.**

[![CI](https://github.com/VirajMishra1/loadout/actions/workflows/ci.yml/badge.svg)](https://github.com/VirajMishra1/loadout/actions/workflows/ci.yml)
[![Node.js 20+](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](./package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Loadout catalogs pinned public sources, statically inspects selected content, previews
managed filesystem changes, and snapshots supported mutations. It is a CLI-first beta,
not a hosted service or a guarantee that third-party content is safe or useful.

> [!IMPORTANT]
> The repository metadata and Git tag are `0.3.2`, but the npm registry exposed versions
> only through `0.3.1` during the bounded check on 2026-07-19 UTC. Do not run the intended
> release command `npm install --global loadout-ai@0.3.2` until the registry publishes that
> exact version. Use an authorized source checkout now.

[Quickstart](#quickstart) · [Core journey](#preview-apply-inspect-and-roll-back) ·
[Profiles](#choose-a-profile) · [Trust](#trust-and-data-boundaries) ·
[Compatibility](#adapter-compatibility) · [Commands](#commands-by-job) ·
[Limits](#current-beta-limits) · [Troubleshooting](#troubleshooting-and-uninstall) ·
[Development](#development-and-verification)

## Quickstart

You need Node.js 20 or newer, Git, and access to this repository.

```bash
git clone https://github.com/VirajMishra1/loadout.git
cd loadout
npm ci
npm run build
npm link
loadout --version
```

Start with a read-only guide and a disposable test drive:

```bash
loadout guide
loadout demo
```

`loadout demo` uses a temporary profile and cleans it up; it does not write to your
normal agent configuration.

## Preview, apply, inspect, and roll back

The shortest normal journey is preview-first:

```bash
loadout setup --mode stable
loadout setup --mode stable --yes
loadout list
loadout rollback
```

The preview fetches pinned Stable sources, inspects selected skills, resolves target
collisions, and prints findings and destinations without applying them. The apply step
uses a snapshot-backed filesystem transaction and records managed hashes. Explicit
rollback first verifies that the affected roots still match the committed post-change
state; it refuses legacy snapshots and later user edits instead of deleting them.

If a preview reports safety findings, use the exact rerun command it prints. That
command includes `--approve-risk` when the prepared plan requires it. Do not add the
flag without reviewing the findings.

`loadout upgrade` offers the broader read-only path: it detects configured agents,
checks existing managed state, reads bounded project signals, and proposes a screened
upgrade. It changes nothing unless you rerun the displayed plan with approval.

## Choose a profile

| Mode        | Intended use               | Current behavior                                                                                             |
| ----------- | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Stable**  | Bounded default            | Selects 30 skills from four pinned, policy-selected sources                                                  |
| **Power**   | Broader active toolkit     | Selects cross-project skills from eight checked-in collections and quarantines invalid selected units        |
| **Maximum** | Full skill-bearing library | Fetches valid skills into Loadout's managed library and keeps them disabled instead of activating everything |
| **Custom**  | Exact package choices      | Selects only package IDs supplied by the user                                                                |

Preview profiles before applying them:

```bash
loadout profiles
loadout setup --mode stable
loadout setup --mode power
loadout setup --mode maximum
```

Maximum's exact skill count is computed from pinned repository contents at preview
time after validation and duplicate resolution. MCP-only catalog entries remain
separate because they can require credentials, software, or broader permissions.

## Trust and data boundaries

Loadout separates evidence stages instead of calling every catalog record “trusted.”

- A pinned commit identifies source bytes; it does not prove that the source is
  uncompromised, correctly licensed, useful, or compatible forever.
- Static inspection reports scripts, hooks, binaries, domains, credential references,
  and unsupported components. Broad setup does not execute arbitrary third-party
  repository installers.
- Stable is selected by checked-in policy. Policy selection is not human review,
  benchmarking, or universal superiority.
- `recommend` and `optimize` read bounded local metadata such as package manifests,
  dependencies, frameworks, and test configuration. The documented local flow does
  not upload project source.
- Discovery, update checks, catalog fetches, and optional live verification use the
  network where stated. Scheduled discovery and update jobs remain read-only.
- Shared manifests store environment-variable or OS-keychain references, not secret
  values. A model API subscription or key never grants permission to install an MCP
  server.
- Runtime tools and MCP configuration have separate preview and approval paths because
  they can start processes, use credentials, or contact services.

See the [security policy](./SECURITY.md),
[catalog policy](./docs/CATALOG_POLICY.md), and
[credential/update policy](./docs/CREDENTIAL_AND_UPDATE_POLICY.md).

## Catalog, discovery, and recommendations

Loadout discovers broadly, inspects actual pinned contents, records evidence, compares
within categories, assigns bounded policy tiers, and keeps watching for candidates and
changes. Stars are discovery signals, not quality proof.

<!-- loadout:catalog-coverage:start -->

The bundled catalog currently contains **50 credited public repositories** across **37 categories**: **31 have skill components** and **19 are MCP-only**. All 50 are technically screened and pinned; 4 sources are selected by the bounded Stable policy. See every linked source, license status, component type, and pinned commit in **[Catalog and upstream credits](./docs/CATALOG.md)**.

<!-- loadout:catalog-coverage:end -->

<!-- loadout:evidence-stages:start -->

Current catalog evidence-stage counts:

| Stage           | Records |
| --------------- | ------: |
| benchmarked     |       0 |
| discovered      |       0 |
| human-reviewed  |       0 |
| inspected       |      46 |
| policy-selected |       4 |

<!-- loadout:evidence-stages:end -->

Loadout does not claim there is one universally “best” configuration.
Recommendations are rule-based proposals backed by bounded local and repository
evidence:

```bash
loadout recommend --project .
loadout optimize --project .
loadout optimize --project . --limit 30 --yes
```

Daily discovery records review candidates separately from catalog promotion:

```bash
loadout discover --source all --queue
loadout review-queue
loadout candidate inspect owner/repository --output ./candidate-dossier.json
loadout update
```

`loadout update` previews saved-profile and managed-package changes. `loadout update
--yes` applies only eligible screened changes; disabled, risky, or failed entries remain
held for review.

<!-- loadout:daily-discovery:start -->

**Discovery snapshot (generated 2026-07-17):** [242 repositories observed](./docs/DISCOVERED.md), including 219 uncataloged review candidates and 23 repositories already in the inspected catalog.
<!-- loadout:daily-discovery:end -->

The checked-in report proves that snapshot only. It does not prove every scheduled
workflow run succeeds.

## Adapter compatibility

Loadout has configured skill-directory targets and disposable filesystem lifecycle
coverage for 12 adapters. That is not the same as proving that every native
application recognizes, loads, or executes those files.

<!-- loadout:support-summary:start -->

Loadout's adapter capability matrix currently declares configured skill-directory targets for **12 agents**: Claude Code, Cline, Codex, Cursor, Gemini CLI, GitHub Copilot, Hermes, Junie, Kiro CLI, OpenCode, Roo Code, Windsurf.

| Agent          | Skill path         | Disposable filesystem lifecycle | Native application | Platform evidence                                                     |
| -------------- | ------------------ | ------------------------------- | ------------------ | --------------------------------------------------------------------- |
| Claude Code    | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| Cline          | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| Codex          | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| Cursor         | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| Gemini CLI     | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| GitHub Copilot | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| Hermes         | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| Junie          | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| Kiro CLI       | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| OpenCode       | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| Roo Code       | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| Windsurf       | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |

Platform evidence source: `.github/workflows/ci.yml (cross-platform job)`.

`tests/adapter-conformance.test.ts` plans, applies, inspects, disables, re-enables, and rolls back one skill for every row when the suite runs. A configured target path does not prove that the native application recognizes or executes it. Native application execution is not inferred from filesystem simulation. Configured CI platforms describe a manually triggered workflow, not evidence that a current run passed.

<!-- loadout:support-summary:end -->

Use `loadout capabilities --inspect` for the component matrix and local inventory.
The [complete feature matrix](./docs/FEATURE_TEST_MATRIX.md) distinguishes configured
paths, tested filesystem behavior, operating-system evidence, and native-host evidence.

## State, persistence, and architecture

Loadout stores cache, snapshots, transaction journals, managed-file hashes, install
state, and the disabled library under `~/.loadout` by default. Agent-visible files and
explicit MCP configuration remain in their agent-owned locations. State and managed
files persist across CLI invocations and process restarts. Explicit mutations—such as
installs, updates, removes, uninstalls, and rollbacks—can change or remove the relevant
state and managed files.

```text
Pinned catalog or explicit source
              |
              v
    Static inspection + policy
              |
              v
        Read-only preview
              |
              v
      Snapshot + transaction
              |
              v
 Agent targets + managed state
```

Catalog/profile setup performs fetch, inspection, and duplicate resolution before its
managed write. Other mutations have their own planners and boundaries; do not infer
that every command fetches repositories or offers identical recovery. Empty leftover
skill directories are treated as unoccupied only when recursively empty; files and
symlinks still block replacement.

Portable `loadout.json` manifests are schema-validated desired-state declarations.
`loadout.lock` records resolved state. Neither format is intended to contain secret
values.

## Credentials, MCP, and executable tools

Stable, Power, Maximum, discovery, recommendations, updates, and rollback do not
require an OpenAI, Anthropic, or OpenRouter model API key. Declare access without
passing a secret:

```bash
loadout setup --mode stable --api-access none
loadout mcp-recipe --no-key
loadout mcp-recipe --credential-free
```

The no-model-key list can still include non-model service credentials. For example,
GitHub's read-only MCP recipe requires a GitHub token; Playwright and Chrome DevTools
recipes require no credential. MCP configuration remains an explicit preview/apply
flow.

Graphify is a separate checked-in executable recipe with a pinned version and artifact
hash, isolated runtime, explicit approval, and rollback path. This repository evidence
is not an independent security review of Graphify.

```bash
loadout tool graphify --agents codex
loadout tool graphify --agents codex --yes --approve-risk
loadout tool graphify --remove
loadout tool graphify --remove --yes --approve-risk
```

## Commands by job

| Goal                                 | Command                                       |
| ------------------------------------ | --------------------------------------------- |
| Guided read-only path                | `loadout guide`                               |
| Preview an upgrade                   | `loadout upgrade`                             |
| Preview a profile                    | `loadout setup --mode stable\|power\|maximum` |
| List managed packages                | `loadout list`                                |
| Inspect library and activation state | `loadout library`                             |
| Check agents, packages, and drift    | `loadout health --explain`                    |
| Browse or search the catalog         | `loadout catalog`; `loadout search <words>`   |
| Recommend for a project              | `loadout recommend --project .`               |
| Preview or apply eligible updates    | `loadout update`; `loadout update --yes`      |
| Undo the latest supported mutation   | `loadout rollback`                            |
| Remove one managed package           | `loadout remove <package>`                    |
| Preview complete removal             | `loadout uninstall`                           |
| Test in a disposable profile         | `loadout demo`                                |
| Show advanced commands               | `loadout advanced`                            |

Every command remains discoverable through `loadout --help` or `loadout <command>
--help`. Shell completion supports Bash, Zsh, Fish, and PowerShell.

## Current beta limits

- npm `loadout-ai@0.3.2` is not verified as published; source checkout is the current
  usable path for authorized collaborators.
- Native application recognition is not verified for every configured adapter.
- Stable is policy-selected; current catalog evidence has zero human-reviewed and zero
  benchmarked records.
- Static inspection and pinned commits reduce uncertainty but cannot guarantee a
  repository is uncompromised, correctly licensed, or useful.
- MCP-only records require explicit configuration and can require credentials or local
  software. Broad setup installs skill components only.
- The local registry works for development and self-hosting; no hosted Loadout registry
  service exists.
- The loopback dashboard is optional diagnostics, not a hosted product.
- GitHub Actions jobs on recent remote-main commits did not start because of the
  account billing/spending-limit condition. This is not a passing or failing product
  test result.
- GitHub returned 404 for `main` branch protection during the authenticated check on
  2026-07-19 UTC, so protection is absent or not observable.

<!-- loadout:current-limits:start -->

- **6 catalog records** currently have `NOASSERTION` license status and need upstream-license review before a public release decision.

<!-- loadout:current-limits:end -->

No bundled source is called benchmarked until isolated real trials, signed evidence,
and human approval exist.

## Troubleshooting and uninstall

- **`loadout` is not found after linking:** confirm Node 20+ and that npm's global bin
  directory is on `PATH`; rerun `npm run build` and `npm link` from the checkout.
- **A plan asks for `--approve-risk`:** inspect the reported findings, then use the
  exact rerun command printed by Loadout. Do not treat the flag as routine setup.
- **Removal or rollback is refused:** a managed path changed, disappeared, changed
  type, gained new content, or uses a legacy snapshot without post-mutation evidence.
  Preserve and review current files before choosing another recovery path.
- **Network checks fail or time out:** offline/local commands remain separate. A failed
  or unavailable live check is not converted into verified evidence.
- **Need diagnostics:** run `loadout doctor`, `loadout health --explain`, and `loadout
status` before sharing a redacted issue report.

Remove one package with `loadout remove <package>`. Complete uninstall is preview-first:

```bash
loadout uninstall
loadout uninstall --yes
loadout uninstall --yes --remove-cli
```

Complete uninstall removes Loadout-managed files, runtime tools, scheduled jobs, cache,
snapshots, and state. It preserves unmanaged content and stops on modified managed
files unless the user explicitly supplies the uninstall command's `--force` override.

## Development and verification

```bash
npm ci
npm run verify
npm run verify:full
```

`verify` contains one CLI product flow and one mixed core-integration/CLI flow. The
README-specific mixed flow builds in isolation with disposable state and a local
reviewed fixture. Direct core calls cover fixture planning, library installation,
manifest/lock generation, and audit; CLI subprocesses cover optimize preview/apply,
card rendering, and rollback. It does not use a pre-existing `dist` tree, the network,
or a real user profile.

<!-- loadout:verification-summary:start -->

`verify` invokes `format:check`, `lint`, `typecheck`, `check:evidence`, `test`, `test:e2e:cli`, `test:e2e:readme`, `test:package`, `test:performance` in that order. Use `npm run verify:full` to include the optional Playwright dashboard check.

<!-- loadout:verification-summary:end -->

Run the live catalog extension separately:

```bash
LOADOUT_TEST_LIVE_CATALOG=1 npm test -- tests/readme-product-flow.test.ts --run
npm run check:live -- --npm --stable-install --github
```

Live checks report `verified`, `failed`, or `not-verified`. They do not silently turn
missing network access, credentials, publication, or repository settings into success.
See the [testing guide](./docs/TESTING.md),
[release review](./docs/RELEASE_REVIEW.md), and
[stabilization record](./docs/REPOSITORY_STABILIZATION.md).

Before contributing, keep changes scoped, add regression coverage for behavior changes,
and run `npm run verify:full`. Report security issues through the process in
[SECURITY.md](./SECURITY.md); do not attach credentials, private source, or unredacted
state. General bugs and proposals belong in the
[GitHub issue tracker](https://github.com/VirajMishra1/loadout/issues).

## Documentation and attribution

- [Catalog and upstream credits](./docs/CATALOG.md)
- [Daily discovery snapshot](./docs/DISCOVERED.md)
- [Candidate inspection and promotion](./docs/CANDIDATE_INTELLIGENCE.md)
- [Catalog policy](./docs/CATALOG_POLICY.md)
- [Testing guide](./docs/TESTING.md)
- [Feature and evidence matrix](./docs/FEATURE_TEST_MATRIX.md)
- [Repository stabilization record](./docs/REPOSITORY_STABILIZATION.md)
- [Engineering master plan](./MASTER_PLAN.md)
- [Changelog](./CHANGELOG.md)

Catalog inclusion is attribution and discovery metadata, not ownership, endorsement,
or relicensing.

## License

Loadout is licensed under the [MIT License](./LICENSE). Catalog entries retain their
upstream licenses and terms.
