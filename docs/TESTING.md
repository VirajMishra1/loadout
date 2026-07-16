# Testing Loadout as a product

The primary product is the CLI. Use this walkthrough before installing into your real
Codex, Claude Code, or other agent directories.

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

Expect a curated skill-level set across the strongest reviewed collections. Stable
remains the smallest Superpowers + Context7 option. Maximum prepares the full library:

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

## Optional dashboard

The dashboard is a secondary inspection surface, not the onboarding requirement:

```bash
npx . dashboard
```

Open the printed loopback URL. CLI setup, updates, removal, discovery, and rollback all
work without it. Browser automation is also optional and runs only when manually
dispatched in CI; locally, use `npm run test:e2e:dashboard`.
