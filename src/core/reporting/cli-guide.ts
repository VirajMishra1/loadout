/** Plain-language entry points for people using the CLI, not maintaining it. */
export const BEGINNER_GUIDE = `
Loadout — manage the skills, tools, and MCP servers your AI agents use.

FIRST TIME

  loadout doctor                    which agents you have, and whether they are healthy
  loadout setup --mode stable       preview 30 reviewed skills (nothing changes)
  loadout setup --mode stable --yes install them

IN A PROJECT

  loadout recommend --project .     what this codebase actually needs
  loadout optimize --project .      propose an active set for it
  loadout status                    health grade and what is managed

WHILE YOU WORK

  loadout route                     your model policy: hard / normal / cheap
  loadout route <describe a task>   which of those it looks like, and what to use
  loadout handoff codex "..."       give a task to your other agent

USE IT INSIDE YOUR AGENT

  loadout skills install loadout-router --yes

  Then just ask your agent "which model should I use for this?" instead of
  coming back here.

KEEPING CURRENT

  loadout health                    safer updates and local drift
  loadout alerts                    archived, stale, or changed sources

Every command that writes previews first and snapshots before it changes
anything. Undo with: loadout rollback

More commands: loadout advanced
`.trim();

export const ADVANCED_GUIDE = [
  "ADVANCED COMMANDS",
  "",
  "Hidden from the first screen so daily use stays focused.",
  "",
  "Discovery:    candidate, discover, review-queue, evaluate, skill-audit",
  "Sharing:      init, lock, export, import, share, card",
  "Integrations: mcp-recipe, mcp-config, credentials, models, handoff, skills, convert",
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
  "add",
  "unadd",
  "share",
  "card",
  "search",
  // analytics / evidence / discovery
  "report",
  "versions",
  "skill-audit",
  "candidate",
  "discover",
  "review-queue",
  "inspect",
  "propose",
  "evaluate",
  // integrations / credentials / runtime
  "credentials",
  "models",
  "handoff",
  "completion",
  "mcp-recipe",
  "mcp-config",
  "convert",
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
