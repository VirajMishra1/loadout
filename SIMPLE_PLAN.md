# Loadout plan — simple version

Loadout's primary experience is CLI-first:

```bash
npx loadout-ai
```

It detects installed agents, scans the actual skills already present, and recommends a
small Stable foundation. Maximum Library and Custom are explicit alternatives. It
previews reviewed pinned sources, exact overlaps, capacity, and safety findings before
one rollback-safe transaction. The dashboard is optional diagnostics.

Loadout also provides the package-manager operations:

- Find, install, update, remove, create, share, and synchronize AI-agent add-ons.
- Work with skills, commands, rules, agents, plugins, and MCP tools.
- Support Codex, Claude Code, Cursor, and more from one setup file.

Loadout's four major advantages are:

1. **Safety:** scan first, explain every change, block dangerous behavior, and never
   touch unrelated files.
2. **Recovery:** back up before changes and provide one-command undo.
3. **Guidance:** check setup health and recommend tested add-on collections for the
   user's project.
4. **Optimization:** keep a broad reviewed library but expose only the best supported,
   non-overlapping active set for the current agent and project.

The original build order was:

1. Finish the reliable package-manager foundation.
2. Match OpenPackage's package types, sources, synchronization, and publishing.
3. Add health checks, security scanning, safe updates, recommendations, and profiles.
4. Keep the dashboard optional and prove every supported platform with tests.

That foundation is now integrated on `main`. [MASTER_PLAN.md](./MASTER_PLAN.md) is the
only canonical checklist; contributor branches and notes are historical inputs, not
separate sources of project status. Phase 12 now tracks provenance for unmanaged
skills, evidence-backed comparison, library-versus-active-set state, safe adoption and
enable/disable, project activation, guided optimization, category evaluations, daily
review queues, provider/MCP workflows, CLI polish, npm publication, and public-beta
testing. Catalog expansion, legal review, keychains, additional adapters, and submission
work remain explicit rather than hidden behind earlier checked implementation proofs.
