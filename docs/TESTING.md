# Testing Loadout as a product

The primary product is the CLI. Use this walkthrough before installing into your real
Codex, Claude Code, or other agent directories.

## 0. Choose the truthful account capability

ChatGPT and Claude subscriptions do not include separately billed model API usage.
If those subscriptions are all you have, choose `None` in interactive setup or pass:

```bash
npx . setup --mode stable --api-access none
```

This does not reduce the portable skill library. Automatic broad setup installs only
screened static skill directories, which do not require OpenAI, Anthropic, or
OpenRouter credentials. MCP servers and executable runtimes remain explicit. Never
paste an API key into `--api-access`; it accepts provider names only and rejects
key-like input.

The automated product journey runs the built CLI against disposable user, state, and
project directories. It performs a real scan and offline provenance comparison, then
previews and applies project optimization, verifies the installed bytes, and rolls the
snapshot back:

```bash
npm run test:e2e:cli
```

This test does not use the dashboard, network, mock command output, or any real agent
profile. It is a required CI gate on Ubuntu; the manual cross-platform workflow runs
the broader native filesystem suite.

The README journey is a separate deterministic gate. It compiles an isolated build,
installs a local reviewed fixture into disposable Loadout/user homes, checks its
manifest, lock, hashes, privacy card, activation, and rollback, then deletes the
fixture and build:

```bash
npm run test:e2e:readme
```

### README product-flow verification contract

The README gate is a mixed core-integration/CLI flow, not a claim that two complete
native-agent journeys run end to end. It deliberately:

- compiles into an isolated temporary build instead of trusting the repository's
  existing `dist` tree;
- redirects Loadout state, user-home, and project paths to disposable directories;
- uses a checked-in offline fixture, so its normal result does not depend on the
  network or mutable upstream repositories;
- calls the core planner and installer directly to verify fixture planning, library
  installation, manifest and lock generation, recorded hashes, and audit state; and
- starts CLI subprocesses to verify optimize preview/apply, privacy-safe card
  rendering, and rollback restoration through the packaged command boundary.

The executable outcome assertions also require isolated-build and offline-fixture
mode, created state directories, persisted install records, file hashes, snapshots,
library transitions, manifest/lock consistency, an unmanaged sentinel that survives,
and byte restoration after rollback.

These checks prove Loadout's behavior against disposable filesystem targets. They do
not prove that every native agent recognizes or executes an installed skill, that a
live catalog is reachable, that the current npm package is published, or that third-party content
is universally safe. The opt-in `LOADOUT_TEST_LIVE_CATALOG=1` extension separately
checks the current pinned Stable sources and remains network-dependent.

Run `npm run verify` for formatting, lint, types, deterministic evidence checks, all
Vitest suites, both CLI journeys, package smoke, and the performance gate. Run
`npm run verify:full` only when Playwright Chromium is installed and the optional
dashboard browser test is also wanted.

Current npm publication, the current pinned Stable repositories, and GitHub repository
settings are external state. Check them separately with:

```bash
npm run check:live -- --npm --stable-install --github
```

Each requested check reports `verified`, `failed`, or `not-verified`; missing access is
not converted into a pass.

## 1. Build the exact npm package entry point

```bash
cd /path/to/loadout
npm ci
npm run build
npx . --help
```

`npx .` runs the same `loadout` executable that `npx loadout-ai` will run after npm
publication.

Before creating a disposable profile, the only recommended real-profile command is the
read-only inventory:

```bash
npx . scan
```

It reports actual `SKILL.md` capabilities, Loadout ownership, duplicates, and capacity
warnings. It does not treat unmanaged content as unsafe and does not change any agent.

To build the local reviewed provenance index from exact catalog commits and compare a
reported skill:

```bash
npx . scan --refresh-provenance
npx . compare <skill-name>
```

The first command writes only Loadout's local cache. `compare` is read-only and uses
`--offline` when a test must forbid network fallback. A same-name match is a candidate,
not proof of provenance or quality.

To inspect and exercise the managed active set after installing a package:

```bash
npx . library
npx . disable <managed-package>             # dry-run
npx . disable <managed-package> --yes       # cache, verify, deactivate
npx . enable <managed-package>               # dry-run
npx . enable <managed-package> --yes         # verify and reactivate
```

Copy the snapshot id printed by either applied command to test
`npx . rollback --snapshot <id>`. These commands refuse unmanaged packages, drifted
managed content, incomplete library copies, quarantined entries, and occupied enable
targets.

## 2. Create a completely disposable agent profile

macOS or Linux:

```bash
TEST_HOME="$(mktemp -d)"
export LOADOUT_USER_HOME="$TEST_HOME/user"
export LOADOUT_HOME="$TEST_HOME/state"
mkdir -p "$LOADOUT_USER_HOME/.codex" "$LOADOUT_USER_HOME/.claude"
```

PowerShell:

```powershell
$TestHome = Join-Path $env:TEMP ("loadout-test-" + [guid]::NewGuid())
$env:LOADOUT_USER_HOME = Join-Path $TestHome "user"
$env:LOADOUT_HOME = Join-Path $TestHome "state"
New-Item -ItemType Directory -Force (Join-Path $env:LOADOUT_USER_HOME ".codex") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $env:LOADOUT_USER_HOME ".claude") | Out-Null
```

Those empty directories make Loadout detect virtual Codex and Claude Code profiles.
Every write stays below the disposable path.

## 3. Preview Power, then inspect Maximum Library

Power is the broad daily-use profile:

```bash
npx . setup --mode power
```

Expect a curated skill-level set across reviewed collections. Stable is the bounded
30-skill daily driver. Maximum prepares the full screened skill library:

```bash
npx . setup --mode maximum
```

This is read-only. Expect the CLI to show:

- detected agents;
- reviewed catalog repositories fetched at pinned commits;
- actual skill-directory targets, not only repository count;
- lower-ranked duplicate skills that were deferred;
- MCP-only repositories requiring explicit configuration;
- safety categories requiring a separate approval.
- invalid individual skill units quarantined without losing safe siblings.

No agent skill directory or Loadout install state is created by preview.

## 4. Download the reviewed library

```bash
npx . setup --mode maximum --yes --approve-risk
```

`--approve-risk` acknowledges the displayed scripts, domains, environment names, or
instruction findings inside the reviewed skill content. Loadout copies skills into its
disabled library but does not execute repository installation or lifecycle scripts.

The command should finish with one snapshot identifier. The library download is one
transaction: a failure restores every library/state target rather than leaving a
half-installed profile.

If Stable is already installed, this command is also a required regression exercise:
matching Stable units must remain active, their agent-visible bytes must not change,
and only the additional Maximum units should appear disabled in `npx . library`.

## 5. Inspect the installed product

```bash
npx . list
npx . status
npx . health
npx . library
npx . optimize --project .
npx . optimize --project . --yes
```

The first optimize command is a dry run. The second activates only reviewed,
project-relevant skill units, verifies their hashes, and prints the exact snapshot
rollback command.

`health` is local and fast by default. Use `npx . health --updates` or
`npx . update` when you intentionally want live network update checks.

You can also inspect the disposable files directly:

```bash
find "$LOADOUT_USER_HOME/.agents/skills" -name SKILL.md | wc -l
find "$LOADOUT_USER_HOME/.claude/skills" -name SKILL.md | wc -l
```

## 6. Verify rollback

```bash
npx . rollback
npx . list
```

The second command should report that no Loadout-managed packages are installed. Files
that existed before setup must remain byte-identical.

## 7. Test the real interactive experience

After the disposable run succeeds, open a fresh terminal without `LOADOUT_HOME` or
`LOADOUT_USER_HOME` overrides and run:

```bash
npx .
```

Choose Maximum, Stable, or Custom, review the plan, and confirm only when you want to
write to the detected real agent profiles. After npm publication, replace `npx .` with
`npx loadout-ai`.

## 8. Test credential-gated MCP configuration without exposing a key

List the reviewed recipes that need no separately billed AI/model API key:

```bash
npx . mcp-recipe --no-key
```

This includes Playwright, Chrome DevTools, and GitHub read-only. The first two have no
service credential. GitHub read-only needs a GitHub token and must refuse `--yes`
until its declared environment reference resolves. Use `--credential-free` for the
stricter zero-credential list:

```bash
npx . mcp-recipe --credential-free
```

```bash
npx . mcp-recipe github-readonly --config "$TEST_HOME/mcp.json" --yes

export LOADOUT_TEST_GITHUB_TOKEN='<a disposable, least-privilege token>'
npx . mcp-recipe github-readonly --config "$TEST_HOME/mcp.json" \
  --credential GITHUB_PERSONAL_ACCESS_TOKEN=env:LOADOUT_TEST_GITHUB_TOKEN
npx . mcp-recipe github-readonly --config "$TEST_HOME/mcp.json" \
  --credential GITHUB_PERSONAL_ACCESS_TOKEN=env:LOADOUT_TEST_GITHUB_TOKEN --yes
unset LOADOUT_TEST_GITHUB_TOKEN
```

The first command must fail without writing the server entry. The preview and applied
output must never contain the token value; the config should contain only
`${LOADOUT_TEST_GITHUB_TOKEN}`. OS-keychain references are supported by the separate,
explicit `--connect --approve-risk` verification path because an arbitrary MCP host
cannot resolve Loadout's keychain reference by itself.

## Optional dashboard

The dashboard is a secondary inspection surface, not the onboarding requirement:

```bash
npx . dashboard
```

Open the printed loopback URL. CLI setup, updates, removal, discovery, and rollback all
work without it. Browser automation is also optional and runs only when manually
dispatched in CI; locally, use `npm run test:e2e:dashboard`.

## Final cleanup test

```bash
npx . uninstall
npx . uninstall --yes
```

The first command is a dry run. The second removes only Loadout-managed agent files,
runtime tools, native jobs, state, snapshots, and cache; it leaves the locally invoked
package itself alone. Use `--remove-cli` only when testing a global npm install.
