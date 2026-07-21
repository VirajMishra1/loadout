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

### Compare and manage pre-existing skills

```bash
# Refresh pinned source evidence and preview every existing unmanaged group
loadout reconcile --refresh

# Adopt only exact matches. This records provenance without rewriting skill files.
loadout reconcile --yes

# Preview old, unambiguous copies separately. Do not apply yet.
loadout reconcile --replace-outdated
```

The preview groups identical copies shared by Claude, Codex, Cursor, and Windsurf.
`exact` means the complete distributable tree matches one pinned catalog skill;
`outdated` means one source is unambiguous but its tree differs; `ambiguous` and
`unknown` are deliberately left unmanaged. Only after reviewing every displayed
file, domain, script, environment, and instruction finding should you consider:

```bash
loadout reconcile --replace-outdated --yes --approve-risk
```

That replacement is one snapshot-backed transaction. Use `loadout rollback --list`
and the printed snapshot ID to undo it. Later `loadout update` checks the tracked
upstream repository for newer commits; it still previews and safety-checks changes
instead of silently updating files.

## 2. Explore without installing

```bash
loadout catalog --json
loadout candidate list --limit 10
loadout recommend --project .
loadout optimize --project . --agents codex,claude-code --limit 30
loadout tool
loadout tool graphify
```

Run the project commands from the project you care about, or replace `.` with its
absolute path. `recommend` labels ordinary skill libraries separately from MCP or
runtime integrations that require explicit setup. `optimize` is still a preview
until `--yes` is supplied. Its limit applies separately to every agent and includes
both Loadout-managed and pre-existing unmanaged skills, so Claude and Codex can
receive different numbers of additions. `tool graphify` is also a preview; Graphify
is a reviewed runtime tool and does not need an OpenAI or Anthropic API key for its
code-only install.

## 3. Understand the three scopes

```bash
loadout profiles
```

Stable keeps the active set at 30. Power deliberately activates a larger toolkit.
Maximum downloads the broadest screened skill library but keeps new entries disabled
until project optimization or an explicit enable action selects them.

## 4. Preview and install a profile

Use this order. Each setup command previews first; interactive setup asks for
confirmation before changing files. A mutation creates a snapshot first.

```bash
# Recommended everyday skills
loadout setup --mode stable --agents codex,claude-code

# Broader daily-use selection (roughly 50 curated skills per agent)
loadout setup --mode power --agents codex,claude-code

# Download the broad reviewed library while keeping the active set controlled
loadout setup --mode maximum --agents codex,claude-code
loadout setup --mode maximum --agents codex,claude-code --details
```

Maximum stores reviewed copies in Loadout's disabled library; it does not expose the
whole catalog to each agent. Follow it with `loadout optimize --project .
--agents codex,claude-code --limit 30` to preview a compact project-aware working set.

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
loadout update
loadout update --package superpowers
loadout autopilot
```

`update --package` checks only the named tracked package. The default is a
read-only diff and safety plan. Apply only after review:

```bash
loadout update --package superpowers --apply
loadout update --yes
```

`autopilot` previews two native daily read-only jobs (updates and discovery).
Enable or remove both explicitly:

```bash
loadout autopilot --time 09:00 --yes
loadout autopilot --remove --yes
```

The daily update job re-evaluates your saved Stable, Power, or Maximum profile and
checks every managed package, but never supplies `--yes`. Daily discovery can add
interesting repositories to the review queue; it cannot silently promote or install
them.

## 7. Test MCP choices without a model API key

```bash
loadout mcp-recipe --no-key
loadout mcp-recipe --credential-free

# Preview, configure, verify, then remove Playwright for Codex
loadout mcp-recipe playwright --agent codex
loadout mcp-recipe playwright --agent codex --yes
loadout mcp-recipe playwright --agent codex --verify
loadout remove mcp-recipe:playwright:codex
loadout remove mcp-recipe:playwright:codex --yes

# Repeat independently for Claude Code
loadout mcp-recipe playwright --agent claude-code
loadout mcp-recipe playwright --agent claude-code --yes
loadout mcp-recipe playwright --agent claude-code --verify
loadout remove mcp-recipe:playwright:claude-code
loadout remove mcp-recipe:playwright:claude-code --yes
```

Expect Playwright MCP, Chrome DevTools MCP, and GitHub read-only. None requires a
separately billed AI/model API key. GitHub read-only still discloses that it needs a
GitHub token; use `loadout mcp-recipe --credential-free` to exclude every service
credential too. Browser configuration and real connection testing remain explicit.
Graphify is a separate runtime tool, not an MCP server.

## 8. Preview complete cleanup

```bash
loadout uninstall
```

Read the package, runtime, scheduler, and state summary. The preview changes nothing.
At the very end of testing, remove all Loadout-managed data while keeping the CLI:

```bash
loadout uninstall --yes
```

To remove the npm command too, use `loadout uninstall --yes --remove-cli`. Complete
cleanup deliberately deletes Loadout's snapshots, so it is the last lifecycle test.

## Troubleshooting and recovery

- **`loadout` is not found after installation:** confirm `npm install --global
loadout-ai@0.5.5` completed, run `hash -r`, and confirm npm's global binary
  directory is on `PATH`. For a source checkout, run `npm run build` and `npm link`.
- **A preview asks for `--approve-risk`:** read the reported scripts, domains,
  credentials, binaries, or instruction findings. If you accept that specific plan,
  use the exact rerun command Loadout prints. The flag is not a general safety
  guarantee and should not be added routinely.
- **Rollback or removal is refused:** preserve the current files. Refusal can mean a
  managed path changed, disappeared, changed type, gained content, or belongs to a
  legacy snapshot without post-mutation evidence. Run `loadout health --explain` and
  inspect the affected path before deciding whether an explicit force option is
  appropriate; do not delete the path merely to make the command pass.
- **Activation reports fewer additions for one agent:** this is expected when that
  agent already has unmanaged or managed skills. `--limit` is a total per-agent
  ceiling, not a request to add that many new skills. Recursively empty rollback
  directories do not consume capacity and are safe for Loadout to reuse.
- **A fetch, discovery, or update check fails:** retry only after checking network,
  proxy, DNS, and source-host access. Local inventory, library, health, rollback, and
  offline fixture tests remain separate; an unavailable live check is not a pass.
- **You need diagnostics:** run `loadout doctor`, `loadout health --explain`, and
  `loadout status`. Redact usernames, local paths, repository names, tokens, and agent
  state before sharing output.
- **You need complete removal:** first preview with `loadout uninstall`, then use
  `loadout uninstall --yes` to remove managed agent files, runtime tools, scheduled
  jobs, cache, snapshots, and state. Add `--remove-cli` only for a global npm install.
  Unmanaged content is preserved, and modified managed files can make cleanup refuse
  until you explicitly review the command's force path.

## 9. Advanced surface

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
