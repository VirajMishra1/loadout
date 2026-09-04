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

## 8. Test handoff and live coordination in a disposable repository

Create a temporary Git repository so the test does not add handoff files to a
real project:

```bash
mkdir loadout-coordination-test
cd loadout-coordination-test
git init
```

First test the stable session-boundary inbox:

```bash
mkdir -p src
printf 'export const checkout = true;\n' > src/checkout.ts
printf 'export type CheckoutId = string;\n' > src/types.ts
loadout handoff codex "Implement the frontend" \
  --context "Claude owns src/api; consume checkout-api" \
  --bundle src/checkout.ts src/types.ts
loadout handoff codex
loadout handoff
```

Confirm the inbox lists both bundled files and calls them untrusted project
data. Inspect `.handoff/bundles/*.json`: the schema version is `1`, the task log
contains only its bounded reference, and the bundle contains the source
snapshots. For a redaction check, put a fake `sk-ant-` token longer than 20
characters in a disposable file, bundle it, and confirm only `[REDACTED]` is
stored. Never use a real credential.

Copy the task ID printed by the inbox, then settle it:

```bash
loadout handoff --done <task-id>
loadout handoff codex
```

Next test structured coordination without running either model:

```bash
loadout coord own claude-code src/api
loadout coord own codex src/web
loadout coord contract checkout-api --agent claude-code \
  --body "POST /api/checkout -> 201 { id: string }"
loadout coord snapshot codex
loadout coord ack codex 2
loadout coord status
loadout coord replay
```

Sequence numbers are printed by each command; use the actual latest relevant
sequence if it differs from `2`. Confirm that the first overlapping exclusive
claim is refused, then release the original path and confirm the retry succeeds:

```bash
loadout coord own codex src/api/checkout.ts
loadout coord release claude-code src/api
loadout coord own codex src/api/checkout.ts
```

Test the authenticated live dashboard in one terminal:

```bash
loadout daemon start
```

Open the exact dashboard URL it prints. In a second terminal, run another
`loadout coord update` and confirm it appears. A bare `/api/status` request
without the bearer token should return `401`. Press Ctrl+C in the daemon
terminal when finished.

Test the packaged MCP transport without changing either agent's configuration:

```bash
loadout serve
```

The process waits for MCP JSON-RPC on stdin and should print no banners or prose
to stdout. Press Ctrl+C. Host-specific configuration and the exact tool list are
in [the live coordination guide](./LIVE_COLLABORATION.md).

Finally, inspect the provider bridge surface:

```bash
loadout coord agents detect
loadout coord agents list
loadout coord agents bridge --help
```

The next commands run real provider turns and may consume Claude/Codex quota.
Only run them when you intentionally want that test:

```bash
loadout coord agents start claude-code "Claim backend files and publish a test contract"
loadout coord agents start codex "Read the shared snapshot and acknowledge the contract"
loadout coord agents bridge claude-code:<session-id> codex:<thread-id> --max-turns 4
```

While the bridge runs, publish a new contract from another terminal. Confirm
both provider sessions can proceed concurrently and that the bridge prints
their responses. Progress-only `update` events remain passive by default. Use
Ctrl+C to stop the bridge. Activate `loadout daemon kill "user test"` to verify
that new coordination writes and provider turns stop, then run
`loadout daemon resume`.

Now test an actual back-and-forth design discussion. This spends exactly three
provider turns: one Claude proposal, one Codex critique, and one Claude
synthesis. Neither agent should edit the disposable repository.

```bash
loadout coord discuss start "Should this test service expose REST or GraphQL?" \
  --agents claude-code,codex \
  --rounds 1 \
  --max-turns 3 \
  --timeout 120
```

Confirm all of the following before publishing:

1. stderr announces exactly three paid provider turns before either provider
   runs;
2. Claude Code proposes a design and Codex directly critiques that proposal;
3. Claude's synthesis names a decision, rationale, alternatives, and any
   unresolved disagreement;
4. `loadout coord discuss list` reports the thread as `closed`;
5. `loadout coord discuss show <thread-id>` shows the linked public transcript;
6. `loadout coord replay` includes the discussion and the resulting decision;
7. `git status --short` shows that neither agent edited a project file.

Repeat with known real session IDs to validate resumption:

```bash
loadout coord discuss start "What validation boundary should this service use?" \
  --sessions claude-code:<session-id> codex:<thread-id> \
  --rounds 1 --max-turns 3
```

For the kill-switch check, start a two-round discussion in one terminal and run
`loadout daemon kill "stop design room"` in another while the first provider
turn is active. The in-flight provider may finish, but its response must not be
persisted and Codex must not receive the next turn. Run `loadout daemon resume`
after confirming the halt.

Delete the disposable repository after inspection. Its `.handoff` directory
contains the local task/event audit trail, token, and session IDs.

## 9. Preview complete cleanup

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
loadout-ai@0.9.0` completed, run `hash -r`, and confirm npm's global binary
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

## 10. Advanced surface

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
