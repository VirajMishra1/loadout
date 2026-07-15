# Reviewed library and active-set contract

Loadout separates four facts that package managers often collapse into one word:

- **cache**: `missing` or `downloaded` says whether Loadout has a private byte-for-byte
  library copy;
- **review**: `unreviewed`, `reviewed`, or `quarantined` records evidence policy and
  never follows popularity alone;
- **installation**: `installed` or `removed` records whether Loadout still manages the
  package; and
- **activation**: `active` or `disabled` is per skill unit and per agent, because one
  skill from a collection can be visible to Claude Code while another stays disabled
  for Codex.

Maximum Library starts reviewed skill units as `downloaded + reviewed + installed +
disabled`. It can therefore hold hundreds of candidates without exposing hundreds of
instructions to an agent. Power is an intentionally broader active profile; Stable is
the smallest active foundation.

An initial install is active and may have `cache:missing`. On the first disable,
Loadout verifies that every managed file is unchanged and that no untracked file would
be removed, copies the complete skill directories into its private library, verifies
their hashes, and only then removes the agent-visible copies. This is the explicit
migration boundary for older installations.

`enable` verifies the private library hashes and refuses to overwrite any occupied
agent target. It restores the exact cached bytes but keeps the library copy. Both
commands are dry-run by default, can change several packages and agents under one
snapshot, write a durable transaction journal before mutation, and can be reversed by
`loadout rollback --snapshot <id>`.

Only Loadout-managed skill directories participate. Existing unmanaged content is
never silently adopted, moved, or deleted. MCP entries and other executable/configured
components are deliberately outside active-set toggling; they retain their existing
explicit configuration and removal workflows.

A disabled package must be enabled before its tracked source can be updated. This
prevents the update workflow from silently recreating agent-visible files and makes the
activation transition explicit.

## Commands

```bash
loadout library
loadout disable <package-or-package/skill> [more-selectors] [--agents codex,claude-code]
loadout disable <package-or-package/skill> --yes
loadout enable <package-or-package/skill> --yes
loadout activate --project . --limit 40
loadout optimize --project .
loadout rollback --snapshot <id>
```

Machine-readable planning and results are available with `--json`.
