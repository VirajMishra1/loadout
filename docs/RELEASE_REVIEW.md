# Release review — 2026-07-15

This review covers the current Loadout implementation, not an aspirational
roadmap. It was performed after the transaction, source-fetch, dashboard, and
adapter test suites passed locally.

## P4-08: atomic-commit review — conditional

Mutation metadata that can make a completed install unrecoverable now uses a
temporary sibling file followed by `rename`:

- `~/.loadout/state.json`
- `loadout.lock`
- edits to an existing `loadout.json`
- MCP JSON/TOML config writers already used the same-directory temporary-file
  pattern.

The replacement prevents readers from observing a partially written JSON file
on local filesystems with atomic same-directory rename support. Snapshots are
created before mutation and restoration is exercised by tests. This is not a
claim of durable, power-loss-safe multi-file transactions: a process or system
failure can still leave either the old or new version of an individual file,
and the full cross-platform matrix must confirm Node's rename behavior in the
supported environments.

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

## P9-07: cross-platform go/no-go — no-go for a universal-install claim

The repository has a Windows/macOS/Linux CI matrix and tests path selection,
CRLF handling, Windows command shims, and WSL separation. Those checks do not
replace native installation verification on all three operating systems.

**Current decision:** ship the CLI/dashboard as an experimental, supported-path
prototype, but do not claim native installation has been verified on Windows,
macOS, and Linux. P9-01, P9-03, and P9-04 must be completed with actual native
agent-profile installs before changing this decision.

## Local verification

On 2026-07-15 the following completed successfully:

```text
npm run typecheck
npm test -- --run  # 40 files, 126 tests
npm run build
```
