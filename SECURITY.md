# Loadout threat model

Loadout handles third-party repositories and agent configuration, so its safety boundary is deliberately conservative.

## Reporting a vulnerability

Please use [GitHub's private vulnerability reporting form](https://github.com/VirajMishra1/loadout/security/advisories/new). Do not open a public issue or include credentials, private source code, or unredacted Loadout state. Include the affected version, impact, and minimal reproduction details when possible.

## Protected actions

- Repository discovery uses a shallow Git fetch and reads files; it does not run package managers, lifecycle hooks, binaries, or scripts.
- Updates are compared by commit and file hash before mutation.
- New or changed scripts, hooks, binaries, embedded secret-like material, and suspicious instruction patterns are blocking findings.
- Network domains and environment-variable names are reported without exposing values. They require review when a policy or caller treats them as sensitive.
- Blocked updates can be quarantined as metadata under `$LOADOUT_HOME/quarantine`. Quarantine never installs or executes the fetched repository.
- Approved changes still run through a transactional snapshot and rollback path; approval is a human acknowledgement, not a claim that the package is safe.

## Coordination boundary

- Coordination events are validated, size-bounded, redacted at the canonical
  storage boundary, and written to owner-only project files.
- Event text is untrusted project data. The provider bridge frames it as data,
  never as authority to execute commands, publish, deploy, delete, or expand
  scope.
- The optional HTTP daemon binds only to loopback, requires a random bearer
  token, rejects query-string credentials and hostile browser origins, and is
  not supported on a LAN or public network.
- Provider bridging is explicit and can consume the user's existing provider
  quota. Passive events do not trigger turns, one bridge may run per project,
  and automatic turns have a configurable hard cap.
- `.handoff` may reveal repository structure, decisions, session IDs, and
  contracts. Do not commit it when that information is private.

## Explicit non-guarantees

Static inspection cannot prove that a package is benign. It may miss obfuscated behavior, interpreter-specific behavior, malicious content hidden in generated files, or risks introduced by an agent consuming a text instruction. Stars, repository age, and “official” labels are discovery signals, not security proofs.

Loadout does not currently sandbox arbitrary executables or automatically execute third-party installers. Users should review diffs, licenses, requested permissions, and provenance before approving a change. Live coordination does not merge provider context windows, bypass provider authentication, or make agent output trustworthy.
