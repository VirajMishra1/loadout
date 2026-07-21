# Devpost submission copy

Edit this in your own voice before submitting. Replace the video placeholder and
check every link while signed out.

## Project name

Loadout

## Tagline

One CLI to discover, install, update, and undo the best extensions for your AI coding
agents.

## Category

Developer Tools

## Short category and project answer

We are building for the Developer Tools category. Loadout is a local CLI that finds,
screens, installs, updates, and rolls back skills, MCP servers, and runtime tools
across Codex, Claude Code, Cursor, and other coding agents, with project-aware
recommendations and a daily read-only discovery feed.

## Project description

Improving an AI coding agent still means hunting through GitHub, Reddit, X, and
bookmarks, then copying files into several different agent directories. A week later,
you may not remember where a skill came from, whether a better option has appeared,
or how to remove it safely.

Loadout turns that mess into one local CLI. Stable installs a bounded 30-skill daily
setup from four pinned public sources. Power prepares a broader toolkit. Maximum
keeps thousands of screened skill copies in a disabled local library, then recommends
a focused active set for the current project. Custom mode installs one exact package
without replacing the rest of your setup.

Every change is previewed first. Loadout records source and version ownership, checks
for collisions and risky files, protects user edits, and creates a rollback snapshot
before it changes managed files. MCP servers and executable tools remain separate,
explicit choices. The normal skill workflow does not require an OpenAI or Anthropic
API key.

The bundled catalog credits 53 pinned public repositories. A generated discovery
snapshot currently watches 240 repositories, including 216 candidates that have not
been promoted into the catalog. Loadout treats popularity as a reason to inspect a
project, not proof that it is safe or useful.

We built Loadout with Codex and GPT-5.6 during OpenAI Build Week. We used Codex for
architecture, implementation, repository research, threat modelling, cross-platform
work, and the founder testing loop. Real tests on Codex and Claude Code exposed bugs
in rollback history, update performance, project activation, MCP configuration,
runtime-tool inventory, and adopted-skill removal. Each reproducible failure became a
regression test. The current release passes 625 tests, packaged CLI journeys, public
CI, and a 1,000-skill performance gate.

Loadout is published on npm and the code is public. The dashboard was deliberately
removed because it duplicated the CLI and made the product harder to understand. The
result is the product we wanted to use ourselves: one command-line control layer for
the extensions around every AI coding agent.

## Links

- GitHub: https://github.com/VirajMishra1/loadout
- npm: https://www.npmjs.com/package/loadout-ai
- Release: https://github.com/VirajMishra1/loadout/releases/tag/v0.5.8
- Demo: https://www.youtube.com/watch?v=opNqJKX7xMw

## Judge testing path

```bash
npm install --global loadout-ai@0.5.8
loadout --version
loadout guide
loadout setup --mode stable
```

The Stable command previews first. It changes nothing until the reviewer approves
the plan. The README and user test guide cover rollback, Maximum, project
recommendations, MCP recipes, Graphify, discovery, and complete uninstall.

## Final fields to verify

- Category is Developer Tools.
- All three teammates appear on the Devpost submission.
- The public YouTube URL works while signed out.
- The Codex `/feedback` session ID is present.
- The GitHub, npm, and video links are correct.
- The submission is submitted, not saved as a draft.
