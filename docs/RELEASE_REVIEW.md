# Release review — 2026-07-15

This review covers the current Loadout implementation, not an aspirational
roadmap. It was performed after the transaction, source-fetch, dashboard, and
adapter test suites passed locally.

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
individual file. Transaction journals recover interrupted multi-file work on
the next mutation; users needing database-grade durability should not rely on
filesystem rename alone.

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

On 2026-07-15 the following completed successfully:

```text
npm run typecheck
npm test -- --run
npm run build
```
