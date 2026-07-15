# Conversion loss reports and installer sandbox boundary

## Cross-agent conversion

The only safe initial conversion target is a static instruction file. A source skill
can be copied to an agent's documented native skill directory when that adapter marks
skills `native`. For a target that supports only commands, Loadout may create one
explicit command wrapper pointing at the same static instructions.

Every conversion emits a loss report containing source component, target component,
preserved fields, dropped fields, and the reason. Hooks, subagents, lifecycle scripts,
dynamic variables, permissions, and MCP servers are never silently converted. A loss
report with dropped executable behavior requires user approval and defaults to no
write.

## Third-party installer threat model

An installer can read secrets, write outside its target, alter shell startup files,
open network connections, launch processes, or exploit the host. Therefore source
repository scripts are never run on the host. Static package parsing is the normal
path.

If a future disposable sandbox runner is enabled, it must use a fresh filesystem,
read-only source mount, no host home mount, no inherited environment variables, no
Docker socket, restricted network disabled by default, bounded CPU/memory/time, and
an exported file manifest. Its output is an untrusted proposal that still goes through
the normal plan/safety/approval path. Failure or timeout discards the sandbox.
