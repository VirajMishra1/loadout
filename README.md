# Loadout

**One CLI that finds, installs, updates, and rolls back useful extensions for AI coding agents.**

Loadout configures skill-directory targets for Codex, Claude Code, Cursor, Gemini CLI, OpenCode, Hermes, Windsurf, Cline, GitHub Copilot, Roo Code, Kiro CLI, and Junie. These are Loadout's adapter declarations, not proof that each native application recognizes the paths; the exact filesystem, platform, and native-application evidence boundaries are below.

<!-- loadout:support-summary:start -->

Loadout's adapter capability matrix currently declares configured skill-directory targets for **12 agents**: Claude Code, Cline, Codex, Cursor, Gemini CLI, GitHub Copilot, Hermes, Junie, Kiro CLI, OpenCode, Roo Code, Windsurf.

| Agent          | Skill path         | Disposable filesystem lifecycle | Native application | Platform evidence                                                     |
| -------------- | ------------------ | ------------------------------- | ------------------ | --------------------------------------------------------------------- |
| Claude Code    | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| Cline          | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| Codex          | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| Cursor         | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| Gemini CLI     | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| GitHub Copilot | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| Hermes         | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| Junie          | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| Kiro CLI       | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| OpenCode       | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| Roo Code       | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |
| Windsurf       | Loadout-configured | Not verified                    | Not verified       | Linux (CI configured), macOS (CI configured), Windows (CI configured) |

Platform evidence source: `.github/workflows/ci.yml (cross-platform job)`.

`tests/adapter-conformance.test.ts` plans, applies, inspects, disables, re-enables, and rolls back one skill for every row when the suite runs. A configured target path does not prove that the native application recognizes or executes it. Native application execution is not inferred from filesystem simulation. Configured CI platforms describe a manually triggered workflow, not evidence that a current run passed.

<!-- loadout:support-summary:end -->

It solves a simple problem: useful skills and MCP tools are scattered across hundreds of repositories. Loadout brings them into one place, checks what is actually inside, shows every change before making it, and keeps a snapshot so you can undo it.

## Start here

You need Node.js 20 or newer and Git.

```bash
npm install --global loadout-ai@0.3.2
loadout --version
loadout upgrade
```

`loadout upgrade` is a read-only preview. It detects your installed agents, checks what you already have, scans the current project, recommends useful additions, and shows the exact files it would change.

When the preview looks right:

```bash
loadout upgrade --yes
```

Every applied change creates a snapshot. Undo the latest change with:

```bash
loadout rollback
```

Remove one package with `loadout remove <package>`. Remove everything Loadout owns
with a preview-first command:

```bash
loadout uninstall
loadout uninstall --yes
loadout uninstall --yes --remove-cli
```

The first command changes nothing. Complete uninstall preserves unmanaged files and
stops if a Loadout-managed file contains your edits unless you explicitly add
`--force`.

## Choose how much you want

| Mode        | Best for                                     | What happens                                                                                                                                            |
| ----------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stable**  | Almost everyone                              | Installs 30 high-value everyday skills from four selected sources. This is the default.                                                                 |
| **Power**   | Users who want a larger active toolkit       | Selects cross-project skills from eight major collections. The current preview prepares 50 skill directories and quarantines flagged individual skills. |
| **Maximum** | People who want the largest possible library | Downloads every usable skill in the 50-repository catalog into a disabled library. It does not flood every agent with 1,000+ active skills.             |
| **Custom**  | Users who know exactly what they want        | Installs only the package IDs they choose.                                                                                                              |

Preview any mode first:

```bash
loadout setup --mode stable
loadout setup --mode power
loadout setup --mode maximum
```

Apply the chosen plan only after reading it:

```bash
loadout setup --mode stable --yes
loadout setup --mode power --yes --approve-risk
loadout setup --mode maximum --yes --approve-risk
```

Maximum currently finds 1,158 usable skill directories across 29 skill repositories and keeps them disabled until needed. Nineteen MCP-only repositories remain separate setup choices because MCP servers may need credentials, local software, or broader permissions.

## How Loadout chooses repositories

Loadout does not install every repository above an arbitrary star count. Stars help discovery, but popularity alone cannot show whether a repository is maintained, duplicated, unsafe, incompatible, or even useful for your work.

The selection process is:

1. **Discover broadly.** Search GitHub, Hacker News, skills.sh, and the official MCP Registry.
2. **Inspect the real contents.** Find skills, MCP declarations, plugins, commands, agents, and executable setup requirements.
3. **Check trust evidence.** Record the exact Git commit, license status, source paths, maintenance signals, overlaps, and static safety findings.
4. **Compare like with like.** A testing tool is compared with testing tools, not with an unrelated design skill.
5. **Choose a tier.** Stable is Loadout's bounded policy selection; Power is broader; Maximum keeps the full inspected library available.
6. **Keep watching.** New candidates and changes are recorded every day, but nothing is silently promoted or installed.

The bundled catalog contains **50 credited public repositories** across 37 categories. Thirty-one contain skills and 19 are MCP-only. See every source, direct repository link, pinned commit, component type, and license status in **[Catalog and upstream credits](./docs/CATALOG.md)**.

<!-- loadout:catalog-coverage:start -->

The bundled catalog currently contains **50 credited public repositories** across **37 categories**: **31 have skill components** and **19 are MCP-only**. All 50 are technically screened and pinned; 4 sources are selected by the bounded Stable policy. See every linked source, license status, component type, and pinned commit in **[Catalog and upstream credits](./docs/CATALOG.md)**.

<!-- loadout:catalog-coverage:end -->

<!-- loadout:evidence-stages:start -->

Current catalog evidence-stage counts:

| Stage           | Records |
| --------------- | ------: |
| benchmarked     |       0 |
| discovered      |       0 |
| human-reviewed  |       0 |
| inspected       |      46 |
| policy-selected |       4 |

<!-- loadout:evidence-stages:end -->

Loadout does not claim there is one universally “best” configuration. Stable is selected by deterministic Loadout rules from pinned, inspected records. That policy selection is distinct from human review and benchmarking, both of which currently have zero catalog records.

## Get recommendations for the current project

Yes—Loadout can inspect a project and recommend what belongs in its working set.

```bash
loadout recommend --project .
```

This reads local project metadata such as `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, framework dependencies, and test configuration. It does not upload your code.

If you downloaded Maximum, use rule-based project signals to propose inspected skills for activation:

```bash
loadout optimize --project .             # preview
loadout optimize --project . --limit 30  # preview with a smaller cap
loadout optimize --project . --limit 30 --yes
```

You can still override the result:

```bash
loadout optimize --project . --pin package-id/skill-name
loadout enable package-id/skill-name --yes
loadout disable package-id/skill-name --yes
```

## Find new and better options every day

Loadout has two separate daily checks:

- **Discovery radar** finds new and fast-growing repositories and puts them in a review queue.
- **Update radar** checks installed Loadout packages for a newer reviewed commit, archive status, staleness, file drift, and permission changes.

Enable both at a local time of your choice:

```bash
loadout autopilot --time 09:00       # preview
loadout autopilot --time 09:00 --yes # enable
loadout autopilot --remove --yes     # remove
```

Autopilot uses the native scheduler on macOS, Linux, or Windows. Scheduled jobs are read-only: they can discover and report, but they cannot install, promote, execute, or update anything.

Check the results with:

```bash
loadout review-queue
loadout candidate list --limit 20
loadout alerts --updates
loadout update
```

`loadout update` checks the saved Stable, Power, Maximum, or Custom profile plus every
managed repository. It is read-only. `loadout update --yes` applies reviewed profile
changes and safe screened updates; anything disabled, risky, or failed is held for
review. Daily checks never include `--yes`.

The wording matters:

- A **new lead** is interesting enough to inspect, not “must install.”
- An **available update** is a different reviewed commit, not automatically better.
- A **replacement alert** appears only when category-specific comparison evidence supports it.

Loadout will never call a viral repository better just because its star count jumped. That protects users from hype, compromised repositories, and tools that solve a completely different problem.

The repository also refreshes a public discovery report every day:

<!-- loadout:daily-discovery:start -->

**Discovery snapshot (generated 2026-07-17):** [242 repositories observed](./docs/DISCOVERED.md), including 219 uncataloged review candidates and 23 repositories already in the inspected catalog.
<!-- loadout:daily-discovery:end -->

See **[today's generated discovery report](./docs/DISCOVERED.md)** for direct links, observed star velocity, age, license metadata, and the searches that found each repository. The GitHub README updates when the daily workflow commits new evidence; an already-installed npm package keeps its own versioned documentation until the next npm release.

Inspect a promising lead without running its code:

```bash
loadout discover --source all --queue
loadout review-queue
loadout candidate inspect owner/repository --output ./candidate-dossier.json
```

The dossier records what the repository contains, its exact commit, its license signal, possible overlaps, and static findings. Promotion into the catalog still requires review.

## Chat subscriptions and API keys

A ChatGPT Plus/Pro or Claude Pro/Max subscription is not the same as separately billed API access. You do **not** need an OpenAI, Anthropic, or OpenRouter API key for Stable, Power, Maximum, discovery, project recommendations, updates, or rollback.

Tell non-interactive setup what separately billed API access is available without passing a secret:

```bash
loadout setup --mode stable --api-access none
loadout setup --mode maximum --api-access openai,anthropic
```

Loadout never treats API access as permission to install an MCP server. Credentialed MCP tools remain explicit setup steps, and configuration stores an environment-variable or OS-keychain reference rather than the secret value.

See the reviewed MCP recipes that need no separately billed AI/model API key:

```bash
loadout mcp-recipe --no-key
```

This includes Playwright MCP, Chrome DevTools MCP, and GitHub's read-only MCP. Loadout
shows non-AI credentials separately: GitHub MCP needs a GitHub token, while the two
browser recipes need no credential. Use `loadout mcp-recipe --credential-free` for the
stricter zero-credential list. Browser control and service authorization remain
explicit.

```bash
export LOADOUT_GITHUB_TOKEN="$GITHUB_PERSONAL_ACCESS_TOKEN"

loadout mcp-recipe github-readonly --config ./mcp.json \
  --credential GITHUB_PERSONAL_ACCESS_TOKEN=env:LOADOUT_GITHUB_TOKEN

loadout mcp-recipe github-readonly --config ./mcp.json \
  --credential GITHUB_PERSONAL_ACCESS_TOKEN=env:LOADOUT_GITHUB_TOKEN \
  --yes
```

## Graphify and other executable tools

Graphify is included as a separate reviewed tool recipe, not disguised as a portable skill. Its setup uses a pinned version and artifact hash, an isolated runtime, an exact preview, and rollback.

```bash
loadout tool
loadout tool graphify --agents codex
loadout tool graphify --agents codex --yes --approve-risk
loadout tool graphify --remove
```

Executable tools and MCP servers receive separate treatment because they can run processes, use credentials, or open network connections. Broad setup never runs third-party repository installers.

## Useful commands

| Goal                                      | Command                                       |
| ----------------------------------------- | --------------------------------------------- |
| See the guided upgrade                    | `loadout upgrade`                             |
| Install a loadout                         | `loadout setup --mode stable\|power\|maximum` |
| See detected agents and installed skills  | `loadout status`                              |
| Inspect health and evidence               | `loadout health --explain`                    |
| Browse the inspected catalog              | `loadout catalog`                             |
| Search by capability                      | `loadout search <words>`                      |
| Recommend for a project                   | `loadout recommend --project .`               |
| Activate relevant library skills          | `loadout optimize --project .`                |
| Find new repositories                     | `loadout discover --source all --queue`       |
| Read the discovery queue                  | `loadout review-queue`                        |
| Check installed changes                   | `loadout alerts --updates`                    |
| Preview updates                           | `loadout update`                              |
| Apply all safe reviewed updates           | `loadout update --yes`                        |
| Undo the latest applied change            | `loadout rollback`                            |
| Completely remove Loadout                 | `loadout uninstall`                           |
| Test safely without touching your profile | `loadout demo`                                |
| See every command                         | `loadout --help`                              |

Shell completion is available for Bash, Zsh, Fish, and PowerShell:

```bash
loadout completion zsh > ~/.zfunc/_loadout
```

## What Loadout changes

Before any managed write, Loadout:

1. fetches the exact reviewed Git commit;
2. inspects the selected contents;
3. resolves duplicate target names;
4. prints safety findings and every destination;
5. waits for explicit approval;
6. snapshots the old state;
7. applies the change as one transaction;
8. records hashes for later drift checks and rollback.

Loadout state lives under `~/.loadout` by default. It never executes arbitrary third-party install scripts during broad setup. Maximum stores additional skills in a disabled library, and invalid individual skills are quarantined without discarding their safe siblings.

## Test the product

Run a real install-and-rollback flow in a temporary Codex profile:

```bash
loadout demo
```

For contributors:

```bash
npm ci
npm run verify
```

`verify` checks formatting, lint, types, catalog evidence, unit and integration tests, two real CLI product flows, an installed-package smoke test, and a 1,000-skill performance gate. The README-specific flow uses a local reviewed fixture and disposable `LOADOUT_HOME`/`LOADOUT_USER_HOME`, so its install, hash, manifest/lock, privacy-card, activation, and rollback assertions require no network and cannot touch your real profile. Run `npm run build && node scripts/readme-product-flow.mjs --live-catalog` separately to repeat the installation portion against the current pinned Stable catalog; that opt-in check requires network access and is not part of `verify`.

<!-- loadout:verification-summary:start -->

`verify` invokes `format:check`, `lint`, `typecheck`, `check:evidence`, `test`, `test:e2e:cli`, `test:e2e:readme`, `test:package`, `test:performance` in that order. Use `npm run verify:full` to include the optional Playwright dashboard check.

<!-- loadout:verification-summary:end -->

Use the **[product testing guide](./docs/TESTING.md)** for Power, Maximum, project optimization, credentials, and rollback. Use the **[complete feature matrix](./docs/FEATURE_TEST_MATRIX.md)** when you want to exercise every CLI feature and understand which commands read files, use the network, start processes, or write state.

No bundled source is called benchmarked until real isolated trials, signed evidence, and human approval exist.

## Current beta limits

- Daily discovery creates leads; it does not automatically make them trusted catalog entries.
- Replacement alerts need real comparison evidence. Loadout does not invent a winner from stars or recency.
- MCP-only records need explicit configuration and may need external credentials or software.
- Graphify is the first fully reviewed executable recipe; other runtime tools need equivalent recipe work.
- Six catalog records currently have `NOASSERTION` license metadata and should be reviewed before relying on their license status.
- The bundled catalog is technically screened and finite; Stable is a deterministic policy-selected subset, not a human-reviewed or benchmark-proven winner, and discovery leads do not auto-promote themselves.
- Public GitHub is the default source. Private GitHub discovery requires explicit authorization through an environment or native credential reference.
- Skill components are the only components installed automatically by broad setup. MCP-only records require an explicit recipe or configuration target.
- Executable tools are never included in broad setup. Graphify has a separately previewed, pinned, credential-isolated, reversible runtime recipe; additional runtime tools require the same reviewed-recipe treatment.

<!-- loadout:current-limits:start -->

- **6 catalog records** currently have `NOASSERTION` license status and need upstream-license review before a public release decision.

<!-- loadout:current-limits:end -->

- The local registry works for development and self-hosting; there is no hosted Loadout registry service yet.
- The optional dashboard exists for diagnostics, but the complete product is CLI-first.

## More detail

<details>
<summary><strong>All 50 upstream projects credited by Loadout</strong></summary>

- [Superpowers](https://github.com/obra/superpowers)
- [Context7](https://github.com/upstash/context7)
- [Playwright MCP](https://github.com/microsoft/playwright-mcp)
- [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
- [GitHub MCP Server](https://github.com/github/github-mcp-server)
- [OpenAI Skills Catalog](https://github.com/openai/skills)
- [Anthropic Skills](https://github.com/anthropics/skills)
- [Agent Skills Marketplace](https://github.com/wshobson/agents)
- [Vercel Agent Skills](https://github.com/vercel-labs/agent-skills)
- [Vercel Skills](https://github.com/vercel-labs/skills)
- [Cloudflare MCP Server](https://github.com/cloudflare/mcp-server-cloudflare)
- [Supabase MCP](https://github.com/supabase/mcp)
- [Sentry MCP](https://github.com/getsentry/sentry-mcp)
- [Exa MCP Server](https://github.com/exa-labs/exa-mcp-server)
- [Firecrawl MCP Server](https://github.com/firecrawl/firecrawl-mcp-server)
- [Azure DevOps MCP](https://github.com/microsoft/azure-devops-mcp)
- [Docker MCP Gateway](https://github.com/docker/mcp-gateway)
- [Hugging Face MCP Server](https://github.com/huggingface/hf-mcp-server)
- [Awesome Copilot](https://github.com/github/awesome-copilot)
- [OpenAI Codex Skills](https://github.com/openai/codex)
- [Ponytail](https://github.com/DietrichGebert/ponytail)
- [Addy Osmani Agent Skills](https://github.com/addyosmani/agent-skills)
- [Scientific Agent Skills](https://github.com/K-Dense-AI/scientific-agent-skills)
- [Planning with Files](https://github.com/OthmanAdi/planning-with-files)
- [PM Skills](https://github.com/phuryn/pm-skills)
- [Baoyu Skills](https://github.com/JimLiu/baoyu-skills)
- [Trail of Bits Skills](https://github.com/trailofbits/skills)
- [Antfu Skills](https://github.com/antfu/skills)
- [.NET Skills](https://github.com/dotnet/skills)
- [Microsoft Skills](https://github.com/microsoft/skills)
- [Web Quality Skills](https://github.com/addyosmani/web-quality-skills)
- [Softaworks Agent Toolkit](https://github.com/softaworks/agent-toolkit)
- [Draw.io Skill](https://github.com/Agents365-ai/drawio-skill)
- [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)
- [Serena](https://github.com/oraios/serena)
- [Model Context Protocol Servers](https://github.com/modelcontextprotocol/servers)
- [AWS MCP Servers](https://github.com/awslabs/mcp)
- [DBHub](https://github.com/bytebase/dbhub)
- [FastAPI MCP](https://github.com/tadata-org/fastapi_mcp)
- [Browser MCP](https://github.com/BrowserMCP/mcp)
- [AntV Chart MCP](https://github.com/antvis/mcp-server-chart)
- [Excel MCP Server](https://github.com/haris-musa/excel-mcp-server)
- [arXiv MCP Server](https://github.com/blazickjp/arxiv-mcp-server)
- [Google Workspace MCP](https://github.com/taylorwilsdon/google_workspace_mcp)
- [MongoDB MCP Server](https://github.com/mongodb-js/mongodb-mcp-server)
- [Redis MCP Server](https://github.com/redis/mcp-redis)
- [Stripe AI](https://github.com/stripe/ai)
- [MCP Toolbox for Databases](https://github.com/googleapis/mcp-toolbox)
- [Browserbase MCP Server](https://github.com/browserbase/mcp-server-browserbase)
- [Bright Data MCP](https://github.com/brightdata/brightdata-mcp)

Thank you to every maintainer and contributor. Inclusion is attribution and discovery metadata, not ownership, endorsement, or relicensing.

</details>

- [Catalog and all upstream credits](./docs/CATALOG.md)
- [Daily generated discovery report](./docs/DISCOVERED.md)
- [How candidates are inspected and promoted](./docs/CANDIDATE_INTELLIGENCE.md)
- [Catalog ranking and conflict policy](./docs/CATALOG_POLICY.md)
- [Security policy](./SECURITY.md)
- [Testing guide](./docs/TESTING.md)
- [Complete CLI feature test matrix](./docs/FEATURE_TEST_MATRIX.md)
- [Engineering master plan](./MASTER_PLAN.md)

## License

Loadout is licensed under the [MIT License](./LICENSE). Catalog entries keep their own upstream licenses and terms; Loadout links and credits them but does not relicense them.

Built for the OpenAI Build Week **Developer Tools** category.
