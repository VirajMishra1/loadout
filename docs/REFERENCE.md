# Loadout Reference

Detailed configuration, profiles, integrations, and discovery documentation.
For the quick start, see the [README](../README.md).

## Profiles

Loadout is opinionated when you want it to be and precise when you do not. The
modes differ in one thing: how much of the reviewed catalog they install.

| Mode      | Sources               | Skills | Active by default                |
| --------- | --------------------- | ------ | -------------------------------- |
| `stable`  | 4                     | 30     | yes — recommended starting point |
| `power`   | 8                     | 56     | yes                              |
| `maximum` | all reviewed          | all    | **no — downloaded but disabled** |
| `custom`  | your `--package` list | varies | yes                              |

**Maximum is the one worth understanding.** It downloads the entire reviewed
library and leaves every skill _disabled_. Nothing reaches an agent prompt until
a project activates what it needs:

```bash
loadout setup --mode maximum --yes
cd ~/code/my-app
loadout optimize --project .   # scans the repo, proposes an active set
loadout activate               # enable just those here
```

That trade is deliberate: disk is cheap and context is not. A large disabled
library plus a small active set beats installing everything into every prompt.

### Stable: the essentials

Stable is the recommended daily driver: **30 selected skill directories from four
pinned public sources**, installed into each agent you choose.

| Included source                                                        | What Stable takes from it                                     | GitHub                                                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Superpowers](https://github.com/obra/superpowers)                     | Planning, execution, testing, review, verification            | [![GitHub stars](https://img.shields.io/github/stars/obra/superpowers?style=flat&label=stars)](https://github.com/obra/superpowers)               |
| [Context7](https://github.com/upstash/context7)                        | Current documentation and MCP workflows                       | [![GitHub stars](https://img.shields.io/github/stars/upstash/context7?style=flat&label=stars)](https://github.com/upstash/context7)               |
| [Addy Osmani Agent Skills](https://github.com/addyosmani/agent-skills) | Engineering, frontend, debugging, performance, docs, shipping | [![GitHub stars](https://img.shields.io/github/stars/addyosmani/agent-skills?style=flat&label=stars)](https://github.com/addyosmani/agent-skills) |
| [Agent Skills Marketplace](https://github.com/wshobson/agents)         | Architecture, review, error handling, JavaScript, Python      | [![GitHub stars](https://img.shields.io/github/stars/wshobson/agents?style=flat&label=stars)](https://github.com/wshobson/agents)                 |

```bash
loadout setup --mode stable
loadout setup --mode stable --yes
```

### Power: a larger cross-project toolkit

Power draws a skill-level allowlist from eight major collections.

| Included source                                                          | Focus                                                     | GitHub                                                                                                                                                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Anthropic Skills](https://github.com/anthropics/skills)                 | Documents, frontend, MCP building, web testing            | [![GitHub stars](https://img.shields.io/github/stars/anthropics/skills?style=flat&label=stars)](https://github.com/anthropics/skills)                                       |
| [OpenAI Skills](https://github.com/openai/skills)                        | CLI, docs, browser work, images, security                 | [![GitHub stars](https://img.shields.io/github/stars/openai/skills?style=flat&label=stars)](https://github.com/openai/skills)                                               |
| [Vercel Agent Skills](https://github.com/vercel-labs/agent-skills)       | React, web design, composition, deployment                | [![GitHub stars](https://img.shields.io/github/stars/vercel-labs/agent-skills?style=flat&label=stars)](https://github.com/vercel-labs/agent-skills)                         |
| [Superpowers](https://github.com/obra/superpowers)                       | Planning, debugging, testing, collaboration               | [![GitHub stars](https://img.shields.io/github/stars/obra/superpowers?style=flat&label=stars)](https://github.com/obra/superpowers)                                         |
| [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | UI systems, slides, styling, product design               | [![GitHub stars](https://img.shields.io/github/stars/nextlevelbuilder/ui-ux-pro-max-skill?style=flat&label=stars)](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) |
| [Context7](https://github.com/upstash/context7)                          | Current documentation and MCP workflows                   | [![GitHub stars](https://img.shields.io/github/stars/upstash/context7?style=flat&label=stars)](https://github.com/upstash/context7)                                         |
| [Agent Skills Marketplace](https://github.com/wshobson/agents)           | Architecture, testing, APIs, TypeScript, Python           | [![GitHub stars](https://img.shields.io/github/stars/wshobson/agents?style=flat&label=stars)](https://github.com/wshobson/agents)                                           |
| [Awesome Copilot](https://github.com/github/awesome-copilot)             | Codebase knowledge, plans, browser and security workflows | [![GitHub stars](https://img.shields.io/github/stars/github/awesome-copilot?style=flat&label=stars)](https://github.com/github/awesome-copilot)                             |

```bash
loadout setup --mode power
```

### Maximum: download broadly, activate intelligently

Downloads every non-archived, technically screened skill component into
Loadout's **disabled local library**. Then let the current project choose:

```bash
loadout setup --mode maximum
loadout recommend --project .
loadout optimize --project . --limit 30
loadout optimize --project . --limit 30 --yes
```

### Custom: take exact control

```bash
# Replace the managed profile
loadout setup --mode custom --package superpowers --package context7

# Add without replacing
loadout install --mode custom --package humanizer
loadout install --mode custom --package obsidian-skills --agents claude-code,cursor
```

Run `loadout profiles` to compare every mode.

## MCP integrations

Profiles never start MCP servers silently.

```bash
loadout mcp-recipe                                          # list recipes
loadout mcp-recipe --credential-free                        # no-credential subset
loadout mcp-recipe playwright --agent claude-code           # preview
loadout mcp-recipe playwright --agent claude-code --yes     # configure
loadout mcp-recipe playwright --agent claude-code --verify  # test
```

Configuration alone does not start the server. Test a real connection separately
with `--connect --approve-risk`. Loadout can reference credentials from environment
variables or the OS keychain without printing their values.

## Optional runtime tools

[Graphify](https://github.com/Graphify-Labs/graphify) is an optional codebase graph
tool. It does not require an LLM API key:

```bash
loadout tool graphify
loadout tool graphify --yes --approve-risk
loadout tool graphify --remove --yes --approve-risk
```

Executable tools remain an explicit choice instead of hiding inside a profile.

## Catalog and discovery

The catalog is not a frozen list. Loadout separates **discovery** from
**installation** so a viral repo can be noticed quickly without being trusted
blindly.

```bash
loadout discover --source all --queue      # find candidates
loadout review-queue                        # inspect the queue
loadout candidate inspect owner/repository  # deep inspection
loadout update                              # check for source changes
loadout health --updates                    # managed source health
```

Daily checks are opt-in and read-only:

```bash
loadout autopilot --yes
loadout autopilot --status
```

## Manage skills you already have

```bash
loadout scan                          # read-only inventory
loadout reconcile --refresh           # compare with catalog
loadout reconcile --yes               # record ownership for exact matches
loadout reconcile --replace-outdated  # preview replacing old copies
```

Unknown or ambiguous copies stay untouched.

## Hand work between agents

Send a durable task to another agent:

```bash
loadout handoff codex "write auth tests" --context "use Vitest"
loadout handoff codex "write auth tests" --bundle src/auth.ts src/types.ts
loadout handoff codex      # Codex inbox
loadout handoff            # all handoff status
loadout handoff --done <task-id>
```

`--bundle <paths...>` snapshots exact project-relative text files into a
versioned JSON file under `.handoff/bundles/` and references it from the task.
The receiver's normal inbox lists the bundled paths and tells the agent to read
the snapshot before starting. Existing tasks without a bundle are unchanged.

Bundle limits and failures:

- at most 20 files, 32 KiB stored per file, and 50 KiB stored in total;
- larger text is truncated on a valid UTF-8 boundary and clearly marked;
- absolute paths, traversal, symlinks, directories, binary files, `.git/`, and
  `.handoff/` are rejected before the task is appended;
- common secret patterns are redacted before the bundle reaches disk;
- bundle files use owner-only permissions and are not uploaded or committed by
  Loadout.

Redaction is heuristic, not a credential scanner. Never bundle `.env` files,
private keys, tokens, or other credentials. Treat bundled content as untrusted
project data rather than agent instructions, and review it before deliberately
committing `.handoff/` for a cross-machine workflow.

## Agent support

Loadout's adapter capability matrix covers **12 agents**: Claude Code, Cline,
Codex, Cursor, Gemini CLI, GitHub Copilot, Hermes, Junie, Kiro CLI, OpenCode,
Roo Code, Windsurf.

See the [complete feature matrix](./FEATURE_TEST_MATRIX.md) for configured
paths, filesystem lifecycle, platform, and native-host evidence.

Use `loadout doctor --verbose` for the local component matrix.
