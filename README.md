# Loadout

Loadout is a universal upgrade manager for AI coding agents. It discovers, installs,
synchronizes, and updates trusted skills and MCP tools across Claude Code, Codex,
Cursor, Gemini CLI, OpenCode, Hermes, and other compatible agents.

The project is being built for the OpenAI Build Week **Developer Tools** category.

## Status

The first working vertical slice is now implemented: Loadout detects installed agents,
fetches a real public GitHub repository at its current commit, finds its `SKILL.md`
packages, creates a preview plan, installs into agent-specific directories, and records
a rollback snapshot. See [MASTER_PLAN.md](./MASTER_PLAN.md) for the full product
specification, architecture, work breakdown, ownership tracks, and delivery checklist.

## Try the real install path

```bash
npm install
npm run build
node dist/src/cli.js status
node dist/src/cli.js catalog
node dist/src/cli.js plan --repository obra/superpowers --package obra-superpowers --agents codex
node dist/src/cli.js install --repository obra/superpowers --package obra-superpowers --agents codex --yes
node dist/src/cli.js rollback
```

Repository installs are currently public GitHub repositories only. Loadout clones a
shallow snapshot, records the resolved commit, never runs repository lifecycle scripts,
and copies only discovered `SKILL.md` directories into the selected agent roots.

## Core promise

Run one command, let Loadout detect the agents on your computer, and choose either a
stable or maximum universal boost. Loadout handles platform-specific installation,
keeps a record of every change, and can roll back to the last working configuration.
