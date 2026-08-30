/** Plain-language entry points for people using the CLI, not maintaining it. */
export const BEGINNER_GUIDE = `
START HERE

1. See what Loadout currently manages
   loadout library
   loadout scan
   loadout reconcile

2. Preview the recommended everyday setup
   loadout setup --mode stable
   loadout profiles

3. Find additions that fit the project in this folder
   loadout recommend --project .
   loadout optimize --project .

4. Check for safer updates and new discoveries
   loadout health
   loadout alerts
   loadout candidate list --limit 10

5. See reviewed MCP integrations and their credential needs
   loadout mcp-recipe
   loadout mcp-recipe --credential-free
   loadout mcp-recipe playwright --agent claude-code

If you decide to install something, Loadout shows a preview first and creates a
snapshot before changing managed files. Recover with: loadout rollback

Reconcile is also read-only unless you add --yes. Exact matches can be managed
without rewriting them; outdated replacements remain a separate explicit choice.

Setup reconciles the complete selected profile. To add one catalog package without
retiring the current managed profile, use:
   loadout install --mode custom --package <id>

Nothing above changes your agents. For the full maintainer/tooling surface, run:
loadout advanced
`.trim();

export const ADVANCED_GUIDE = [
  "ADVANCED COMMANDS",
  "",
  "Hidden from the first screen so daily use stays focused.",
  "",
  "Discovery:    candidate, discover, review-queue, evaluate, skill-audit",
  "Sharing:      init, lock, export, import, share, card, badge",
  "Integrations: mcp-recipe, mcp-config, credentials, models, convert",
  "Lifecycle:    plan, adopt, uninstall, profiles, autopilot, tool, watch",
  "",
  "`loadout <command> --help` for options. Mutations preview first or require --yes.",
].join("\n");

/**
 * The first-screen help shows only the everyday core (~24 commands). Everything
 * else stays fully available and runnable, just omitted from the default help so
 * the surface reads as a focused product rather than a tool dump. `loadout
 * advanced` lists the hidden surface; `loadout <command> --help` documents each.
 */
export const HIDDEN_FROM_FIRST_SCREEN = new Set([
  // manifests, authoring, sharing
  "init",
  "lock",
  "export",
  "import",
  "audit",
  "create",
  "pack",
  "publish",
  "add",
  "unadd",
  "share",
  "card",
  "badge",
  "compare-loadouts",
  "search",
  // analytics / evidence / discovery
  "report",
  "outcomes",
  "outcome",
  "improve",
  "improve-feedback",
  "compare",
  "versions",
  "skill-audit",
  "capabilities",
  "candidate",
  "discover",
  "review-queue",
  "review",
  "inspect",
  "propose",
  "evaluate",
  // integrations / credentials / runtime
  "credentials",
  "models",
  "completion",
  "mcp-recipe",
  "mcp-config",
  "codex-mcp-config",
  "sandbox-run",
  "convert",
  "canary",
  "serve",
  // lifecycle extras
  "plan",
  "adopt",
  "uninstall",
  "profiles",
  "autopilot",
  "tool",
  "watch",
  "schedule",
  "unschedule",
  "alert-ignore",
  "alert-pin",
  "alert-unpin",
  "alert-pins",
]);
