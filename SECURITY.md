# Loadout threat model

Loadout handles third-party repositories and agent configuration, so its safety boundary is deliberately conservative.

## Protected actions

- Repository discovery uses a shallow Git fetch and reads files; it does not run package managers, lifecycle hooks, binaries, or scripts.
- Updates are compared by commit and file hash before mutation.
- New or changed scripts, hooks, binaries, embedded secret-like material, and suspicious instruction patterns are blocking findings.
- Network domains and environment-variable names are reported without exposing values. They require review when a policy or caller treats them as sensitive.
- Blocked updates can be quarantined as metadata under `$LOADOUT_HOME/quarantine`. Quarantine never installs or executes the fetched repository.
- Approved changes still run through a transactional snapshot and rollback path; approval is a human acknowledgement, not a claim that the package is safe.

## Explicit non-guarantees

Static inspection cannot prove that a package is benign. It may miss obfuscated behavior, interpreter-specific behavior, malicious content hidden in generated files, or risks introduced by an agent consuming a text instruction. Stars, repository age, and “official” labels are discovery signals, not security proofs.

Loadout does not currently sandbox arbitrary executables or automatically execute third-party installers. Users should review diffs, licenses, requested permissions, and provenance before approving a change.

