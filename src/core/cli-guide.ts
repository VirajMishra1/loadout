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
   loadout mcp-recipe playwright --agent codex

If you decide to install something, Loadout shows a preview first and creates a
snapshot before changing managed files. Recover with: loadout rollback

Reconcile is also read-only unless you add --yes. Exact matches can be managed
without rewriting them; outdated replacements remain a separate explicit choice.

Nothing above changes your agents. For the full maintainer/tooling surface, run:
loadout advanced
`.trim();

export const ADVANCED_GUIDE = [
  "ADVANCED COMMANDS",
  "",
  "These remain available, but are hidden from the first screen so daily use stays simple.",
  "",
  "Discovery and evidence: candidate, discover, review-queue, intelligence, compatibility, benchmark.",
  "Packages and sharing: init, add, sync, lock, export, import, audit, create, pack, publish, registry-serve.",
  "Integrations and safety: mcp-recipe, mcp-config, codex-mcp-config, credentials, models, sandbox-run, canary.",
  "Automation and release: watch, schedule, unschedule, catalog-sign, catalog-verify, catalog-update, claims.",
  "",
  "Use `loadout <command> --help` for exact options. Every mutation-capable command previews first or requires --yes.",
].join("\n");

/** Commands retained for specialist workflows but omitted from beginner help. */
export const HIDDEN_FROM_FIRST_SCREEN = new Set([
  "init",
  "lock",
  "export",
  "import",
  "audit",
  "create",
  "pack",
  "publish",
  "registry-serve",
  "search",
  "report",
  "outcomes",
  "outcome",
  "share",
  "card",
  "compare-loadouts",
  "badge",
  "claims",
  "alert-ignore",
  "alert-pin",
  "alert-unpin",
  "alert-pins",
  "improve",
  "improve-feedback",
  "adopt",
  "intelligence",
  "compatibility",
  "skill-audit",
  "interop",
  "benchmark",
  "capabilities",
  "candidate",
  "catalog-update",
  "discover",
  "review-queue",
  "review",
  "credentials",
  "models",
  "keygen",
  "catalog-sign",
  "catalog-verify",
  "completion",
  "mcp-recipe",
  "mcp",
  "inspect",
  "evaluate",
  "head-to-head",
  "watch",
  "schedule",
  "unschedule",
  "sandbox-run",
  "mcp-config",
  "codex-mcp-config",
  "plan",
  "install",
  "convert",
  "canary",
  "serve",
]);
