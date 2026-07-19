# Release review — historical 2026-07-15 review, updated 2026-07-19

## Current status and evidence boundary

The sections below preserve the evidence recorded for the earlier 0.1.0 review; their
old package version, catalog count, and test totals are historical and must not be read
as current 0.3.2 results. The checked-in package is now 0.3.2 with a 50-record catalog.

On 2026-07-19, the focused v0.3.x regression run passed 58 tests covering the unified
upgrade, saved-profile updates, complete uninstall, separation of model API access from
service credentials, and recursively empty skill-directory recovery. The later
`npm run verify:full` result is bound to exact tested commit
`8f8eccdd20272ebb88d0339087fc9cd3828e65c9`: its deterministic evidence gate, 552 tests
with one explicit skip, both CLI product journeys, package smoke, the 1,000-skill
performance gate, and two Playwright dashboard projects passed. The evidence-only
follow-up commit that records this statement was not represented as part of that tested
commit. These local results establish the tested repository behaviors only; they do not
retroactively establish native-agent recognition, current npm publication, branch
protection, or an independent security review.

The separate [sanitized live-check report](./evidence/live-checks-2026-07-19.json) was
generated at `2026-07-19T13:45:14.945Z`. At that historical observation time, the pinned
Stable install and rollback were verified; npm returned 404 for `loadout-ai@0.3.2`; and
authenticated GitHub access reached the repository but branch protection for `main`
returned 404. These results can change after the timestamp and are not part of the
deterministic offline gate.

At the time it was written, this review covered the then-current Loadout
implementation, not an aspirational roadmap. It was performed after the transaction,
source-fetch, dashboard, and adapter test suites passed locally.

## P4-08: atomic-commit review — accepted with explicit durability boundary

Mutation metadata that can make a completed install unrecoverable now uses a
temporary sibling file followed by `rename`:

- `~/.loadout/state.json`
- `loadout.lock`
- edits to an existing `loadout.json`
- MCP JSON/TOML config writers already used the same-directory temporary-file
  pattern.

The replacement prevents readers from observing a partially written JSON file
on local filesystems with atomic same-directory rename support. Snapshots are
created before mutation and restoration is exercised by tests. CI run
`29401149042` executed the atomic-file and transaction suites on Node 20 and
22 for Windows, macOS, and Linux. The decision is therefore accepted for the
supported local-filesystem scope.

This is not a claim of durable, power-loss-safe multi-file transactions: a
process or system failure can still leave either the old or new version of an
individual file. Transaction journals recover interrupted multi-file work before
the next synchronization; users needing database-grade durability should not rely
on filesystem rename alone.

## P7-15: product and security review — pass with stated boundaries

The reviewed release flow is appropriate for a hackathon demo and local use:

- Plans are read-only until an explicit apply command or dashboard action.
- Install/update safety requires approval for scripts, hooks, binaries, new
  domains, environment references, suspicious instructions, and MCP changes.
- Snapshots are taken before managed mutations; failures restore them.
- Repository cloning does not run package lifecycle scripts. Generic Git URLs
  with embedded credentials, query strings, or fragments are rejected so a
  failed Git command cannot echo a token.
- The API is loopback-only. The dashboard also validates the actual socket peer
  instead of trusting a spoofable `Host` header; mutation endpoints require a
  random per-process session token and reject cross-origin requests.
- The dashboard and CLI summaries avoid emitting MCP environment values.

Known boundaries remain intentional: Loadout does not execute third-party
install scripts, silently replace existing Codex TOML MCP tables, or support
private repository credentials. It should not be marketed as a full arbitrary
plugin executor.

## P9-07: cross-platform go/no-go — bounded go for native skills

CI run `29401149042` planed, installed, byte-verified, and removed a real
`SKILL.md` through every declared agent-owned skill layout on Windows, macOS,
and Linux, using disposable native home and state directories. **Current
decision:** go for the bounded native-skill-directory claim. The no-go remains
for plugins, hooks, executables, and arbitrary MCP runtimes.

## Local verification

On 2026-07-15 the corrective audit also verified:

```text
npm run format:check
npm run lint
npm run typecheck
npm test -- --run        # 55 files, 169 tests
npm run build
npm run test:e2e         # Chromium first-run preview/apply flow
```

The audit fixed these release blockers and added regressions for them:

- Vitest now assigns every test file disposable Loadout and user homes; a CRLF
  fixture can no longer write into the developer's real `~/.loadout`.
- A stale refresh cache overlays mutable metadata onto the bundled catalog instead
  of hiding newer bundled records or retaining deleted cache-only packages.
- The Maximum profile references only catalog packages that actually exist.
- Dashboard Installed and Updates routes have unique container/list IDs and are
  exercised through navigation in Playwright.
- Demo output distinguishes planned skill directories from tracked files instead of
  printing an impossible installed/total fraction.
- Multi-file synchronization now writes a durable journal and recovers interrupted
  work even when the next synchronization is otherwise empty.
- The npm tarball exposes the `loadout` executable, carries runtime code/assets but
  not compiled tests, and resolves its catalog/dashboard independently of the current
  working directory.

An outside-checkout 72-file tarball smoke test launched version `0.1.0`, read all 20
catalog records, and served the packaged dashboard. The live isolated demo fetched
`obra/superpowers`, planned 14 skill directories and 48 files, then verified rollback
and removed its temporary profile. The npm package is named `loadout-ai`; the shorter
`loadout` registry name is owned by an unrelated package.

## CLI-first product correction

The dashboard is now explicitly secondary. Running `loadout` in an interactive terminal
starts Maximum/Stable/Custom onboarding, while `loadout setup --mode maximum` provides
a scriptable read-only preview and `--yes --approve-risk` applies the reviewed result.

Catalog setup now:

- filters out MCP/executable-only records before cloning;
- fetches up to four repositories concurrently with visible progress;
- fetches the catalog's exact reviewed commit rather than mutable default-branch HEAD;
- reuses only a clean cache whose Git HEAD matches that commit;
- resolves duplicate skill targets by retaining the higher-ranked reviewed source and
  reporting every lower-ranked duplicate;
- installs all remaining packages through one transaction and one restore point;
- keeps local health checks network-free unless `--updates` is explicitly requested.

A disposable real Maximum Boost run prepared all 31 skill-bearing repositories from the
50-record catalog, deferred 19 explicit MCP-only setups, exposed 1,219 skill directories,
and resolved 48 duplicate target directories. The same isolated flow exercised library
inspection, project optimization, apply, and rollback successfully before removing its
test home. No real user agent directory was used.
