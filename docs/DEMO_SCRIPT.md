# Loadout demo and voiceover

Target length: **2:35 to 2:50**. Record the real CLI, cut fetch waits and typing, and do
not show the retired dashboard. The final YouTube upload must be public.

## Before recording

1. Close terminals that show tokens, private paths you do not want public, or unrelated
   work. Increase terminal font size and use a window about 120 columns wide.
2. Confirm the release and product health:

   ```bash
   npm install --global loadout-ai@0.5.9
   hash -r
   loadout --version
   loadout health
   ```

3. Finish the remaining founder acceptance path before recording. Keep the useful
   successful output in terminal history, but start the recording from a clean prompt.
4. Rehearse the voiceover once. Use macOS Screenshot (`Shift-Command-5`) with your
   microphone, OBS, or another recorder. Record at normal speed; speed the final cut
   to 1.1x only if necessary.

## Shot list and exact narration

### 0:00 to 0:15: the problem

**Screen:** README hero, then a terminal showing `loadout --version`.

**Say:**

> AI coding extensions are scattered across GitHub. You find a skill on X, an MCP
> server on Reddit, copy it into one agent, and later have no idea where it came from
> or how to undo it. I built Loadout: one local CLI to discover, inspect, install,
> update, and roll back agent extensions across Codex, Claude Code, and other agents.

### 0:15 to 0:50: one safe install

**Screen:** Run the preview, then apply. Cut the fetch wait, not the result.

```bash
loadout setup --mode stable --agents codex,claude-code --api-access none
loadout setup --mode stable --agents codex,claude-code --api-access none --yes
```

**Say:**

> Stable selects thirty useful skill directories per agent from four pinned public
> sources. The first run is a preview: it shows the sources, targets, credentials, and
> safety findings without changing agent files. When I approve it, Loadout applies one
> transaction and gives me a rollback snapshot. My ChatGPT and Claude subscriptions
> are not treated as API keys, and normal skill setup does not need one.

### 0:50 to 1:12: see what changed and undo it

**Screen:**

```bash
loadout scan
loadout status
loadout rollback --list
loadout rollback --snapshot <stable-snapshot-id>
```

**Say:**

> Scan separates Loadout-managed skills from files I already had. Status keeps source
> and version ownership, and rollback restores the exact pre-install snapshot while
> preserving unrelated skills. I use the exact snapshot ID shown by the install, so
> there is no ambiguity. Complete uninstall is available too.

### 1:12 to 1:42: broad catalog, focused project

**Screen:** Show the profile choices, catalog coverage, and a real project
recommendation. These commands are read-only and do not require a prepared Maximum
library.

```bash
loadout profiles
loadout catalog --coverage
loadout recommend --project . --agent codex
```

**Say:**

> Loadout has three useful levels. Stable installs a bounded daily set. Power is
> broader. Maximum keeps a large screened library disabled instead of dumping every
> skill into every prompt. For this TypeScript CLI, the project recommender proposes
> tools for documentation, testing, security, and MCP work without changing anything.

### 1:42 to 2:05: MCP, tools, and custom skills

**Screen:**

```bash
loadout mcp-recipe --credential-free
loadout mcp-recipe playwright --agent codex
loadout tool graphify --agents codex,claude-code
loadout install --mode custom --package humanizer --agents codex
```

**Say:**

> MCP servers and executable tools are never hidden inside a profile. Playwright is a
> separately previewed MCP recipe; Graphify is a pinned runtime tool; and a catalog
> skill such as Humanizer can be installed directly through Custom mode. Each path
> discloses permissions and credentials before approval.

### 2:05 to 2:25: today and tomorrow

**Screen:**

```bash
loadout update
loadout candidate list --limit 5
```

**Say:**

> Update checks managed pinned sources without silently changing them. The discovery
> feed watches a wider ecosystem and ranks new projects for review. A repository can
> be noticed quickly without being trusted or installed blindly.

### 2:25 to 2:48: Codex, GPT-5.6, and close

**Screen:** README section “Built with Codex and GPT-5.6”, then return to the hero.

**Say:**

> We used Codex and GPT-5.6 throughout the build: architecture, threat modelling,
> cross-platform implementation, repo-wide debugging, tests, and the real founder
> acceptance loop. Those tests caught rollback, project-scope, inventory, and update
> bugs on my actual Codex and Claude profiles. Loadout itself stays local and does not
> require an OpenAI API key. One command gives your AI agents a loadout you can
> understand, improve, and undo.

## Final edit and upload

- Remove loading screens, typing pauses, repeated commands, notifications, and secrets.
- Keep terminal output readable at 1080p; do not use a synthetic dashboard or mock data.
- Add a small title card: **Loadout: Agent extensions, under control.**
- Export under three minutes and upload publicly to YouTube.
- Watch the uploaded video once, confirm audio and text are legible, then paste the
  exact public URL into README and Devpost.

## Submission checklist

- [ ] Public YouTube video is under three minutes and its URL opens signed out.
- [ ] Voiceover explains the product, Codex usage, and GPT-5.6 usage.
- [ ] `/feedback` was run in Codex and the session ID is in Devpost.
- [ ] Repository URL is accessible to Devpost and OpenAI.
- [ ] README has npm setup and the judge testing path.
- [ ] Every teammate has accepted the Devpost invitation.
- [ ] Category is **Developer Tools**.
- [ ] Submission is submitted, not left as a draft.
