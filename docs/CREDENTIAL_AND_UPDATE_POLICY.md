# Credential and autonomous-update policy

## Credential interface

The core accepts `CredentialReference` values only: an environment-variable name or
an OS-keychain service/account reference. Raw values cannot appear in config schemas,
logs, plans, lockfiles, exports, or telemetry. Backend implementations must expose
`get`, `set`, and `delete` by reference; `get` returns a transient value to the direct
provider client and is never serializable. Unsupported platforms fail closed.

macOS maps to Keychain Services, Windows to Credential Manager, and Linux to Secret
Service/libsecret. The user controls creation and deletion; Loadout never creates a
credential backend from a repository manifest.

## Update policy

The default is `manual`: detect and show diffs only. `canary` permits a selected,
low-risk package to install into a disposable or explicitly named canary profile,
then requires a static verification pass before human promotion. `automatic` is not
available for hooks, executables, plugins, MCP configurations, new domains, new
environment references, unsigned catalogs, or packages without a prior successful
canary.

Every promotion stores a snapshot and an append-only local audit event. Any failed
verification restores the snapshot and quarantines the candidate commit. A user can
revoke a policy at any time; revocation prevents future mutations but never deletes
existing snapshots.

The local `loadout canary` command implements the non-mutating static gate. A
transaction layer must provide verification and promotion callbacks before a
candidate can be promoted; the command itself never installs a candidate.
