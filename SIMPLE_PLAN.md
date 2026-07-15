# Loadout plan — simple version

Loadout's primary experience is CLI-first:

```bash
npx loadout-ai
```

It detects installed agents, offers Maximum/Stable/Custom, previews reviewed pinned
sources, resolves duplicate skills, and installs the approved loadout as one rollback-
safe transaction. The dashboard is optional.

Loadout also provides the package-manager operations:

- Find, install, update, remove, create, share, and synchronize AI-agent add-ons.
- Work with skills, commands, rules, agents, plugins, and MCP tools.
- Support Codex, Claude Code, Cursor, and more from one setup file.

Then Loadout will add three major advantages:

1. **Safety:** scan first, explain every change, block dangerous behavior, and never
   touch unrelated files.
2. **Recovery:** back up before changes and provide one-command undo.
3. **Guidance:** check setup health and recommend tested add-on collections for the
   user's project.

The original build order was:

1. Finish the reliable package-manager foundation.
2. Match OpenPackage's package types, sources, synchronization, and publishing.
3. Add health checks, security scanning, safe updates, recommendations, and profiles.
4. Keep the dashboard optional and prove every supported platform with tests.

That foundation is now integrated on `main`. [MASTER_PLAN.md](./MASTER_PLAN.md) is the
only canonical checklist; contributor branches and notes are historical inputs, not
separate sources of project status. The remaining work is expanding 20 reviewed
repositories toward 50, the explicitly unchecked human release tasks, OS-keychain
backends, six additional documented adapters, npm publication, and real user testing.
