# Test Loadout on your own machine

This is the short, safe route through the product. Start in a normal terminal.
The first group only reads local state or prepares a preview; it does not replace
agent files. A preview can download reviewed source into Loadout's cache, but it
does not activate skills or change an agent configuration.

## 1. Get oriented

```bash
loadout guide
loadout library
loadout scan
loadout health
```

`library` is the concise provenance view: it shows active skills and disabled
reviewed-library copies per agent. For the full source-package and upstream-repository
record for every skill, use `loadout library --all`. `scan` distinguishes
Loadout-managed skills from your own pre-existing skills. `health` checks local drift only; add
`--updates` only when you want it to contact the tracked public repositories.

## 2. Explore without installing

```bash
loadout catalog --json
loadout candidate list --limit 10
loadout recommend --project .
loadout optimize --project .
loadout tool
loadout tool graphify
```

Run the project commands from the project you care about, or replace `.` with its
absolute path. `optimize` is still a preview until `--yes` is supplied. `tool
graphify` is also a preview; Graphify is a reviewed runtime tool and does not
need an OpenAI or Anthropic API key for its code-only install.

## 3. Open the optional dashboard

```bash
loadout dashboard
```

Open the `http://127.0.0.1:PORT` address it prints. It never listens on the
network. The dashboard shows status, health, installed packages, updates, local
project recommendations, profiles, and the catalog. Its Apply and Undo buttons
require an in-page preview, acknowledgement, and a private local session token.
Stop the server with `Control-C`.

## 4. Preview and install a profile

Use this order. Each setup command previews first; interactive setup asks for
confirmation before changing files. A mutation creates a snapshot first.

```bash
# Recommended everyday skills
loadout setup --mode stable --agents codex,claude-code

# Broader daily-use selection (50 curated skill directories)
loadout setup --mode power --agents codex,claude-code

# Download the broad reviewed library while keeping the active set controlled
loadout setup --mode maximum --agents codex,claude-code
```

At the API-access question, choose `None` unless you separately pay for a
provider API. A ChatGPT Plus or Claude Pro subscription is not an API key. Core
skill profiles do not require one; credentialed MCP and runtime operations stay
explicit.

For unattended use only after reviewing a preview, the equivalent is:

```bash
loadout setup --mode stable --agents codex,claude-code --yes
```

Do not add `--approve-risk` unless the displayed preview identifies a specific
reviewed finding and you understand it.

## 5. Test a change and recover

```bash
# Preview Graphify, then install only if the preview looks right
loadout tool graphify --agents codex,claude-code
loadout tool graphify --agents codex,claude-code --yes --approve-risk

# Check the exact current state
loadout library
loadout health

# Restore a prior snapshot if you do not like the result
loadout rollback --list
loadout rollback

# Or remove only Graphify and restore its pre-install agent state
loadout tool graphify --remove --agents codex,claude-code --yes --approve-risk
```

`rollback` restores a whole Loadout snapshot. The tool-specific remove command
is narrower and is preferable when you only want to undo that one runtime tool.

## 6. Test daily discovery and updates

```bash
loadout alerts
loadout update --package superpowers
loadout autopilot
```

`update --package` checks only the named tracked package. The default is a
read-only diff and safety plan. Apply only after review:

```bash
loadout update --package superpowers --apply
```

`autopilot` previews two native daily read-only jobs (updates and discovery).
Enable or remove both explicitly:

```bash
loadout autopilot --time 09:00 --yes
loadout autopilot --remove --yes
```

## 7. Advanced surface

The first help screen deliberately focuses on daily use. Existing advanced
commands have not been removed:

```bash
loadout advanced
loadout candidate --help
loadout mcp-recipe --help
loadout <command> --help
```

Avoid running registry publishing, signing, sandbox, credential, or arbitrary
MCP configuration commands on your main profile as part of routine user testing.
They are package-author or integration workflows, not required to use Loadout's
core product.
