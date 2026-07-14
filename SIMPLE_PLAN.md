# Loadout plan — simple version

Loadout will do everything a package manager such as OpenPackage does:

- Find, install, update, remove, create, share, and synchronize AI-agent add-ons.
- Work with skills, commands, rules, agents, plugins, and MCP tools.
- Support Codex, Claude Code, Cursor, and more from one setup file.

Then Loadout will add three major advantages:

1. **Safety:** scan first, explain every change, block dangerous behavior, and never
   touch unrelated files.
2. **Recovery:** back up before changes and provide one-command undo.
3. **Guidance:** check setup health and recommend tested add-on collections for the
   user's project.

The build order is:

1. Finish the reliable package-manager foundation.
2. Match OpenPackage's package types, sources, synchronization, and publishing.
3. Add health checks, security scanning, safe updates, recommendations, and profiles.
4. Finish the dashboard and prove every supported platform with tests.

All Nitish work stays on `dev/nitish`. Nitish will review it before any PR to
`develop`; stable approved work can later move from `develop` to `main`.

