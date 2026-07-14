# Compatibility policy

Loadout uses the same adapter matrix in inspection and installation. Each
agent/component cell is one of:

- **native** — Loadout writes the documented component format to the
  agent-owned location.
- **adapted** — Loadout has a reviewed, tested mapping to an agent-specific
  layout or explicit config writer. The plan warns about the adaptation.
- **unsupported** — Loadout does not infer a location, convert the component,
  or write anything.

All supported platforms (Windows, macOS, and Linux) use this policy. WSL is
Linux-side only: Loadout manages the POSIX home directory and never silently
rewrites a Windows profile. Agent adapters are deliberately conservative:
skills are native wherever a documented skill directory exists; commands,
rules, and agents are native only where the adapter supplies a concrete
directory; MCP is config-scoped and adapted only through its explicit JSON or
Codex TOML planner; and plugin manifests are inspected/normalized but their
runtime hooks are never converted or executed.

Use `loadout capabilities --inspect` to view the matrix and local inventory.
