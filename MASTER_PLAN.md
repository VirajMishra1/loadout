# Loadout Master Plan

Status: Approved baseline for implementation  
Hackathon: OpenAI Build Week 2026  
Category: Developer Tools  
Team size: 3  
Target submission: July 21, 2026 at 5:00 PM Pacific / July 22 at 4:00 AM Dubai

## Current status and remaining work (July 21, 2026)

This is the authoritative active list. The long phase history below is retained as
an archival engineering record, not a second active plan and not a command to build
every speculative system before users can test Loadout. Completed implementation
plans and contributor-specific plans have been consolidated here and removed.

### Implemented product work

- [x] `P18-01 [TERRA]` Make the first CLI screen beginner-readable: a read-only
      `loadout guide`, concise default library summary, focused first-screen help,
      and retained access to every advanced command through `loadout advanced` or
      `<command> --help`.
- [x] `P18-02 [TERRA]` Make core machine output honest: `catalog --json` returns
      JSON, and `update --package <id>` checks only that package rather than every
      tracked installation.
- [x] `P18-04 [TERRA]` Bound and explain live network checks in `health --updates`
      and `watch --once`; they must show progress, a clear timeout, and an actionable
      result even when a large Maximum library is present.
- [x] `P18-05 [TERRA]` Make Agent Health distinguish active skills from disabled
      Maximum-library copies, so a broad download is not presented as a broken active
      configuration.
- [x] `P18-06 [TERRA+LUNA]` Audit the local dashboard with real founder state at
      desktop and mobile widths. Keep it optional, reduce jargon, and only add UI
      actions that retain preview, explicit acknowledgement, snapshot, and rollback.
- [x] `P18-07 [TERRA]` Add a concise beginner section to README that links to the
      testing guide and explains Stable, Power, Maximum, project recommendations,
      daily discovery, and rollback in plain language.
- [x] `P18-15 [TERRA]` Bind material README claims to checked repository evidence,
      add generated facts and adapter lifecycle coverage, test the documented product
      flow, and separate deterministic, live, and human evidence.
- [x] `P18-16 [TERRA]` Make risky setup previews include every required approval
      flag, reject unknown top-level commands, and make user-requested rollback fail
      closed when files changed after a mutation or when a legacy snapshot lacks
      post-mutation evidence. Internal failed-transaction recovery remains
      authoritative.
- [x] `P18-19 [SOL+TERRA]` Re-audit the final unmerged development branch before deletion and preserve its
      one valuable adoption-safety intent in the current architecture. Adoption now
      binds the complete safe tree, rejects drift and special entries, records only
      final verified bytes, conservatively attributes catalog review, deep-freezes
      previews, and accepts only the exact same-process planner-issued plan
      (`186daa0`, `09e0e0c`, `3f2cafe`, `10d6109`). No valuable work remains on the
      retired branch; its local and remote copies were deleted after synchronization while
      the user's ignored `.superpowers/` directory was preserved.
- [x] `P18-20 [SOL+TERRA]` Fix the fresh-clone live Stable rollback regression
      without weakening drift protection. `5f8e38e` records installed-profile state
      inside the catalog transaction before post-mutation evidence and makes the live
      evidence journey roll Stable back before unrelated fixture transactions. An
      unsafe proposal to ignore `state.json` drift was rejected because it could
      orphan later installations.

All intended work through P18-20 is on remote `main`, and there are no open PRs. The
merged `codex/relatable-readme-hero` remote branch remains safe to delete after the
0.4.0 release checkpoint.

### Deterministic repository verification

- [x] `P18-08 [TERRA]` Run the complete clean-state verification gate after plan and
      documentation consolidation, including formatting, lint, type checking, build,
      evidence checks, unit and integration tests, CLI and README product flows,
      package smoke, performance, dashboard Playwright, package contents, and
      `git diff --check`. The July 20 integrated-main audit passed 113 test files with
      597 tests passing and one intentionally skipped, both product flows, package
      smoke, the 1,000-skill performance gate at 2.40 seconds p95, and both dashboard
      viewports.
      The additional live Stable gate installed four pinned packages and completed
      state and filesystem rollback assertions at `5f8e38e`.

### Branch cleanup status

- [x] Review all unique history on the final unmerged development branch before
      deletion; the adoption gap above was the only remaining valuable intent.
- [x] Reimplement and regression-test that intent in the current architecture.
- [x] Complete the second remote synchronization, confirm the four adoption commits
      are reachable from remote `main`, and delete the superseded development
      branches. The temporary worktree was removed and the unrelated ignored
      `.superpowers/` directory was preserved. The later merged README hero branch is
      retained only until the 0.4.0 release checkpoint.

### Human and external work (not provable by local tests)

- [ ] `P18-03 [HUMAN+TERRA]` Run the founder acceptance path in
      `docs/USER_TEST_GUIDE.md` on real Codex and Claude profiles. Record each
      observed failure and turn reproducible ones into regression tests.
- [ ] `P18-13 [HUMAN+TERRA]` Publish `loadout-ai@0.4.0` to npm, then test that exact
      registry tarball in a fresh terminal through Stable -> rollback -> Power ->
      rollback -> Maximum -> project optimization -> complete uninstall.
      Publication completed on July 20. A clean temporary install resolved the exact
      registry tarball, reported version `0.4.0`, and completed `loadout demo` with
      rollback verification. The founder's real Codex/Claude CLI lifecycle test
      remains required before this item can be checked; dashboard testing was removed
      after founder review rejected it as a conflicting product surface.
- [ ] `P18-17 [HUMAN]` Resolve the GitHub account billing or spending-limit condition
      that prevents Actions jobs from starting, rerun CI and daily discovery on the
      integrated commit, and record the result. CI runs
      [`29691581581`](https://github.com/VirajMishra1/loadout/actions/runs/29691581581)
      (`4fdc473`) and [`29692535521`](https://github.com/VirajMishra1/loadout/actions/runs/29692535521)
      (`e74ba16`) failed before any step ran; their annotations cite failed recent
      account payments or a spending limit that must be increased. They are external
      runner-account failures, not product-test failures.
- [ ] `P18-18 [HUMAN]` Decide and configure appropriate `main` branch protection.
      GitHub currently returns 404 for the protection endpoint, so protection is
      absent or not observable; do not describe it as enabled.

### Founder acceptance findings and 0.4.1 corrections

- [x] `P18-21A [HUMAN+TERRA]` Verify the published 0.4.0 Stable lifecycle on the
      founder's real Claude Code and Codex paths. Stable installed four pinned sources
      as 60 managed activations, preserved all 12 unmanaged Claude skills, reported no
      managed drift, and restored the explicit pre-install snapshot successfully.
- [x] `P18-21B [TERRA]` Make rollback history understandable. The first
      founder test exposed that bare `loadout rollback` selected a newer no-op
      dashboard/sync snapshot whose pre-state already contained Stable. No data was
      lost, but `rollback --list` showed opaque IDs only and `Restored snapshot` did
      not disclose that zero effective files changed. Rollback history now displays
      timestamp, mutation label, affected roots, effective entry count, latest marker,
      and explicit no-op guidance. New mutations carry user-facing labels. A CLI
      regression journey proves adjacent no-op and install snapshots plus explicit
      older-snapshot restoration.
- [x] `P18-22 [TERRA]` Remove the dashboard before the public release. Founder review
      confirmed that it presents recommendation presets (`stable`, `web`,
      `collaboration`, `maximum`) as policy profiles while the real CLI contract is
      `stable`, `power`, `maximum`, and `custom`; its manifest-sync mutation model is
      not the CLI setup workflow. Remove the command, loopback server, browser assets,
      dashboard-only dependencies/tests/docs/evidence, and npm package contents.
      The CLI retains all useful inspection, recommendation, configuration, health,
      rollback, and uninstall capabilities; there is no competing dashboard workflow.
- [ ] `P18-23 [HUMAN+TERRA]` Complete the remaining CLI-only founder path on the exact
      npm package. Power and its explicit rollback are complete: snapshot
      `1784546929191-9cfb0705dbed` restored zero Loadout-managed activations, retained
      all 12 unmanaged Claude skills, returned Codex to zero skills, and left no
      duplicate groups. Maximum setup is also complete: snapshot
      `1784547473319-7581eb19ee9c` stored 2,316 screened skill copies from 29 packages
      in the disabled library, activated none of them, and again preserved the 12
      unmanaged Claude skills. Remaining path: project activation -> recommendation/
      optimization -> Graphify install/remove -> credential-free MCP inventory ->
      read-only update/discovery -> complete uninstall -> reinstall. Record every
      mutation snapshot ID and use explicit rollback IDs during acceptance.
- [x] `P18-24 [SOL+TERRA]` Make Power match the intended product hierarchy based on
      the real founder run.
      The published transaction itself passed: eight immutable sources installed for
      Claude Code and Codex, 100 managed activations were created, 12 unmanaged Claude
      skills were preserved, duplicate targets were resolved, six rejected skill
      units were excluded, and 1,170 managed files reported zero drift. The profile
      policy failed acceptance: it activates 50 skills per agent despite Loadout's
      recommended limit of 30; every selected package retained blocking static-risk
      findings (79 total); only five of eight sources have an asserted SPDX license;
      and one coarse prompt approves all package findings. The founder clarified that
      Power is intentionally the larger active mode, not another 30-skill Stable.
      Stable remains bounded at 30; Power explicitly warns about its larger context
      footprint; Maximum stores the broadest screened library disabled and activates
      only project-relevant subsets. Invalid units remain quarantined and detailed
      findings stay available behind `--details`. Existing transaction and founder
      evidence proves unmanaged-skill preservation and exact rollback.
- [x] `P18-25 [LUNA+TERRA]` Make health output honest and focused for empty or unmanaged
      profiles. After the successful Power rollback, `loadout health --explain` led
      with `Loadout health: healthy` and then reported 28/100 critical evidence for
      Claude Code, 0/100 unknown for Codex, and similarly verbose sections for every
      detected agent. Empty managed state now reports `not configured`, the default
      remains concise, and `--explain --agents <ids>` keeps deeper evidence scoped.
      Health also understands managed Codex TOML MCP entries instead of falsely
      reporting JSON drift.
- [x] `P18-26 [LUNA+TERRA]` Make Maximum's preview understandable without weakening
      its safe defaults. The founder run proved the disabled-library contract, but
      printed 50 unit-level quarantine blocks, 19 expected MCP/runtime deferrals, two
      `No SKILL.md` preparation failures, and one coarse 28-package risk approval in
      the default path. The subsequent scan reported 11 repository failures without
      naming them. Default to a concise grouped summary with exact counts, severity,
      source, and next commands; retain complete findings behind an explicit details
      or JSON view. MCP/runtime-only records are explicit deferred setup rather than
      failed skill preparation; actual repository preparation failures remain named
      with their reason. The default preview groups quarantine and deferral counts,
      while `--details` shows every unit. Regression tests cover both views.
- [x] `P18-27 [SOL+TERRA, LUNA copy review]` Correct project-aware activation safety
      and relevance using
      `docs/superpowers/specs/2026-07-20-project-activation-safety-design.md`.
      Founder preview proved that activation currently ignores 12 unmanaged Claude
      skills when calculating `--limit 30`, treats rollback-restored empty directories
      as occupied for both agents, and proposes a generic, redundant 30-skill set from
      only JavaScript/TypeScript and Playwright signals. Implement the approved shared
      empty-target predicate, per-agent total active capacity, bounded Node CLI/npm/
      Vitest/MCP project signals, diverse evidence-threshold selection, integration-
      type labels, atomic apply revalidation, and the specified regression suite.
      Implementation is complete on `codex/project-activation-safety`: the full local
      release gate passes, including 114 unit-test files with 605 passing tests and
      one intentional skip; the disposable two-agent CLI journey proves 12 unmanaged
      Claude skills, distinct Claude/Codex budgets, empty rollback residue, one atomic
      apply, and explicit rollback; the packed artifact is 468.0 kB with 145 files;
      and the fresh scan benchmark passed at 1,583.5 ms p95 across seven real CLI
      runs. Do
      not resume real-profile activation until this branch is reviewed, integrated,
      versioned, and published as the corrected release.
- [x] `P18-28 [HUMAN+TERRA]` Merge the project-activation corrections through PR #4
      and publish the exact verified release as `loadout-ai@0.4.1`. Registry
      verification returned version `0.4.1` and integrity
      `sha512-k8WTNh6kTIaaBFTPGsl/QD/7/LQ1Gg9uMReM87gAkBPdcG0IxanM9NznyjemsYa124yYPczAY5MVYan4i91MtA==`;
      a clean temporary global install reported `0.4.1` and detected TypeScript,
      Playwright, Node CLI, npm package, release, MCP, security, Commander, Zod, and
      Vitest signals from this repository. Tag `v0.4.1` points to release commit
      `0d25b8e`. This is the corrected founder-testing release, not the final public
      launch candidate: dashboard removal, Power policy, health output, and Maximum
      preview work remain open.
- [x] `P18-29 [SOL+TERRA]` Block ecosystem-mismatched project activation candidates
      before scoring. The exact published `0.4.1` founder preview correctly detected
      this TypeScript Node CLI, respected both agents' real capacity, and produced no
      false occupied-target blockers, but still proposed `mcp-csharp-publish`,
      `mcp-csharp-test`, `uv-package-manager`, `social-publishing`, and
      `vercel-cli-with-tokens`, then exposed `msstore-cli`, `phoenix-cli`, and
      `publish-to-pages` once those higher-ranked mismatches were removed. A second
      preview exposed the general cause: any domain-specific name ending in `-cli`,
      including `datadog-cli`, inherited the full Node CLI and Commander score; a
      third exposed substring matching of `npm` inside `pnpm`, plus backend and web
      design guidance without corresponding project roles; a fourth caught generic
      `schema` admitting database design for Zod and universal accessibility guidance
      in a CLI project. Add deterministic language/provider/specialization
      compatibility gates, bounded generic CLI and schema evidence, token-aware
      package-manager matching, and role-gated backend/frontend guidance. Generic
      `mcp`, `cli`, `package`, and `publish` words must not override compatibility;
      preserve explicit pins as a deliberate escape hatch; prove the exact regression
      with tests and repeat the read-only founder preview before any real activation.
      Complete on `codex/activation-compatibility-gates`: the exact live Maximum
      library preview now proposes 24 relevant Codex skills and 18 capacity-bounded
      Claude Code skills with zero occupied-target blockers and none of the observed
      ecosystem mismatches. The full release gate passes with 114 test files, 607
      passing tests, one intentional skip, both CLI product journeys, packaged CLI
      smoke, evidence checks, and a 1,518.4 ms p95 scan benchmark across seven real
      runs. The preview remained read-only; publish the merged correction before the
      founder applies it to real agent profiles.

### Product-first release candidate work

- [x] `P18-30 [TERRA]` Add `kepano/obsidian-skills` at an immutable MIT-licensed
      revision as the 51st credited catalog source. Detect `.obsidian` vaults and
      recommend/activate the five Obsidian-oriented skills only for relevant projects;
      do not burden universal Stable with a niche tool.
- [x] `P18-31 [TERRA]` Make reviewed MCP recipes usable from the normal CLI for both
      Codex and Claude Code. `mcp-recipe --agent <host>` now chooses the real host
      config path and format, previews before writing, stores managed fingerprints,
      verifies presence, reports drift in health, and removes only Loadout's entry.
      Config plus ownership state commit in one rollback transaction, so rollback
      cannot leave a stale managed MCP record. Disposable end-to-end tests cover
      preview, apply, verify, health, rollback, reapply, and removal.
- [x] `P18-32 [TERRA]` Present evidence maturity without the misleading exclusive
      `0 discovered` headline. The README now reports 51 sourced/inspected records,
      four Stable sources, and the dated discovery feed separately. It clearly says
      independent human-review and comparative benchmark publications are future
      promotion stages rather than implying the catalog is unusable.
- [ ] `P18-33 [HUMAN+TERRA]` Publish the next verified CLI-only release and run the
      founder path from that exact npm tarball: Stable, Power, Maximum/project
      activation, Obsidian recommendation, Graphify, both-host credential-free MCP,
      read-only update/discovery, rollback history, uninstall, and clean reinstall.
- [ ] `P18-34 [HUMAN]` Resolve or bypass exhausted GitHub-hosted Actions minutes by
      running the documented complete gate locally now; later restore hosted CI with
      billing/minutes, a self-hosted runner, or a teammate-owned fork. Never label an
      unstarted hosted job as a code failure.
- [x] `P18-35 [TERRA]` Run the complete CLI-only release gate locally after all
      product-first changes against the exact `0.5.0` package. On July 21 it passed formatting, lint, type checking,
      catalog/discovery/README/release evidence, 113 test files with 603 passing and
      one intentional skip, both CLI product journeys, packed npm smoke, and seven
      real 1,000-skill scans at 1,468.2 ms p95.
- [x] `P18-36 [TERRA]` Close the stale-build packaging gap caught by the first npm
      publish attempt. Every build now removes `dist` first on every platform, and the
      package smoke test rejects removed dashboard/demo JavaScript if it ever leaks
      back into the tarball. The failed OTP-gated attempt published nothing.
- [x] `P18-37 [TERRA]` Fix the founder-discovered disabled-library uninstall bug.
      Removal now resolves each managed file to its disabled Maximum-library copy,
      never an unmanaged skill that later occupies the original active path. A
      regression test preserves the replacement bytes, the real founder state now
      previews an unblocked removal of 29 packages/2,316 disabled records, and health
      reports `library ready (nothing active)` with explicit counts. Release as
      `0.5.1` before continuing the complete-uninstall acceptance step.

### Release 0.3 lifecycle hardening

- [x] `P18-09 [SOL+TERRA]` Add preview-first complete uninstall with modified-file
      protection, native-job cleanup, runtime restoration, guarded state deletion,
      and optional global npm removal.
- [x] `P18-10 [TERRA]` Persist the installed profile and make `loadout update`
      evaluate both profile drift and every managed repository.
- [x] `P18-11 [SOL+TERRA]` Add explicit bulk safe updates while holding disabled,
      risky, and failed packages for review; scheduled checks remain read-only.
- [x] `P18-12 [TERRA]` Add a pinned Chrome DevTools MCP recipe and distinguish
      separately billed AI/model API keys from unrelated service credentials. The
      no-model-key inventory includes GitHub read-only with its token disclosed.
- [x] `P18-14 [TERRA]` Treat recursively empty directories from legacy cleanup as
      unoccupied without weakening unmanaged-file protection, and make complete
      uninstall remove empty nested directory shells.

### Explicitly deferred (do not expand during this usability pass)

- Hosted accounts, GitHub OAuth, cloud sync, analytics, and enterprise policy.
- Required API keys, automatic provider spending, or treating chat subscriptions as
  API access.
- Automatically installing newly discovered repositories or executing arbitrary
  third-party installers.
- A universal quality score, social-network scraping, or support claims for an agent
  that has not passed a real adapter test.

## Archived implementation history

Sections 1–20 below preserve the original product design, allocation, completed work,
and deferred exploration. They are historical context. Only the current-status section
above defines active work.

## 1. Executive summary

Loadout is a universal extension manager for AI coding agents. It detects the agents
installed on a user's computer, discovers trusted skills and MCP tools from official
catalogs and high-signal GitHub repositories, installs them in the correct format,
keeps configurations synchronized, checks for updates, and restores a known-good
snapshot if an update fails.

The product is intentionally consumer-first and CLI-first. A user should not need to
understand `SKILL.md`, MCP configuration, plugin manifests, platform-specific
directories, or GitHub repository layouts. Interactive setup starts with one command:

```bash
npx loadout-ai
```

```text
Choose a loadout: [1] Stable Boost (recommended), [2] Maximum Library, [3] Custom
```

The executable installed by the package is still named `loadout`. The `loadout` npm
package name belongs to an unrelated project, so the publishable package is
`loadout-ai`.

The hackathon MVP proves the safe package lifecycle with a curated catalog. The
product-defining loop is broader: scan what the user already has -> discover and
review candidates -> compare evidence -> recommend a small active set -> install or
activate -> verify -> update -> block an unsafe or incompatible update -> rollback.

## 2. Product thesis

Developers increasingly use multiple AI coding agents, but the ecosystem of skills,
plugins, agents, rules, and MCP tools is fragmented across GitHub, official
marketplaces, social media, and independent registries. Existing package managers
focus on files and packages. Loadout focuses on the outcome a user wants: make every
installed agent more capable without requiring manual discovery or configuration.

Loadout wins through:

1. A one-command consumer experience.
2. Broad agent and operating-system support.
3. A maintained Stable and Trending catalog.
4. A large reviewed library plus a small conflict-aware active set instead of blindly
   exposing every downloaded package to every agent.
5. Human-readable update and permission diffs.
6. Snapshots and rollback.
7. Optional project-aware recommendations without requiring GitHub access.

## 3. Product and delivery scope

### 3.1 Submission-critical vertical slice

- TypeScript CLI packaged for `npx loadout-ai` after an owner publishes it to npm.
- CLI-first interactive and non-interactive Stable/Maximum/Custom setup.
- CLI-only primary experience. The existing framework-free loopback dashboard is a
  secondary diagnostic surface and is not required for onboarding or daily use.
- Windows 11, macOS, and Linux support.
- Agent detection for:
  - Claude Code
  - Codex
  - Cursor
  - Gemini CLI
  - OpenCode
  - Hermes
  - Windsurf
  - Cline
  - GitHub Copilot
  - Roo Code
  - Kiro CLI
  - Junie
- Skill installation for all twelve agents where their documented layout is known.
- MCP configuration for Claude Code, Codex, and Cursor.
- Curated catalog containing 50 pinned real repositories.
- Stable, Trending, Official, and Community tier support; the current bundled review
  set contains Official and Stable records.
- Stable Boost, Maximum Boost, and Custom modes.
- Immutable package records pinned by Git commit SHA.
- Snapshot before the first mutation.
- Update detection and human-readable diff.
- Block at least one incompatible or risky update in the demo.
- One-command rollback.
- No GitHub login required for the core experience.
- Optional local-folder scan for project-aware recommendations.
- Clear display of `native`, `adapted`, and `unsupported` components.

### 3.2 Deferred product exploration (not current launch scope)

These are ideas worth revisiting after the core CLI has passed real founder and
external user testing. They are not commitments for this hackathon release and must
not be presented as production-ready simply because a prototype or command exists.

- GitHub OAuth for private repositories and personalized discovery, using minimal
  read-only scopes by default.
- Community Loadout publishing, sharing, importing, versioning, and reporting.
- Historical star, fork, contributor, release, and download velocity charts.
- Model/provider configuration and comparison, including OpenRouter.
- Automated category-specific evaluations with repeatable fixtures and confidence
  information.
- Background catalog and update notifications.
- Signed catalog snapshots and signature verification in the client.
- Best-effort compilation of hooks, commands, agents, and subagents between platforms,
  with explicit loss reports instead of false compatibility claims.
- Sandboxed execution for third-party installers that genuinely require execution,
  with no host credentials and no automatic promotion from the sandbox.
- A user-controlled encrypted credential vault backed by the operating-system keychain;
  the service must not store plaintext user secrets.
- Policy-gated autonomous updates for MCP servers, hooks, and executables after
  sandbox tests, permission comparison, and rollback preparation.
- An adapter SDK and community adapter registry for broad agent support.
- Category-specific capability scoring and comparison; never one misleading universal
  number claiming scientific certainty across unrelated tasks.
- Discovery connectors for major social and community sources where their APIs and
  terms permit access.
- Team and enterprise policy administration, including allowlists, denylists, required
  versions, audit history, and shared Loadouts.

### 3.3 Non-negotiable safety boundaries

The ambitious scope does not authorize unsafe shortcuts:

- Never execute untrusted installation scripts directly on the host during discovery.
- Never store plaintext secrets in the repository, catalog, logs, analytics, or hosted
  database.
- Never claim perfect conversion when platform semantics differ; show a loss report.
- Never silently grant new filesystem, network, account, hook, or executable powers.
- Never market a category score as universal scientific truth.
- Never scrape a source in violation of its API rules, robots policy, or terms.
- Never claim support for an agent until its adapter passes the published conformance
  suite.

## 4. Primary users

### 4.1 Multifunctional power user

Uses Claude, Codex, Cursor, or other agents for many kinds of work and wants the
largest useful capability set without manually visiting repositories.

Default path: audit the existing setup, retain a broad reviewed library, and activate
only the best evidence-backed global and project-specific subset. Maximum Library is
explicit stress/power-user mode, not the default active set.

### 4.2 New agent user

Has installed one or more agents but does not understand extension formats or MCP.

Default path: Stable Boost.

### 4.3 Project-focused developer

Wants recommendations for a particular local repository.

Default path: Stable or Maximum Boost plus optional local-folder analysis.

### 4.4 Team

Wants a reproducible configuration shared through source control.

Post-MVP path: commit `loadout.lock` and restore it on another machine.

## 5. User experience

### 5.1 First run

1. User runs `npx loadout-ai` after publication, or `npx .` from a clone.
2. Loadout detects supported installed agents and read-only scans their existing
   skills, separating Loadout-managed content from unmanaged content without assuming
   unmanaged means unsafe.
3. It recommends Stable, Maximum Library, Custom, or an evidence-backed optimization
   of the existing setup. It filters out components that require explicit
   credentials/configuration, then
   concurrently fetches only reviewed skill repositories at their pinned commits.
4. It resolves overlapping skill targets deterministically, keeps the higher-ranked
   reviewed source, and reports every deferred duplicate.
5. It shows repository counts, actual skill-directory counts, safety findings,
   deferred MCP/executable packages, and detected targets before mutation.
6. The user confirms the loadout and separately approves script/domain/instruction
   findings when present.
7. Loadout snapshots all targets and installs the entire loadout as one durable,
   rollback-safe transaction; caught or interrupted failures restore prior state.
8. Daily use continues through `scan`, `status`, fast local `health`, `update`,
   `discover`, `recommend`, `compare`, `optimize`, `remove`, and `rollback`. Commands
   not yet implemented remain Phase 12 backlog items. The dashboard remains optional.

Account capability rule: interactive setup asks whether the user has separately billed
OpenAI API, Anthropic API, OpenRouter, other provider access, or none. ChatGPT and
Claude subscriptions do not count. The answer contains provider names only, is not a
credential, is not persisted by setup, and cannot weaken safety policy. Static skills
remain available without model API access; credentialed MCP/runtime/model operations
remain explicit and fail closed until a named environment or OS-keychain reference is
appropriate for that execution boundary.

### 5.2 Normal use

- `loadout status`: agents, packages, conflicts, and update health.
- `loadout scan`: read-only inventory of existing skills, ownership, fingerprints,
  duplicates, and capacity warnings.
- `loadout setup --mode stable`: preview the small reviewed daily-use foundation.
- `loadout setup --mode maximum`: preview the broad reviewed loadout.
- `loadout setup --mode maximum --yes --approve-risk`: install it non-interactively
  after review.
- `loadout add <package>`: plan and add a package.
- `loadout remove <package>`: remove only files managed by Loadout.
- `loadout update`: fetch package update information and display a read-only plan by
  default.
- `loadout rollback`: restore the previous snapshot.
- `loadout doctor`: validate configurations and dependencies.
- `loadout dashboard`: optional secondary diagnostic surface; never required by the
  CLI-first journey.

### 5.3 No-account guarantee

The following must work without signup or GitHub OAuth:

- Agent detection
- Catalog browsing
- Stable and Maximum Boost
- Public package installation
- Updates
- Local snapshots
- Rollback

GitHub access is optional and used only for private repositories, GitHub operations,
or personalized project discovery.

## 6. Catalog policy

### 6.1 Admission tiers

#### Official

Accepted without a star minimum when publisher identity is verifiable and the source
is an official vendor or standards organization.

#### Stable

Default discovery has no star floor. Stable normally requires:

- At least 1,000 GitHub stars, or a documented exception based on verified publisher,
  package adoption, maintainer reputation, or independent evaluation.
- Clear installable component.
- Non-archived repository.
- Recent meaningful maintenance.
- License metadata present or explicitly reviewed.
- Supported source can be pinned to an immutable commit.
- Basic security and compatibility checks pass.

Packages above 5,000 stars receive a `Popular` signal, not automatic trust or an
exclusive right to enter the catalog.

#### Trending

- Normally at least 100 stars, or an explicitly approved exception for an official or
  independently verified release.
- Strong recent star velocity or adoption signal.
- Active maintenance.
- Basic safety and compatibility checks pass.
- Never enabled silently in Stable mode.

#### Community

- Any star count, including zero-star newly published packages.
- Searchable or manually installable.
- Requires explicit user selection.

### 6.2 Discovery sources

MVP:

- Curated seed list in the repository.
- GitHub Search API for known filenames and topics.
- OpenAI skills catalog.
- Anthropic official plugin marketplace.
- Official MCP Registry.
- skills.sh metadata where permitted.

Full-product ingestion:

- GitHub star snapshots and acceleration.
- GitHub release feeds.
- npm and PyPI download/release signals.
- Hacker News API.
- Reddit and other community sources where API terms permit.

### 6.3 Search signatures

- `SKILL.md`
- `.claude-plugin/plugin.json`
- `.codex-plugin/plugin.json`
- `.mcp.json`
- `mcp.json`
- `topic:agent-skills`
- `topic:claude-code`
- `topic:codex`
- `topic:mcp-server`

### 6.4 Ranking

Do not compare packages from unrelated categories. Rank within a capability category.

Initial score:

- 30% community adoption: logarithmic stars, forks, contributors.
- 20% momentum: recent growth and releases.
- 20% maintenance: meaningful recency, responsiveness, multiple maintainers.
- 15% compatibility: agents, operating systems, clean install result.
- 15% trust: official identity, license, pinned dependencies, absence of risky patterns.

The score is a recommendation aid, not a claim of objective superiority.

## 7. Default catalog categories

- Engineering workflow
- Documentation retrieval
- Codebase intelligence
- Browser automation and verification
- Frontend design
- Context and token optimization
- Memory
- Source-control integrations
- Security
- Research
- Data and documents
- Product and marketing

The initial catalog should include representative packages discussed during product
research, such as Superpowers, ECC, Karpathy-inspired guidance, Context7, Graphify,
Serena, Playwright MCP, Chrome DevTools MCP, UI UX Pro Max, Taste Skill, RTK, GitHub
MCP, Planning with Files, and official OpenAI and Anthropic catalogs. Exact inclusion
requires license and install-shape verification.

## 8. Conflict policy

Loadout may download or register many packages but should not activate overlapping
packages blindly.

Initial conflict families:

- Major workflow harnesses: Superpowers, ECC, GSD, Compound Engineering.
- Codebase intelligence: Graphify, Serena, Understand Anything, Codebase Memory.
- Browser control: Playwright MCP, Chrome DevTools MCP, Browser MCP.
- Frontend guidance: UI UX Pro Max, Taste Skill, Hallmark.
- Persistent memory: Claude Mem, Beads, Agent Memory, Engram.
- Output compression: RTK, Headroom, Context Mode, Caveman.

Rules:

1. Stable Boost selects at most one primary package in each conflicting family.
2. Maximum Boost may download all approved candidates but activates one default.
3. Custom mode may override a soft conflict after a warning.
4. Hard conflicts block confirmation until one candidate is removed.
5. Conflict explanations must use plain language.

## 9. Technical architecture

### 9.1 Implemented repository layout

```text
loadout/
├── src/
│   ├── cli.ts               # Commands and packaged executable
│   ├── dashboard.ts         # Loopback HTTP server and authenticated API
│   ├── core/                # Catalog, adapters, transactions, policy, registry
│   └── shared/              # Types and runtime schemas
├── dashboard/               # Dependency-free HTML, CSS, and JavaScript UI
├── catalog/
│   └── packages.json        # Reviewed catalog with immutable source evidence
├── docs/                    # Security, compatibility, and operating policies
├── tests/                   # Unit, integration, fixtures, and Playwright E2E
├── README.md
├── MASTER_PLAN.md
└── package.json
```

The flat package is deliberate for the hackathon: it avoids workspace build and
publishing complexity while keeping modules separated by responsibility.

### 9.2 Implemented stack

- Node.js 20+
- TypeScript
- npm with a committed lockfile
- Commander for CLI
- Browser-native HTML, CSS, and JavaScript for the dashboard
- Zod for runtime schemas
- Vitest for unit/integration tests
- Playwright for dashboard end-to-end tests
- Conservative append-only Codex TOML support and unrelated-key-preserving JSON writes
- GitHub Actions on Windows, macOS, and Linux

### 9.3 Local state

```text
~/.loadout/
├── cache/<package>/<commit>/
├── snapshots/<timestamp>/
├── staging/<transaction-id>/
├── catalog.json
├── state.json
└── logs/
```

Never store secret values in state, logs, snapshots, or telemetry.

## 10. Core data models

### 10.1 Catalog package

```ts
type CatalogPackage = {
  id: string;
  displayName: string;
  source: { type: "github"; repo: string; ref: string };
  tier: "official" | "stable" | "trending" | "community";
  category: string;
  description: string;
  license?: string;
  stars?: number;
  components: Component[];
  platforms: Record<PlatformId, "native" | "adapted" | "unsupported">;
  operatingSystems: Array<"windows" | "macos" | "linux">;
  permissions: PermissionSummary;
  conflicts: string[];
};
```

### 10.2 Installed package

```ts
type InstalledPackage = {
  id: string;
  source: string;
  commit: string;
  files: Array<{ path: string; sha256: string }>;
  installedAt: string;
  platforms: PlatformId[];
  snapshotId: string;
};
```

### 10.3 Mutation plan

```ts
type MutationPlan = {
  id: string;
  creates: PlannedFile[];
  updates: PlannedFile[];
  deletes: PlannedFile[];
  configChanges: ConfigChange[];
  warnings: PlanWarning[];
  requiresRestart: PlatformId[];
};
```

## 11. Adapter contract

Each adapter must implement:

```ts
interface AgentAdapter {
  id: PlatformId;
  detect(): Promise<DetectionResult>;
  inspect(): Promise<InstalledComponent[]>;
  planInstall(pkg: NormalizedPackage): Promise<AdapterPlan>;
  planRemove(pkg: InstalledPackage): Promise<AdapterPlan>;
  validate(plan: AdapterPlan): Promise<ValidationResult>;
  smokeTest(): Promise<SmokeTestResult>;
}
```

Adapters must never directly write during `planInstall`. The core transaction engine
owns all mutations.

## 12. Installation transaction

1. Resolve package to an immutable commit.
2. Download without executing repository scripts.
3. Reject paths escaping the package root.
4. Parse and normalize supported components.
5. Ask adapters for mutation plans.
6. Merge plans and detect collisions.
7. Display preview.
8. Snapshot every target file that exists.
9. Write new files to staging.
10. Validate staged files and configuration.
11. Commit changes.
12. Run smoke tests.
13. On failure, automatically restore snapshot.
14. On success, update lockfile and state.

## 13. Update and rollback

### 13.1 Update

1. Fetch catalog update.
2. Resolve installed package source.
3. Compare pinned commit with candidate commit.
4. Download candidate to cache.
5. Produce file, instruction, command, domain, and permission diff.
6. Run static checks.
7. Plan install as a replacement transaction.
8. Require approval for scripts, hooks, MCP changes, executables, new domains, or new
   environment-variable requirements.
9. Apply transaction.
10. Run smoke tests.
11. Restore automatically if verification fails.

### 13.2 Rollback acceptance criterion

After `loadout rollback`, every file touched by the last transaction must equal its
pre-transaction bytes. Files not managed by Loadout must remain untouched.

## 14. Security baseline

Reject or flag:

- Absolute paths or `../` traversal escaping package root.
- Symlinks escaping package root.
- Embedded secrets.
- Obfuscated executable payloads.
- `curl | bash` and equivalent remote bootstrap execution.
- Package-manager lifecycle scripts during discovery/install.
- Newly introduced hooks, binaries, domains, environment-variable reads, or broad
  filesystem permissions.
- Unpinned remote dependencies where pinning is expected.

Rules:

- Never execute third-party code during catalog ingestion.
- Never log secret values.
- Never auto-approve new permissions.
- Pin installed packages to commits and store per-file hashes.
- Keep at least the previous known-good snapshot.
- Treat star count as popularity, not proof of safety.

## 15. Dashboard requirements

### 15.1 Home

- Detected agents.
- Operating system.
- Stable/Maximum/Custom call to action.
- Installed package count.
- Updates and conflicts.
- Last known-good snapshot.

### 15.2 Discover

- Outcome-first categories.
- Stable, Trending, Official badges.
- Stars, publisher, platforms, permissions.
- Add/Remove action.
- Technical details drawer.

### 15.3 Installed

- Package list.
- Active platforms.
- Native/adapted/unsupported labels.
- Exact pinned commit.
- Remove and inspect actions.

### 15.4 Updates

- Old and candidate versions.
- Plain-language summary.
- File/config/permission diff.
- Update, ignore, or rollback.

### 15.5 Design constraints

- Local-only application for MVP.
- No signup wall.
- First meaningful screen in under five seconds after server launch.
- Keyboard accessible.
- Responsive down to tablet width.
- Never expose secret values in UI.

## 16. Work allocation

### Track A: Catalog and discovery — Member 1

Owns catalog schema, initial package records, GitHub metadata retrieval, tiers,
scoring, conflict families, and static source checks.

### Track B: Core and adapters — Member 2

Owns CLI, detection, transaction engine, snapshots, lockfile, updates, rollback, and
agent adapters.

### Track C: Dashboard and submission — Member 3

Owns dashboard, onboarding, API contract integration, visual polish, demo fixtures,
README/setup instructions, video, and Devpost content.

Shared decisions require a short decision record in the PR or `docs/decisions/`.

## 17. Model delegation guide

Task labels:

- `[LUNA]`: bounded, mechanical, clear expected output, low architectural judgment.
- `[TERRA]`: normal feature implementation with defined interfaces and tests.
- `[SOL]`: architecture, security, ambiguous integration, conflict resolution, or
  cross-cutting review.
- `[HUMAN]`: product choice, external permission, legal/licensing judgment, final
  acceptance, or credential handling.

Luna tasks must include exact files, inputs, expected output, and acceptance checks.
Terra tasks must include an interface or behavior contract and test expectations.
Sol tasks should produce a decision or implementation plus tradeoffs and failure
modes.

## 18. Detailed backlog

### Phase 0: Repository and team setup

- [x] `P0-01 [LUNA]` Add the npm/TypeScript project skeleton matching section 9.1.
  - Acceptance: `npm ci`, build, lint, typecheck, and tests succeed from the root.
- [x] `P0-02 [LUNA]` Add `.gitignore`, `.editorconfig`, Prettier, and ESLint defaults.
  - Acceptance: formatting and lint commands run at repository root.
- [x] `P0-03 [TERRA]` Add GitHub Actions matrix for Node on Windows, macOS, Linux.
  - Acceptance: install, lint, typecheck, and tests run on all three.
- [x] `P0-04 [HUMAN]` Add all three teammates to the private repository.
  - Verified collaborators: `VirajMishra1`, `cars3`, and `reddynitish`.
- [ ] `P0-05 [HUMAN]` Protect `main` after the first working CI run.
  - Blocked by GitHub's branch-protection restriction for this private repository on
    the current plan (API returned HTTP 403). Revisit after making the repository
    public or enabling a plan that supports protection.

### Phase 1: Shared types and catalog

- [x] `P1-01 [SOL]` Finalize catalog, installed-state, plan, and lockfile schemas.
  - Acceptance: schema decision documented; no secret-value fields exist.
- [x] `P1-02 [TERRA]` Implement Zod schemas and inferred TypeScript types.
  - Acceptance: valid fixtures parse; invalid fixtures fail with actionable errors.
- [x] `P1-03 [LUNA]` Create valid/invalid catalog fixtures.
  - Acceptance: at least five valid and ten invalid cases.
- [x] `P1-04 [TERRA]` Implement seed catalog loader.
  - Acceptance: loads bundled catalog offline and returns categories/packages.
- [x] `P1-05 [LUNA]` Add first ten verified catalog records.
  - Acceptance: source, category, tier, license, commit/ref, components, platforms.
- [x] `P1-06 [LUNA]` Add next ten verified catalog records.
- [x] `P1-07 [TERRA]` Implement GitHub metadata fetch with cache and rate-limit errors.
- [x] `P1-08 [TERRA]` Implement tier and ranking functions.
- [x] `P1-09 [SOL]` Review scoring for obvious gaming and bias failure modes.
- [x] `P1-10 [TERRA]` Implement conflict-family resolver.
  - Acceptance: Stable picks one default; hard conflicts block; Custom can override
    soft conflicts.
- [x] `P1-11 [TERRA]` Expand from 20 to at least 50 fully reviewed catalog records.
  - Every record needs immutable commit, license review, component evidence, platform
    evidence, and an install/config path; popularity alone is insufficient.
  - Fifty evidence-complete records now pin immutable commits. All new skill-bearing
    repositories passed real Loadout discovery/frontmatter inspection; unsafe symlinked
    collections were rejected rather than weakened into the catalog.

### Phase 2: Agent detection

- [x] `P2-01 [SOL]` Finalize adapter contract and platform capability matrix.
- [x] `P2-02 [TERRA]` Implement shared filesystem/path utilities.
  - Acceptance: tests cover Windows paths, POSIX paths, WSL distinction, home dirs.
- [x] `P2-03 [LUNA]` Add fake home-directory fixtures for all platforms.
- [x] `P2-04 [TERRA]` Implement Claude Code detection and inspection.
- [x] `P2-05 [TERRA]` Implement Codex detection and inspection.
- [x] `P2-06 [TERRA]` Implement Cursor detection and inspection.
- [x] `P2-07 [LUNA]` Implement Gemini CLI detection from approved path table.
- [x] `P2-08 [LUNA]` Implement OpenCode detection from approved path table.
- [x] `P2-09 [LUNA]` Implement Hermes detection from approved path table.
- [x] `P2-10 [TERRA]` Build `loadout doctor` detection report.

### Phase 3: Package parsing and normalization

- [x] `P3-01 [SOL]` Define normalized package/component representation.
- [x] `P3-02 [TERRA]` Implement `SKILL.md` parser and validation.
- [x] `P3-03 [TERRA]` Implement Claude plugin manifest parser.
- [x] `P3-04 [TERRA]` Implement Codex plugin manifest parser.
- [x] `P3-05 [TERRA]` Implement MCP JSON parser.
- [x] `P3-06 [LUNA]` Add parser fixtures from sanitized real layouts.
- [x] `P3-07 [TERRA]` Map parsed skills to universal component records.
- [x] `P3-08 [SOL]` Define native/adapted/unsupported rules for MVP platforms.
- [x] `P3-09 [TERRA]` Generate compatibility summary from normalized package.

### Phase 4: Transaction engine

- [x] `P4-01 [SOL]` Threat-model the mutation transaction.
- [x] `P4-02 [TERRA]` Implement immutable package cache by commit.
- [x] `P4-03 [TERRA]` Implement per-file SHA-256 calculation.
- [x] `P4-04 [TERRA]` Implement snapshot creator and manifest.
- [x] `P4-05 [TERRA]` Implement staging directory and planned writes.
- [x] `P4-06 [TERRA]` Implement path traversal and escaping-symlink rejection.
- [x] `P4-07 [TERRA]` Implement plan collision detection.
- [x] `P4-08 [SOL]` Review atomic commit behavior across all three operating systems.
  - Accepted for the supported local-filesystem scope after CI run `29401149042` exercised the atomic and transaction suites on Node 20/22 for Windows, macOS, and Linux. See `docs/RELEASE_REVIEW.md` for the explicit power-loss boundary.
- [x] `P4-09 [TERRA]` Implement commit with automatic restore on failure.
- [x] `P4-10 [TERRA]` Implement `loadout rollback`.
- [x] `P4-11 [LUNA]` Add interrupted-write and corrupted-stage fixtures.
- [x] `P4-12 [TERRA]` Verify rollback restores byte-identical files.

### Phase 5: Agent adapters

- [x] `P5-01 [TERRA]` Claude skill install/remove planner.
- [x] `P5-02 [TERRA]` Codex skill install/remove planner.
- [x] `P5-03 [TERRA]` Cursor skill install/remove planner.
- [x] `P5-04 [LUNA]` Gemini skill planner using approved layout.
- [x] `P5-05 [LUNA]` OpenCode skill planner using approved layout.
- [x] `P5-06 [LUNA]` Hermes skill planner using approved layout.
- [x] `P5-07 [SOL]` Review adapters for lossy or false compatibility claims.
- [x] `P5-08 [TERRA]` Claude MCP config planner preserving unrelated entries.
- [x] `P5-09 [TERRA]` Codex MCP config planner preserving unrelated entries/comments.
  - Implementation appends only new official TOML tables; replacement of an existing table remains intentionally unsupported until a comment-preserving TOML editor is added.
- [x] `P5-10 [TERRA]` Cursor MCP config planner preserving unrelated entries.
- [x] `P5-11 [TERRA]` Smoke-test interface and results.
  - The native-skill adapter smoke suite plans, installs, and removes a real `SKILL.md` fixture for each declared filesystem layout. It does not claim plugin, hook, MCP, or executable runtime support beyond the capability matrix.

### Phase 6: CLI

- [x] `P6-01 [TERRA]` CLI bootstrap, version, help, structured error handling.
- [x] `P6-02 [TERRA]` `loadout status`.
- [x] `P6-03 [TERRA]` `loadout doctor`.
- [x] `P6-04 [TERRA]` `loadout plan --mode stable|maximum|custom`.
- [x] `P6-05 [TERRA]` Confirmed `loadout install --yes` and `loadout sync --yes`
      mutation paths.
- [x] `P6-06 [TERRA]` `loadout add` and `loadout remove`.
- [x] `P6-07 [TERRA]` Read-only `loadout update` planning by default.
- [x] `P6-08 [TERRA]` `loadout rollback`.
- [x] `P6-09 [LUNA]` CLI snapshot tests for help and error messages.
- [x] `P6-10 [SOL]` Review destructive command confirmation and recovery behavior.
- [x] `P6-11 [TERRA]` Make interactive CLI setup the primary product path.
  - Maximum/Stable/Custom detect targets, concurrently prepare pinned reviewed
    commits, defer explicit MCP setup, resolve lower-ranked duplicate skill targets,
    show safety findings, and install as one transaction.

### Phase 7: Local API and dashboard

- [x] `P7-01 [SOL]` Define local API contract and threat boundary.
- [x] `P7-02 [TERRA]` Start local server on random loopback port with session token.
- [x] `P7-03 [TERRA]` Agents/status endpoint.
- [x] `P7-04 [TERRA]` Catalog/list/detail endpoints.
- [x] `P7-05 [TERRA]` Plan/apply/progress endpoints.
- [x] `P7-06 [TERRA]` Updates/diff/rollback endpoints.
- [x] `P7-07 [LUNA]` Dashboard shell, routing, typography, color tokens.
- [x] `P7-08 [TERRA]` Home screen.
- [x] `P7-09 [TERRA]` Discover screen.
- [x] `P7-10 [TERRA]` Installed screen.
- [x] `P7-11 [TERRA]` Updates and diff screen.
- [x] `P7-12 [LUNA]` Empty, loading, and error states.
- [x] `P7-13 [LUNA]` Keyboard and accessible-label pass.
- [x] `P7-14 [TERRA]` Playwright first-run happy-path test.
  - Runs Chromium against the real loopback dashboard with an empty disposable Loadout home; it previews and applies a safe first-run manifest without touching user configuration.
- [x] `P7-15 [SOL]` Product and security review of complete flow.
  - Reviewed 2026-07-15; see `docs/RELEASE_REVIEW.md` for boundaries, fixes, and release conditions.

### Phase 8: Updates and safety demo

- [x] `P8-01 [TERRA]` Detect candidate commit for installed package.
- [x] `P8-02 [TERRA]` Generate changed-file diff.
- [x] `P8-03 [TERRA]` Generate instruction/script/domain/env summary.
- [x] `P8-04 [TERRA]` Implement approval policy for sensitive changes.
- [x] `P8-05 [LUNA]` Create benign Ponytail-style update fixture.
- [x] `P8-06 [LUNA]` Create risky update fixture adding a hook and domain.
- [x] `P8-07 [TERRA]` Demonstrate safe update acceptance.
- [x] `P8-08 [TERRA]` Demonstrate risky update quarantine.
- [x] `P8-09 [TERRA]` Demonstrate rollback after simulated smoke-test failure.

### Phase 9: Cross-platform verification

- [x] `P9-01 [TERRA]` Windows native install test.
  - CI run `29401149042` passed on `windows-latest` with Node 20 and 22. The native-filesystem smoke test used disposable `LOADOUT_USER_HOME` and `LOADOUT_HOME` directories to plan, install, byte-verify, and remove a real skill through every declared agent-owned skills layout.
- [x] `P9-02 [TERRA]` WSL behavior test or documented compatibility boundary.
- [x] `P9-03 [TERRA]` macOS install test.
  - CI run `29401149042` passed on `macos-latest` with Node 20 and 22 using the host path implementation, not a simulated layout.
- [x] `P9-04 [TERRA]` Linux install test.
  - CI run `29401149042` passed on `ubuntu-latest` with Node 20 and 22 using the host path implementation, not a simulated layout.
- [x] `P9-05 [LUNA]` CRLF/LF fixture coverage.
- [x] `P9-06 [LUNA]` `.cmd` executable-resolution fixture coverage.
- [x] `P9-07 [SOL]` Cross-platform go/no-go review.
  - Reviewed 2026-07-15 after successful CI run `29401149042`: go for the bounded claim that Loadout can plan, install, verify, and remove native `SKILL.md` directories on Windows, macOS, and Linux. No-go remains for a universal runtime claim covering plugins, hooks, executables, or arbitrary MCP servers.

### Phase 10: Submission

- [x] `P10-01 [LUNA]` Expand README with install and supported-platform table.
- [x] `P10-02 [LUNA]` Add sample catalog data and judge test instructions.
- [x] `P10-03 [TERRA]` Add one-command demo mode using isolated fake home dirs.
- [x] `P10-04 [SOL]` Final architecture and threat-model review.
- [ ] `P10-05 [HUMAN]` Verify licenses and attribution for included sources.
- [ ] `P10-06 [HUMAN]` Record under-three-minute demo.
- [ ] `P10-07 [HUMAN]` Explain where Codex and GPT-5.6 were used.
- [ ] `P10-08 [HUMAN]` Capture required `/feedback` Codex session ID.
- [ ] `P10-09 [HUMAN]` Complete Devpost description, category, repository, and video.
- [ ] `P10-10 [HUMAN]` Submit before deadline with buffer.

### Phase 11: Advanced committed capabilities

- [x] `P11-01 [SOL]` Design GitHub OAuth and minimal-scope authorization model.
- [x] `P11-02 [TERRA]` Implement optional private-repository discovery.
  - `loadout discover --private` uses an explicit caller-provided `GITHUB_TOKEN`, returns metadata only, and never persists or logs the token; OAuth/App brokering remains deployment-configured per `docs/GITHUB_AUTHORIZATION.md`.
- [x] `P11-03 [TERRA]` Implement Community Loadout export/import with versioning.
- [x] `P11-04 [TERRA]` Implement star/release/download snapshot storage and charts.
- [x] `P11-05 [SOL]` Define provider-neutral model configuration schema.
- [x] `P11-06 [TERRA]` Implement OpenRouter provider adapter without storing keys in
      application state.
  - The adapter resolves a credential reference at request time and never serializes or logs the raw token.
- [x] `P11-07 [SOL]` Define category-specific evaluation protocol and uncertainty.
- [x] `P11-08 [TERRA]` Implement first two automated evaluation categories.
  - Static skill hygiene and MCP manifest evaluations are deterministic and never execute package code; see `docs/EVALUATION_PROTOCOL.md`.
- [x] `P11-09 [TERRA]` Implement a read-only update watcher and notifications.
  - `loadout watch` performs read-only interval checks and emits human or JSON notifications; it never applies updates automatically.
- [x] `P11-10 [SOL]` Define catalog signing, rotation, and compromise recovery.
- [x] `P11-11 [TERRA]` Implement catalog signing and client-side verification tools.
  - `keygen`, `catalog-sign`, and `catalog-verify` are covered by tests. A real release
    key and signed-release publishing step remain owner-controlled release work; CI
    does not contain or manufacture the production signing identity.
- [x] `P11-12 [SOL]` Design cross-platform hook/subagent compiler with loss reports.
- [x] `P11-13 [TERRA]` Implement first two hook/subagent conversion targets.
  - `loadout convert` creates a loss-reported static skill from a subagent or a non-executable review artifact from a hook; it never synthesizes executable hook behavior and requires manual approval.
- [x] `P11-14 [SOL]` Design sandbox threat model for third-party installers.
- [x] `P11-15 [TERRA]` Implement disposable sandbox runner with no host secrets.
  - `loadout sandbox-run` uses explicit approval, a reviewed image, read-only source mount, no network, dropped capabilities, resource limits, and a scrubbed environment; Docker remains an explicit local prerequisite.
- [x] `P11-16 [SOL]` Design OS-keychain-backed credential interface.
- [x] `P11-17 [TERRA]` Implement macOS, Windows, and Linux credential backends.
  - `credentials` uses macOS Keychain, Linux Secret Service, or Windows Credential
    Manager through bounded no-shell processes. Writes use stdin, errors are redacted,
    and secret values never enter plans, arguments, snapshots, or JSON output.
- [x] `P11-18 [SOL]` Define autonomous-update permission policies and recovery rules.
- [x] `P11-19 [TERRA]` Implement a policy-gated canary planning pipeline.
  - `loadout canary` performs a non-mutating static gate; promotion requires explicit approval plus injected verification and transaction callbacks, so it cannot silently update agent files.
- [x] `P11-20 [SOL]` Define the internal adapter contract and conformance tests.
  - `src/core/adapters.ts`, the shared capability matrix, compatibility policy, and
    conformance tests are the implemented contract. A separately versioned public SDK
    package and community registry are not yet published.
- [x] `P11-21 [TERRA]` Add the next six agent adapters through the SDK.
  - Windsurf, Cline, GitHub Copilot, Roo Code, Kiro CLI, and Junie use documented
    vendor-specific Agent Skills roots. Only native skill support is claimed; all
    unverified component types remain explicitly unsupported.
- [x] `P11-22 [TERRA]` Add compliant Hacker News and community-source connectors.
  - Hacker News Firebase and GitHub REST repository search are read-only connectors; neither mutates the catalog or installs a lead.
- [x] `P11-23 [SOL]` Design team/enterprise policy and audit schemas.
- [x] `P11-24 [TERRA]` Implement shared Loadouts, allowlists, denylists, and audit view.
  - Manifest policy now enforces package/repository allowlists and denylists before synchronization; existing audit output remains the read-only decision view.

### Phase 12: Best-available optimization and public beta

This phase turns the safe installer into the product thesis: Loadout continuously
understands what a user already has, maintains a broad reviewed library, and exposes
only a small evidence-backed active set for the current agent and project. “Best”
always means best supported choice under disclosed evidence and uncertainty, never a
universal or permanent truth.

- [x] `P12-01 [SOL]` Correct the default product posture from Maximum-first to
      Stable-first.
  - Stable is the small `superpowers + context7` foundation when those records exist.
    Maximum remains an explicit broad-library/stress mode.
- [x] `P12-02 [TERRA]` Add read-only `loadout scan` for existing skill directories.
  - Acceptance: report actual `SKILL.md` count, normalized names, content
    fingerprints, Loadout ownership, unmanaged content, within-agent duplicates,
    cross-agent mirrors, per-agent totals, and capacity warnings without executing or
    changing instructions.
- [x] `P12-03 [TERRA]` Close integration defects found by the packaged-CLI audit.
  - New packages include an installable skill skeleton; skipped enabled packages fail
    synchronization rather than producing a misleading lock; absent evaluation
    categories are `not-applicable`; empty canaries still block; signing creates parent
    directories; portable absolute-path errors provide a remedy.
- [x] `P12-04 [TERRA]` Warn when a prepared loadout exceeds 30 active skill
      directories per agent.
  - The warning is a capacity heuristic, not a claim that the agent cannot load more.
- [x] `P12-05 [SOL]` Define the provenance confidence model for existing unmanaged
      content.
  - Levels: exact Loadout record, exact catalog hash, embedded repository/commit,
    heuristic source match, and unknown. Never invent provenance from a folder name.
- [x] `P12-06 [TERRA]` Implement catalog-hash and embedded-metadata provenance
      matching in `loadout scan`.
  - Acceptance: every match includes evidence and confidence; network access is
    optional; unknown remains a first-class result.
- [x] `P12-07 [SOL]` Define semantic duplicate and capability-family rules.
  - Separate exact duplicate, same-name divergent content, cross-agent mirror,
    overlapping workflow, complementary capability, and verified hard conflict.
- [x] `P12-08 [TERRA]` Implement `loadout compare <skill-or-package>`.
  - Show installed candidate, reviewed alternatives, provenance, maintenance,
    adoption velocity, permissions, compatibility, evaluation evidence, uncertainty,
    and a plain-language recommendation. No mutation.
- [x] `P12-09 [SOL]` Define the reviewed-library versus active-set state model and
      migration boundary.
  - Downloaded/cached, reviewed, installed, active, disabled, quarantined, and removed
    are distinct states. Existing user files are never silently adopted or deleted.
- [x] `P12-10 [TERRA]` Implement transactional `loadout enable` and `loadout disable`.
  - Acceptance: only Loadout-managed links/files change; one snapshot covers a batch;
    disabling preserves the library copy; rollback restores byte-identical state.
- [x] `P12-11 [TERRA]` Implement `loadout adopt` for explicitly selected unmanaged
      skills.
  - Preview provenance and hashes, snapshot first, preserve original content, and
    require confirmation. Bulk adoption without review is forbidden.
  - Adoption is one-skill-only, dry-run by default, rechecks the fingerprint before
    the state transaction, and marks only exact catalog fingerprints as reviewed.
- [x] `P12-12 [SOL]` Define active-set selection policy.
  - Inputs include user-pinned capabilities, project signals, agent compatibility,
    conflicts, task families, capacity budget, evaluation confidence, and prior human
    outcomes. Popularity cannot override safety or user pins.
  - The complete ordering and neutral boundaries for not-yet-available evaluation and
    outcome evidence are documented in `docs/ACTIVE_SET_POLICY.md`.
- [x] `P12-13 [TERRA]` Implement project-aware `loadout activate --project <path>`.
  - Preview the delta between global and project active sets; do not require GitHub;
    do not expose irrelevant library content to the agent.
  - Selection is per skill (not per mega-repository), local-only, capacity-bounded,
    pin-aware, agent-scoped, and dry-run by default.
- [x] `P12-14 [TERRA]` Implement `loadout optimize` as the primary guided workflow.
  - Flow: scan -> explain findings -> compare alternatives -> propose active set ->
    preview exact changes -> confirm -> verify -> provide one-command rollback.
  - The guided CLI prints project signals, scores and reasons, equivalent-source
    alternatives, the exact enable delta, verified snapshot id, and rollback command.
- [x] `P12-15 [SOL]` Design representative, category-specific head-to-head
      evaluations.
  - Start with workflow adherence, code-review coverage, documentation retrieval, and
    browser-test planning. Record fixtures, rubrics, model/version, variance, cost, and
    uncertainty; never execute untrusted host code.
  - `docs/HEAD_TO_HEAD_EVALUATION.md` defines fixtures, weighted rubrics, trial
    controls, variance/effect thresholds, cost evidence, uncertainty, non-execution
    boundaries, and signed snapshot requirements for all four categories.
- [x] `P12-16 [TERRA]` Implement the first two head-to-head evaluation harnesses and
      persist signed evidence snapshots.
  - `loadout head-to-head` scores synthetic workflow-adherence and code-review-coverage
    trial observations against declared fixtures, persists an Ed25519-signed evidence
    envelope, and never executes candidate content. Results do not silently replace a
    user's active capability.
- [x] `P12-17 [TERRA]` Add daily candidate ingestion and review queues.
  - Combine official sources, GitHub search, release/activity observations, star
    velocity, compliant community connectors, deduplication, rate-limit handling, and
    a human promotion gate. Discovery never installs automatically.
  - `discover --source all --queue` aggregates the documented GitHub REST and
    Hacker News Firebase sources, preserves partial-source failures, deduplicates
    leads, and keeps human shortlist/ignore decisions. Repeated GitHub observations
    calculate disclosed per-day star velocity; `schedule --job discovery` runs only
    this read-only candidate queue refresh. Discovery never installs or promotes a
    candidate.
- [x] `P12-18 [TERRA]` Add freshness and replacement alerts.
  - Explain when an installed source is archived, materially stale, permission-expanded,
    superseded, or outperformed by reviewed evidence. Offer compare/ignore/pin actions.
  - `alerts` reports archived, one-year-stale, reviewed-commit-change,
    permission-expansion, and verified signed-evidence outperformance findings with
    compare/update/disable actions and local ignore. `alert-pin`, `alert-unpin`, and
    `alert-pins` persist explicit local replacement preferences without changing the
    active set.
- [x] `P12-19 [SOL]` Define privacy-preserving local outcome signals.
  - Default local-only: explicit accept/reject, rollback, disable, repeated activation,
    and task-category success. No source code, prompts, filenames, or secrets leave the
    machine without separate informed consent.
  - The bounded local store accepts only exact package/skill selectors, agent ids,
    task families, outcome enums, and timestamps; paths and arbitrary notes are rejected.
- [x] `P12-20 [TERRA]` Connect improvement feedback to ranking evidence without
      creating a popularity feedback loop.
  - Human outcomes are scoped by task and agent; one user's preference cannot globally
    crown a package.
  - The active-set policy applies capped adjustments only to the same selector,
    agent, and task family. Strong rejection/rollback evidence suppresses automatic
    selection, while an explicit pin remains the user's override.
- [x] `P12-21 [TERRA]` Expose provider-neutral model/OpenRouter configuration through
      validated CLI commands.
  - The current adapter is library-level only. Acceptance requires plan/apply/status,
    redacted output, credential references, and disposable mocked-network tests before
    any real-key test.
  - `loadout models set/status/verify` stores only validated metadata and credential
    references; apply is snapshotted, output is redacted, and provider requests resolve
    an environment or native OS credential only at the explicit verification boundary.
- [x] `P12-22 [TERRA]` Add reviewed MCP setup recipes and connection verification.
  - `mcp-recipe` provides immutable, source-linked Playwright and GitHub read-only recipes,
    previews commands, permissions, environment names, and target config without
    printing values, and separates authorization from configuration. It preserves
    unrelated JSON keys and verifies configured references without launching. An
    explicitly approved `--connect` path starts only the exact reviewed npm version or
    OCI digest, resolves credentials just-in-time, performs a bounded MCP initialize
    handshake, redacts failures, and cleans up the process; the existing Codex MCP
    planner remains the TOML-preserving path.
- [x] `P12-23 [TERRA]` Complete P11-17 keychain backends and connect them to provider,
      private-discovery, registry, and MCP workflows.
  - Provider verification, private GitHub discovery, remote registry publishing/
    serving, and explicit MCP connection checks share environment/native-keychain
    references. MCP secrets enter only the short-lived verified subprocess environment
    and are never written into agent configuration or Loadout state.
- [x] `P12-24 [SOL]` Design a cross-platform daily scheduler that invokes read-only
      discovery/update checks.
  - macOS LaunchAgent, Windows Task Scheduler, and Linux systemd/cron implementations
    must be opt-in, inspectable, removable, rate-limited, and unable to apply updates.
  - The native plans schedule only `loadout watch --once --json`; generated files and
    native actions are shown in the dry run, and no apply-capable command is present.
- [x] `P12-25 [TERRA]` Implement `loadout schedule` and `loadout unschedule` with native
      disposable/configuration tests.
  - macOS LaunchAgent, Linux systemd user timer, and Windows Task Scheduler XML are
    generated natively, snapshotted, installed only with `--yes`, and removable.
- [x] `P12-26 [TERRA]` Polish the CLI as the sole required product surface.
  - Consistent progress, compact tables, accessible color/no-color output, actionable
    errors, interruption handling, shell completion, noninteractive JSON, and terminal
    widths from 80 to 200 columns.
  - Bash, Zsh, Fish, and PowerShell completion cover top-level and nested credential/
    model commands. Help flushes fully through pipes; automation can request structured
    JSON errors; capability tables are deterministic, ANSI-free, and bounded at 80,
    120, and 200 columns. Long-running services clean up signals, and mutations retain
    transactional interruption recovery.
- [x] `P12-27 [LUNA]` Reframe README, testing, and demo around scan/compare/optimize;
      move dashboard instructions to an optional diagnostics section.
  - README and disposable testing now lead with the scan -> compare -> optimize ->
    rollback workflow; dashboard instructions are explicitly optional diagnostics.
- [x] `P12-28 [TERRA]` Add a privacy-safe `loadout report`/`loadout share` artifact.
  - Default output contains package ids, versions, evidence, and compatibility only;
    exclude usernames, absolute paths, private repositories, project names, and secrets.
  - The artifact contains package ids, commits, agent compatibility, aggregate
    activation/review counts, and MCP package ids; repository names, server names,
    paths, filenames, projects, prompts, code, and credential data are excluded.
- [x] `P12-29 [TERRA]` Complete P1-11 with at least 50 reviewed records and capability
      coverage metrics.
  - Measure unique capabilities, overlap, licenses, immutable commits, install shape,
    platforms, activity, and evaluation readiness rather than raw repository count.
  - `catalog --coverage [--json]` reports 50 immutable records across 37 categories,
    including component/install shapes, overlaps, licenses, source-inspection platforms,
    activity observations, and evaluation readiness.
- [ ] `P12-30 [HUMAN]` Complete legal/license attribution review, including all current
      `NOASSERTION` records, before distribution.
- [ ] `P12-31 [TERRA]` Publish `loadout-ai` to npm and run clean-machine package tests
      from outside the repository on macOS, Windows, Linux, and Node 20/22.
  - Partial: `loadout-ai@0.2.0` was published publicly on 2026-07-17 while the GitHub
    repository remained private. Registry version/integrity, a clean external npm
    install, version/help, 50-record catalog coverage, and the real disposable
    Superpowers install/rollback demo pass on macOS. Hosted matrix evidence already
    covers Windows/macOS/Linux and Node 20/22; clean independent-user installs on
    Windows and Linux remain required.
- [ ] `P12-32 [HUMAN]` Run moderated founder testing on the real Claude and Codex
      profiles with snapshots and explicit rollback checkpoints.
  - Partial 2026-07-16: the founder ran the published npm CLI against the real macOS
    profile. Read-only doctor/scan/status/health and snapshot listing completed; the
    run exposed and regression-tested the Codex Desktop detection fix. A real Stable
    mutation and rollback remain pending.
- [ ] `P12-33 [HUMAN]` Run at least ten external user tests spanning new users, power
      users, Windows, macOS, Linux, one-agent, and multi-agent setups.
- [ ] `P12-34 [SOL]` Public-beta go/no-go review.
  - Required: zero known destructive data-loss defects; every mutation previewed and
    recoverable; no false “best” or compatibility claims; install/optimize/rollback
    success on all supported platforms; p95 local scan under five seconds for 1,000
    skills; actionable failure messages; npm provenance and attribution complete.
  - Partial evidence: seven real CLI runs over 1,000 on-disk skills measured a local
    p95 of 1.28 seconds on 2026-07-16. A disposable real Maximum flow also prepared all
    31 skill-bearing repositories, exposed 1,219 skill directories, resolved 48
    overlaps, exercised optimization/apply/rollback, and left no test profile behind.
    Transaction, rollback, package-tarball, and CLI product-flow gates pass locally;
    hosted OS/Node release evidence and attribution approval remain required before
    go-live.

### Phase 13: Pre-testing hardening and continuous discovery

- [x] `P13-01 [TERRA]` Repair default GitHub discovery against the live API.
  - Replace the ineffective parenthesized topic query with three valid rolling topic
    searches, merge case-insensitive duplicates, rank deterministically, preserve
    exact custom-query semantics, and test rate-limit and malformed-response failures.
- [x] `P13-02 [TERRA]` Publish a bounded daily discovery evidence feed.
  - One five-minute GitHub Actions job performs eight real GitHub searches, records
    current and retained candidates in `catalog/discovered.json`, and regenerates
    `docs/DISCOVERED.md` without installing or promoting a repository.
  - Day-one ordering uses an explicitly labelled lifetime star average; after one
    complete day, real observed star velocity takes precedence. Empty or malformed
    runs cannot replace the last healthy artifact, and CI validates every generated
    record.
- [x] `P13-03 [LUNA]` Rebuild the README and credit every reviewed upstream source.
  - The README is CLI-first, accurately distinguishes preview/network/mutation
    boundaries, links the daily candidate feed, and records npm publication accurately.
  - `docs/CATALOG.md` links all 50 repositories and all 50 immutable reviewed commits;
    CI prevents silent attribution drift and identifies six `NOASSERTION` records for
    human legal review.
- [x] `P13-04 [TERRA]` Harden beginner test-drive and rollback recovery.
  - Catalog-backed demos fetch the exact reviewed commit, `test-drive` aliases the
    isolated install/rollback exercise, and all `--agents` arguments use one validated
    parser.
  - Rollback lists snapshots read-only and rejects traversal, malformed bytes,
    filesystem/home/state roots, overlapping roots, escaping paths, duplicates, and
    inconsistent persisted records before mutation.
- [x] `P13-05 [SOL]` Document an executable full-feature founder test matrix.
  - `docs/FEATURE_TEST_MATRIX.md` covers every top-level command, authority boundary,
    network/process/credit side effect, expected result, platform integration, and
    cleanup path using disposable profiles wherever possible.
- [x] `P13-06 [TERRA]` Pass the integrated pre-testing gate and repeat the real live
      discovery plus immutable isolated test-drive after all Phase 13 changes.
  - `npm run verify` passes 73 test files/270 tests, CLI E2E, installed-tarball
    smoke, generated-evidence validation, and a 1,000-skill p95 of 0.97 seconds.
    Playwright passes independently; live discovery returns real leads; the reviewed
    two-agent test-drive installs at the pinned Superpowers commit and rolls back its
    temporary profile.

### Phase 14: Candidate intelligence and trusted catalog delivery

- [x] `P14-01 [TERRA]` Turn the generated discovery feed into an explainable candidate
      triage CLI.
  - `candidate list` validates the feed, supports bounded search/limits, distinguishes
    measured velocity from lifetime averages, and discloses that adoption evidence is
    not quality or safety evidence.
- [x] `P14-02 [TERRA]` Build immutable static candidate dossiers.
  - `candidate inspect` resolves a real public repository to a full commit and records
    portable component paths, static evaluation, license, growth, catalog overlap,
    uncertainty, and human-review blockers without executing candidate content.
  - Git fetch is time-bounded; system/global Git config, templates, hooks, credential
    helpers, inherited `GIT_*` overrides, and LFS smudging are isolated. A bounded
    GitHub tree-API preflight must prove every blob size and a total below 100 MiB and
    20,000 files before checkout.
- [x] `P14-03 [TERRA]` Add a human-gated catalog proposal boundary.
  - Blocked dossiers cannot produce proposals; platform/category/id claims are
    explicit; the pinned source inspection and evaluation are recomputed before
    admission; preview is default; approved output remains an isolated record and
    never mutates the catalog or installs the source.
- [x] `P14-04 [TERRA]` Make signed remote catalog releases operational.
  - `catalog-update` accepts local files or bounded HTTPS, verifies Ed25519 signatures
    and complete immutable evidence, previews exact additions/updates/removals, blocks
    replay and implicit removals, then snapshots and atomically applies trusted state.
  - Apply revalidates and recomputes under an exclusive lock, pins the first signing
    key, preserves replay high-water across catalog rollback, and never lets unsigned
    cached metadata clear a signed archive decision.
  - Effective catalog loads re-verify the persisted envelope and merge only mutable
    GitHub refresh metadata over the trusted signed base.
- [x] `P14-05 [TERRA]` Connect local outcomes to normal recommendations and expose
      adapter expansion gaps honestly.
  - `recommend --agent` applies capped agent/task-scoped local evidence without adding
    unreviewed candidates. `capabilities --gaps` lists unsupported combinations and
    the documentation, preservation, transaction, and smoke evidence required before
    support can be claimed.
- [x] `P14-06 [TERRA]` Pass the full integrated gate and a live candidate dossier flow.
  - Required: full verify, package smoke, CLI product flow, real current-feed list, one
    live immutable candidate inspection, no source execution, and clean git state.
  - `npm run verify:full` passes 77 test files/310 tests, evidence validation, CLI
    product flow, package smoke, a 1,000-skill p95 of 1.54 seconds, and Playwright;
    the catalog carries 50 credited immutable records and the current discovery feed
    contains 242 validated leads. A disposable live inspection pinned
    `Leonxlnx/taste-skill` at commit
    `b17742737e796305d829b3ad39eda3add0d79060`, found 13 skills and one plugin,
    surfaced script/network/environment review findings and five catalog overlaps,
    and executed or installed none of the source.

### Phase 15: Stable release candidate and daily autopilot

- [x] `P15-01 [TERRA]` Make Stable the strongest low-risk default, not a minimal demo.
  - Stable now selects 30 high-value engineering, documentation, frontend,
    observability, performance, planning, testing, review, Git, architecture, and
    current-documentation skills from four immutable SPDX-identified sources.
  - A live Codex-targeted preparation found zero static-risk approvals, collisions,
    or skipped components. Power and Maximum remain broader opt-in libraries.
- [x] `P15-02 [TERRA]` Separate technical screening from recommendation trust.
  - The catalog and coverage API expose `discovered`, `inspected`, `human-reviewed`,
    `benchmarked`, and `recommended` stages. The bundled release reports 50
    technically screened records and four recommended Stable sources without
    manufacturing human-review or benchmark evidence.
- [x] `P15-03 [TERRA]` Correct candidate installability and runtime-tool detection.
  - Candidate dossiers classify `portable-components`, `explicit-runtime-setup`, or
    `unsupported-source-shape`. Conventional component directories accept real
    manifest files only, preventing nested reference folders from being mislabeled
    as agents; the live Graphify inspection now reports an unsupported runtime-tool
    shape instead of a portable agent bundle.
- [x] `P15-04 [TERRA]` Add one-command daily autopilot on macOS, Linux, and Windows.
  - `autopilot` previews, transactionally applies, or removes both daily update and
    discovery schedules. Scheduled commands use the pinned npm package version and
    remain read-only: they never install, promote, or update content automatically.
- [x] `P15-05 [TERRA]` Harden npm release metadata and trusted-publishing workflow.
  - The package has normalized repository metadata, Node 24/npm 11 trusted-publish
    tooling, full `npm run verify`, tag/version consistency, public provenance, and a
    first-publish token fallback.
- [x] `P15-05A [TERRA]` Pass the complete local release-candidate gate.
  - `npm run verify` passes 79 test files/317 tests, catalog/discovery attribution,
    the real CLI product flow, installed npm-tarball smoke, and seven real scans of
    1,000 on-disk skills at a 1.29-second p95 on macOS/Node 23.
- [ ] `P15-06 [HUMAN]` Approve public repository visibility, complete the six
      `NOASSERTION` license decisions, authenticate npm, and publish `loadout-ai`.
  - Partial 2026-07-17: npm authentication and the public `loadout-ai@0.2.0`
    publication succeeded. Repository visibility remains private at the owner's
    request, and the six root-level `NOASSERTION` decisions remain a human release
    gate; therefore this combined item is not ticked.
- [x] `P15-07A [TERRA]` Run the hosted macOS/Windows/Linux Node matrix.
  - GitHub Actions run `29502324100` passes fast verification, dashboard browser
    diagnostics, and native install/package flows on Windows, macOS, and Ubuntu with
    Node 20 and 22. The first run exposed a Windows-only root-path test assumption;
    the portable regression fix passes on both Windows versions.
- [ ] `P15-07B [HUMAN]` After npm publication, verify a clean external
      `npx loadout-ai` installation on Windows, macOS, and Linux.
- [x] `P15-08 [SOL]` Implement the first bounded explicit runtime-tool recipe.
  - `loadout tool graphify` previews and installs Graphify 0.9.17 from an exact
    SHA-256-pinned PyPI wheel linked to a reviewed Git commit. It uses an isolated
    `uv` tool directory, fixed commands, a five-minute timeout, a credential-stripped
    subprocess environment, exact agent targets, version verification, generated
    runtime pinning, snapshots, rollback on failure, and reversible removal.
  - A real disposable Codex-profile exercise installed the pinned wheel, generated
    the skill, verified version 0.9.17 and the pinned lookup, removed it, restored the
    prior profile, and left no runtime or active-profile residue.
- [ ] `P15-09 [SOL]` Generalize the reviewed runtime-recipe schema only as new tools
      earn admission. Add OS sandbox backends where available; never execute an
      arbitrary candidate repository installer or inherit provider credentials.

### Phase 16: Evidence-driven product moat and simple upgrade journey

Phase 16 changes the product category from “another agent package manager” into the
trust, discovery, evaluation, optimization, and rollback layer above skills.sh,
OpenPackage, Microsoft APM, the official MCP Registry, and raw GitHub repositories.
Loadout may ingest those ecosystems as read-only evidence sources or use their
declarative formats as inputs, but it must not duplicate mature dependency-manager
behavior merely to increase its command or repository count.

#### Phase 16 model-routing and credit policy

- **Sol** owns ambiguous, security-sensitive, research-heavy, or product-defining
  work: evaluation methodology, threat models, ranking/promotion policy,
  compatibility semantics, runtime execution boundaries, and final integration
  reviews. Sol work must produce decisions, invariants, adversarial cases, or review
  evidence—not bulk mechanical edits.
- **Terra** owns the main implementation path: CLI orchestration, connectors,
  schemas, state machines, transactions, provider adapters, scoring engines,
  cross-platform integration, and regression fixes. Terra is the default for
  production code with clear acceptance criteria.
- **Luna** owns bounded repeatable work: fixtures, schema examples, deterministic
  transforms, documentation matrices, command completion, generated reports, and
  repetitive adapter tests. Luna output still requires Terra or Sol integration
  review when it affects trust, mutation, or public claims.
- Prefer Standard speed. Fast mode is reserved for a submission-critical wall-clock
  emergency because GPT-5.6 Fast consumes credits at a higher multiplier.
- Reserve at least 15% of remaining Codex credit for integration failures, founder
  feedback, cross-platform regressions, release review, and submission polish.
- ChatGPT/Codex credit must not be represented as OpenAI API credit. A model-backed
  evaluation runner may be built without credentials, but paid benchmark execution
  requires a separately verified provider credential and explicit per-run budget.
- No task may consume credit merely to exhaust the grant. Every model-backed run must
  have a hypothesis, maximum trials/tokens/cost, deterministic acceptance test, and
  persisted evidence artifact.

#### Product contract

The default journey must answer, in order:

1. What agents and extensions are already installed?
2. Which files are owned, duplicated, stale, unsupported, or risky?
3. Which reviewed additions fit this project and agent?
4. Why is each addition preferred to a real alternative?
5. What exact permissions and filesystem changes will occur?
6. Can the complete change be restored byte-for-byte?
7. Did the resulting loadout improve a measurable task outcome?

The intended first-run surface is one command, with advanced commands retained:

```text
loadout upgrade
  -> scan
  -> diagnose and score
  -> recommend and compare
  -> preview permissions and exact targets
  -> snapshot and transactionally apply
  -> optimize the bounded active set
  -> verify health
  -> show an evidence-linked before/after report
```

- [x] `P16-01 [SOL]` Specify the Loadout Evaluation Protocol v1.
  - Define paired baseline-versus-skill trials, pinned repositories, task families,
    hidden or immutable acceptance tests, randomized run ordering, minimum repeats,
    model/provider/version capture, temperature/reasoning capture where available,
    latency, tokens, reported cost, pass rate, regressions, and uncertainty.
  - Separate deterministic task verification from model-based judging. A model judge
    can annotate qualitative dimensions but cannot override a failed executable test.
  - Define contamination, prompt-injection, evaluator-tampering, flaky-test, timeout,
    and partial-result policies before executing a community skill.
  - Acceptance: the protocol is versioned, fixture-hash bound, reproducible, privacy
    bounded, and explicit about what it cannot prove.
  - Completed 2026-07-16 in `docs/EVALUATION_PROTOCOL_V1.md` with strict campaign and
    resumable-run schemas, deterministic paired scheduling, blinded order, content
    hashes, retry-inclusive budgets, interruption/tamper rules, privacy boundaries,
    and nine adversarial protocol tests.

- [ ] `P16-02 [TERRA]` Implement a provider-neutral benchmark run schema and budget
      gate.
  - Add exact model/provider/endpoint references without persisting secrets; store
    input/output token counts, latency, reported cost, exit state, fixture hash,
    candidate hash, agent version, and trial seed.
  - Require `--max-cost`, `--max-trials`, and `--approve-model-spend` before a paid
    runner starts. Preview must calculate the maximum possible spend and run count.
  - Resume an interrupted campaign without duplicating completed trials; atomically
    persist append-only evidence and reject edited or mismatched artifacts.
  - Acceptance: no API key, prompt content, project source, or credential value enters
    logs, lockfiles, reports, snapshots, or signed public evidence.
  - Engineering complete 2026-07-16: campaign/run validation, canonical hashes,
    deterministic recovery, worst-case budget preview, mode-0600 metadata, and
    `loadout benchmark plan` are implemented. The runner adds a strict JSONL hash
    chain, fsync, a cross-process lock, hard aggregate ceilings, retry accounting,
    output hashes only, tamper/torn-log rejection, and explicit interrupted-provider
    reconciliation. It has no default provider or secret-bearing endpoint.
  - Acceptance still open: a real paid-provider adapter and live reconciliation run
    must prove provider usage agrees with the local ceilings.

- [ ] `P16-03 [SOL+TERRA]` Implement the isolated paired evaluation runner.
  - Use disposable worktrees or copied fixtures and the strongest available local OS
    sandbox. Network is denied by default; any required domain is declared and
    separately approved. Candidate install scripts are never run implicitly.
  - Run baseline and candidate with identical repository bytes, acceptance tests,
    model settings, budgets, and tool policy; randomize ordering and record failures.
  - Candidate output cannot edit evaluator code, hidden tests, prior evidence, or the
    opposing trial. Restore or destroy the sandbox after every trial.
  - Acceptance: adversarial fixtures prove evaluator isolation, timeout, budget,
    interruption recovery, and tamper rejection on macOS, Linux, and Windows-capable
    fallback paths.
  - Engineering complete 2026-07-16: the provider-neutral runner requires injected
    provider/isolation executors plus explicit spend approval, randomizes deterministic
    pairs, pauses on unknown paid-provider state, hashes outputs, tears down every
    request, and selects Docker then Podman with no host fallback. Acceptance remains
    open for a concrete container/worktree executor and live cross-platform matrix.

- [ ] `P16-04 [LUNA, SOL review]` Create the first real benchmark fixture suite.
  - Start with planning/workflow adherence, code review, frontend accessibility,
    debugging, documentation freshness, API design, and safe migration tasks.
  - Every fixture has a pinned permissively licensed repository or synthetic source,
    deterministic setup, explicit acceptance criteria, expected runtime, and license.
  - Include negative-control skills, deliberately outdated guidance, overlapping
    skills, and no-skill baselines so the harness can detect zero or negative value.
  - Acceptance: at least five trials per compared candidate in the release evidence;
    fixtures themselves contain no mock performance claims or fabricated outcomes.
  - Engineering complete 2026-07-16: seven synthetic MIT-licensed task families plus
    no-skill, negative, outdated, and overlapping controls have exact file/fixture/
    rubric/control/suite hashes, deterministic materialization and grading, bounded
    cross-platform metadata, and tamper/symlink/path/inventory tests. No outcome was
    invented; acceptance remains open for five real paired trials per candidate.

- [ ] `P16-05 [SOL]` Connect benchmark evidence to trust and Stable promotion.
  - `benchmarked` requires signed protocol-conformant evidence; `recommended` requires
    human license/trust review plus no blocking security finding and meaningful gain
    in at least one declared task family without an unacceptable regression.
  - Stars, install telemetry, and popularity can prioritize evaluation but cannot
    establish quality. Missing evidence contributes zero rather than a neutral score.
  - Acceptance: catalog coverage explains every promotion/demotion and retains the
    prior signed evidence so a recommendation cannot silently change.
  - Engineering complete 2026-07-16: signed evidence validation recomputes paired
    task-family deltas from hash-bound completions; recommendation requires meaningful
    gain, no unacceptable regression, no blocking security finding, and a commit-bound
    signed human attestation. Hash-chained decisions retain prior evidence and demote
    stale revisions. Real trials and genuine human review remain external gates.

- [x] `P16-06 [SOL design, TERRA implementation]` Add the unified `loadout upgrade`
      golden path.
  - One preview combines scan, health, capability gaps, project signals, local
    outcomes, Stable/Power choices, exact alternatives, risk findings, file targets,
    deferred MCP/runtime steps, and the rollback point.
  - Apply remains explicit. It uses one durable transaction and never turns daily
    discovery into automatic installation. Existing unmanaged files are preserved.
  - Non-interactive `--json`, `--yes`, risk approval, selected-agent, and project-root
    behavior must be deterministic. Advanced constituent commands remain supported.
  - Acceptance: a new user can preview in under one minute, understand the five most
    important decisions, apply to a disposable profile, verify, and roll back.
  - Completed 2026-07-16: `loadout upgrade` combines local health, explainable
    scores, project signals, recommendations, immutable preparation, exact targets,
    collision/risk evidence, one transaction, post-apply health, JSON, selected-agent,
    custom-mode, and approval behavior. It includes local-outcome personalization,
    capability gaps, deterministic alternatives, deferred MCP/runtime actions, and a
    bounded-active versus disabled-library policy. A disposable network exercise
    installed 30 Stable skills and rolled every managed byte back; a later fresh
    preview again prepared all 30 without touching the real profile.

- [x] `P16-07 [SOL policy, TERRA implementation]` Add an explainable Agent Health
      Score and `loadout health --explain`.
  - Score only evidenced dimensions: immutable provenance, license state, safety
    findings, drift, duplicates, staleness, active-set capacity, native compatibility,
    project relevance, benchmark evidence, local outcomes, and recoverability.
  - Show the exact contribution, cap, evidence date, uncertainty, and remediation for
    every point. Never estimate a post-upgrade score from unexecuted performance.
  - Acceptance: deterministic fixtures cover perfect, empty, overloaded, drifted,
    unlicensed, incompatible, and mixed managed/unmanaged profiles.
  - Completed 2026-07-16: ten independently capped dimensions total 100; every
    dimension exposes contribution, evidence, uncertainty, remediation, and evidence
    coverage. Local collection uses pinned catalog/state/hash/inventory/outcome/
    snapshot evidence; unavailable static-risk or benchmark evidence remains unknown
    and earns zero. `health --explain` and upgrade before/after output share the policy.

- [x] `P16-08 [TERRA]` Add a read-only skills.sh discovery connector.
  - Ingest permitted public metadata and immutable GitHub source references; preserve
    source attribution, observation time, ranking meaning, and telemetry uncertainty.
  - Deduplicate against GitHub/Hacker News observations and the reviewed catalog.
    skills.sh popularity is an install signal, not safety or performance evidence.
  - Connector failure is partial and cannot block offline catalog use or installation.
  - Completed 2026-07-16 against the documented API with bounded pagination,
    response/time limits, attribution, rate-limit evidence, deduplication, strict
    schema validation, complete-cache fallback, and `discover --source skills-sh`.
    The current upstream contract requires a request-scoped Vercel OIDC token and
    exposes mutable repository identity rather than a commit, so Loadout says so and
    requires later immutable dossier review instead of inventing pin evidence.

- [x] `P16-09 [TERRA]` Add an official MCP Registry discovery connector.
  - Validate registry responses against a bounded schema; preserve namespace,
    publication version, distribution type, repository, and verification evidence.
  - Registry membership establishes identity/distribution evidence only. Loadout still
    previews credentials, permissions, transports, commands, domains, and target
    configurations before any MCP recipe can be admitted or applied.
  - Acceptance: pagination, duplicate versions, malformed records, rate limits,
    replay, and offline cache behavior have deterministic tests.
  - Completed 2026-07-16 with official v0.1 cursor pagination, bounded schemas,
    namespace/version/distribution/lifecycle evidence, duplicate resolution, partial
    results, cursor-replay defense, complete-cache fallback, and
    `discover --source mcp-registry`. Registry presence is never labeled popularity,
    safety approval, or Loadout recommendation.

- [x] `P16-10 [SOL design, TERRA implementation]` Treat Microsoft APM and OpenPackage
      as interoperable inputs rather than enemies to reimplement.
  - Inspect/import supported declarative manifests and lock evidence without invoking
    either external CLI. Map primitives loss-reportingly into Loadout capability and
    trust records; retain the original source and unsupported fields.
  - Consider an optional backend adapter only after the preview, ownership,
    transaction, and rollback contracts can remain true. Never claim Loadout created
    or independently reviewed third-party registry evidence.
  - Completed 2026-07-16: bounded read-only planners map Microsoft APM manifests/locks
    and OpenPackage manifests/workspace indexes while preserving exact bytes/SHA-256,
    unsupported fields, source uncertainty, and declared-but-unverified hashes.
    `loadout interop apm|openpackage` never invokes an external CLI, resolves a
    registry, writes, installs, or claims third-party review.

- [x] `P16-11 [SOL design, TERRA implementation]` Add agent and model compatibility
      intelligence.
  - Detect installed agent CLI/application versions using bounded read-only commands
    or version files with timeouts. Never start an agent session or inherit secrets.
  - Maintain a signed compatibility feed for path/config/format changes, deprecated
    surfaces, supported model/provider changes, and known recipe breakage.
  - Add `versions` and `compatibility` output with current version, evidence source,
    freshness, affected managed content, migration preview, and uncertainty.
  - Acceptance: fixtures cover missing binaries, prereleases, malformed output,
    timeouts, Windows executable resolution, offline state, and a breaking path change.
  - Completed 2026-07-16: `loadout versions` detects installed agent CLI versions using
    fixed read-only commands, a sanitized environment, five-second timeout, semantic
    version parsing, explicit missing/malformed/timeout evidence, prerelease
    uncertainty, and Windows executable resolution. Strict signed notices cover
    freshness/offline/stale/invalid states, version ranges, affected managed install/
    activation/MCP content, and approval-only migration previews. `loadout
compatibility` consumes verified intelligence without mutating agent state.

- [ ] `P16-12 [SOL trust design, TERRA implementation]` Publish a bounded signed daily
      intelligence feed.
  - Generate discovery observations, compatibility notices, candidate inspection
    summaries, benchmark changes, and signed catalog-release pointers centrally.
  - The public feed contains no user telemetry or private repository information.
    Clients verify signatures, size, schema, freshness, sequence, and replay state.
  - Feed consumption never installs, promotes, updates, or executes a candidate.
    Trusted catalog membership changes only in a separately reviewed signed release.
  - Acceptance: local file and HTTPS preview/apply, key pinning/rotation policy,
    downgrade/replay rejection, stale fallback, and compromise recovery are tested.
  - Engineering complete 2026-07-16: strict public-only schemas, Ed25519 signing,
    local/HTTPS preview, bounded reads, expiry, sequence high-water marks, explicit
    next-key authorization, verified stale fallback, compromise reset, cache-only
    apply, central discovery projection, and `loadout intelligence` are tested. Apply
    cannot install, promote, update, or execute. Acceptance remains open until a human
    provisions the production signing key and public host for the daily workflow.

- [x] `P16-13 [SOL security design, TERRA implementation]` Upgrade skill security and
      specification validation.
  - Validate Agent Skills frontmatter, naming, size, progressive-disclosure structure,
    symlinks, executable files, dependencies, remote instruction loads, domains,
    environment references, Unicode controls, prompt-injection/exfiltration language,
    and capability/permission declarations.
  - Generate an SBOM-like inventory for executable recipes and report disagreements
    between deterministic and optional model-assisted scanners instead of collapsing
    them into an unjustified safe/unsafe label.
  - Acceptance: malicious and benign adversarial fixtures measure false positives and
    false negatives; critical findings fail closed unless a narrowly scoped explicit
    override is supported and recorded.
  - Completed 2026-07-16: `loadout skill-audit` validates Agent Skills metadata and
    disclosure bounds, symlinks, executables, dependencies, remote loads, domains,
    environment names, Unicode controls, injection/exfiltration patterns, and declared
    capabilities. It emits a content-hashed SBOM-like inventory and reports assisted
    scanner disagreement separately. Selected critical content fails closed; allowlist
    selection happens before validation so unselected collection bytes cannot enter or
    block a plan. Benign/malicious regression fixtures record expected error counts.

- [ ] `P16-14 [TERRA, LUNA fixtures]` Create privacy-safe viral CLI artifacts.
  - Add a deterministic Markdown/JSON `loadout card` with agents, active skills,
    provenance coverage, health dimensions, update date, and zero project paths,
    prompts, code, repository names from private sources, or secrets.
  - Add `compare-loadouts` for two explicit privacy-safe reports and a static badge
    endpoint specification that does not require telemetry.
  - Acceptance: snapshot/redaction tests and a beginner comprehension test prove that
    the artifact is useful without implying a universal quality score.
  - Engineering complete 2026-07-16: deterministic Markdown/JSON `loadout card` and aggregate-only
    `compare-loadouts` are implemented with redaction tests, evidence coverage, claim
    boundaries, and zero project/repository/path/prompt/code/credential detail. A
    telemetry-free Shields endpoint artifact covers evidence, active-skill,
    managed-package, and MCP aggregates. Only the real beginner comprehension study
    remains open.

- [ ] `P16-15 [SOL design, TERRA implementation]` Generalize reviewed runtime recipes.
  - Define a versioned declarative schema for exact artifacts, hashes/signatures,
    dependency cutoffs, permissions, sanitized environment, fixed commands, health
    checks, agent targets, timeouts, snapshot roots, removal, and supported OSes.
  - Migrate Graphify without changing its current reviewed behavior. Admit another
    tool only after independent usefulness, license, security, and rollback review.
  - Acceptance: schema validation, Graphify parity, malicious recipe rejection,
    Windows path behavior, failure rollback, and removal restoration pass.
  - Engineering complete 2026-07-16: a strict v1 schema covers exact artifacts and
    hashes, source/license/trust, dependency cutoffs, permissions, sanitized env,
    direct commands, health checks, agent targets, timeouts, snapshots/removal, and OS
    binaries. Graphify generates the prior exact plan/SKILL bytes; malicious recipe,
    plan-integrity, Windows path, rollback, and removal tests pass. An independently
    reviewed second tool and a live Windows install remain open.

- [ ] `P16-16 [TERRA implementation, LUNA fixtures]` Deepen adapters only where
      official documentation and user demand justify it.
  - Prioritize commands/agents/rules/plugins/MCP gaps for the agents actually observed
    in founder tests. Every claim needs source documentation, preservation fixtures,
    transaction coverage, and a real disposable smoke test.
  - Do not broaden a compatibility badge merely because a directory can be copied.
  - Waiting on P16-18 evidence by design: the generic capability-gap report and
    preservation/transaction fixtures exist, but no new adapter surface is claimed
    until founder demand and official documentation justify it.

- [x] `P16-17 [SOL]` Add a supply-chain and product claim review gate.
  - Verify every “best,” “safe,” “compatible,” “daily,” “official,” and “supported”
    statement against current stored evidence. Reject release artifacts containing
    stale counts, fabricated benchmark data, unreviewed licenses, or silent execution.
  - Produce a machine-readable release evidence index linking claims to tests,
    immutable sources, benchmark artifacts, and human decisions.
  - Completed 2026-07-16: `loadout claims` and `npm run check:evidence` emit a
    machine-readable six-claim index, verify catalog counts/evidence files and
    universal-best/no-benchmark boundaries, and reject unsupported release claims.

- [ ] `P16-18 [HUMAN+SOL]` Complete founder and external product validation.
  - Run the complete matrix first in disposable profiles, then with snapshots on the
    founder's real Codex and Claude installations. Record confusion and time-to-value,
    not only command success.
  - Run at least ten external sessions across beginners, power users, one/many agents,
    and Windows/macOS/Linux. Convert reproducible failures into regression tests.
  - Public beta requires zero known destructive-loss defects, successful rollback,
    provenance publication, license decisions, and no unsupported universal-best claim.

#### Phase 16 execution waves

Integration checkpoint 2026-07-16: the complete required gate passes 101 test files/
448 tests, catalog and discovery attribution, the real CLI product flow, installed
npm-tarball smoke, and seven 1,000-skill scans at a 1.27-second p95. The optional
Chromium first-run test and `npm publish --dry-run` also pass. Live bounded smoke tests
returned current official MCP Registry records, failed skills.sh closed without its
required token, installed and rolled back all 30 Stable skills in a disposable Codex
profile, and changed no real agent profile. A fresh post-security-upgrade preview
prepared all 30 selected Stable directories from four immutable pins; its first run
exposed and then regression-tested selection-before-validation for collection repos.

1. **Wave A — proof foundation:** P16-01 through P16-05.
2. **Wave B — killer first run:** P16-06 and P16-07.
3. **Wave C — ecosystem intelligence:** P16-08 through P16-12.
4. **Wave D — trust depth and sharing:** P16-13 through P16-17.
5. **Wave E — validation and release:** P16-18, P12-30 through P12-34, and P15-06/07B.

Work in later waves may scaffold interfaces in parallel, but public claims and
recommendation promotion cannot bypass earlier evidence/trust gates. More catalog
records, a new frontend, automatic candidate installation, and broad arbitrary
runtime execution are explicitly lower priority than these waves.

### Phase 17: Credential-aware onboarding and install/update correctness

This phase was added after founder review identified a common misconception: paid
ChatGPT or Claude chat subscriptions are not provider API billing. Loadout must give a
useful no-key experience while making credentialed integrations impossible to apply by
accident.

- [x] `P17-01 [SOL policy, TERRA implementation]` Define a non-secret setup access
      profile for `openai`, `anthropic`, `openrouter`, `other`, or `none`.
  - Interactive onboarding asks in plain language and explicitly excludes chat
    subscriptions. `--api-access` accepts provider names, rejects unknown/key-like
    values, and never persists a credential.
  - The answer is eligibility/explanation context only; it cannot bypass trust,
    compatibility, license, safety, approval, or transaction gates.
- [x] `P17-02 [TERRA]` Keep broad setup credential-free by construction.
  - Stable, Power, Maximum, and Custom automatically copy only statically inspected
    skill directories at immutable commits. MCP-only and executable records remain
    explicit regardless of declared API access.
  - Product copy explains that a skill mentioning OpenAI or Anthropic does not itself
    require a model key; the specific runtime operation decides that requirement.
- [x] `P17-03 [SOL security, TERRA implementation]` Fail closed on credentialed MCP
      configuration.
  - A credentialed recipe cannot be applied until every required environment reference
    resolves. Config output stores `${VARIABLE}` only and never a value.
  - OS-keychain references are accepted only at Loadout-controlled execution
    boundaries such as the explicit bounded connection verifier; arbitrary host
    configs are not falsely claimed to resolve Loadout keychain entries.
- [x] `P17-04 [TERRA]` Quarantine invalid Maximum units rather than entire collections.
  - Deterministic critical validation still fails closed for the unit. Safe siblings at
    the same immutable source revision remain available, and every rejected unit and
    reason appears in the preview.
- [x] `P17-05 [SOL invariant, TERRA implementation]` Support Maximum after Stable.
  - Matching active units stay active only when the incoming and installed reviewed
    commits match. Additional units enter the disabled library. Revision mismatch or a
    missing active unit blocks the transaction instead of relabeling or overwriting it.
- [x] `P17-06 [SOL invariant, TERRA implementation]` Scope collection updates to the
      exact managed unit set.
  - Update diff, risk analysis, planning, copying, verification, and state replacement
    ignore unrelated repository siblings and root files. Missing or added managed-unit
    targets block instead of silently changing the active set.
- [x] `P17-07 [TERRA]` Persist static assessment evidence in install state and expose it
      to Agent Health.
  - Store status, finding count, assessment time, and policy version without secret or
    source-content values. Recompute it on every applied revision.
- [ ] `P17-08 [HUMAN+SOL]` Complete founder verification on the published package.
  - Test no-key Stable, Stable-to-Maximum overlay, quarantine output, project
    optimization, scoped update, credential-gated MCP configuration, health evidence,
    rollback, and clean uninstall on the founder's snapshotted real Codex profile.
  - Repeat the safe no-key journey with Claude, then collect one Windows and one Linux
    external session. Convert every reproducible failure into a regression test before
    public-release claims.
  - Partial 2026-07-17: the registry and clean external macOS install are verified for
    `0.2.0`; the published CLI loads the complete command surface, reports all 50
    catalog records, and completes its disposable install/rollback demo. Real founder
    Stable/Power/Maximum and Claude-profile exercises remain deliberately pending.
- [x] `P17-09 [TERRA implementation, LUNA copy review]` Make Power resilient and
      explain the product in beginner language before the `0.2.0` release.
  - Power now quarantines a rejected selected skill while retaining safe selected
    siblings from the same immutable collection, matching Maximum's unit-level
    isolation without weakening Stable's exact bounded default.
  - A live Codex preview prepares all eight Power collections and 50 skill directories,
    quarantines six individual units, and reports every overlap and approval boundary.
  - README now leads with install/mode/project/daily workflows, directly credits all
    50 upstream repositories, and distinguishes a new lead, an available update, and
    a comparison-backed replacement instead of treating popularity as proof.

Engineering checkpoint 2026-07-17: the complete local gate passes 103 test files/460
tests, packaged CLI smoke, the real CLI product journey, release-claim checks, and seven
1,000-skill scans at a 1.88-second p95. A real read-only Maximum preview against the 50
pinned catalog records prepared 29 repositories/1,158 Codex skill directories,
quarantined 50 invalid units while retaining safe siblings, deferred 19 MCP-only
records, and resolved 44 lower-ranked overlaps. Comparing that prepared plan with the
founder's 30 active Stable units found zero missing units and zero commit mismatches;
no real agent file was mutated.

## 19. Seven-day schedule

### Day 1: Foundation

- Repository, CI, schemas, fixtures, adapter contract, dashboard wireframe.
- Freeze MVP decisions by end of day.

### Day 2: Detection and catalog

- Six agent detectors.
- Seed catalog and conflict families.
- Dashboard shell and agent status.

### Day 3: Installation

- Package parsing, cache, transaction, snapshots.
- Claude and Codex skill adapters.

### Day 4: Breadth

- Remaining skill adapters.
- Claude/Codex/Cursor MCP planning.
- Stable and Maximum flows.

### Day 5: Updates and UI

- Update diff, sensitive-change policy, rollback.
- Finish four dashboard screens.

### Day 6: Verification

- Windows/macOS/Linux tests.
- Demo mode, risky update fixture, polish.
- Put incomplete advanced capabilities behind explicit experimental flags; preserve
  their backlog and code without exposing broken paths in the judge experience.

### Day 7: Submission

- Fix only critical defects.
- README, video, Devpost, feedback session ID.
- Submit with several hours of buffer.

## 20. Definition of done

The MVP is done only when a judge can:

1. Clone the repository.
2. Run documented setup successfully.
3. Launch Loadout without providing an account.
4. See detected agents or use isolated demo mode.
5. Scan existing skills and select Stable, Maximum Library, or Custom.
6. Preview exact planned changes.
7. Apply a real skill to at least Claude and Codex fixtures or installations.
8. Verify unrelated configuration survives.
9. View an update diff.
10. See a risky update blocked.
11. Roll back to byte-identical prior configuration.
12. Understand supported platforms and limitations from the UI and README.

## 21. Required tests

- Catalog schema validation.
- Ranking determinism.
- Conflict selection.
- Platform path resolution.
- Agent detection in fake home directories.
- Existing-skill inventory, ownership, fingerprint, duplicate, and capacity reporting.
- Skill parsing.
- MCP parsing.
- Path traversal rejection.
- Escaping-symlink rejection.
- Plan collision detection.
- Snapshot integrity.
- Interrupted transaction recovery.
- Unrelated config preservation.
- Idempotent second install.
- Tampered cache/hash rejection.
- Sensitive update classification.
- Rollback byte equality.
- Dashboard first-run flow.
- Windows, macOS, Linux CI.

## 22. Recorded product walkthrough

1. Show Claude, Codex, and Cursor with inconsistent/manual setup.
2. Run `npx loadout-ai` after npm publication, or `npx .` from the cloned repository.
3. Run the read-only scan and show actual skills, unmanaged content, duplicates, and
   overloaded profiles without changing anything.
4. Select Stable for daily use; show Maximum Library as an explicit stress/power-user
   option rather than the default.
5. Review repository count, actual skill count, overlaps, deferred MCP setup, and
   safety findings.
6. Approve; show the single-transaction success and restore point.
7. Show a newly discovered Trending repository.
8. Show a benign update and approve it.
9. Show a second update adding a hook and external domain; Loadout blocks it.
10. Trigger rollback and show restored healthy state.
11. Close with supported agents, operating systems, and future catalog vision.

## 23. Risks and mitigations

### Too much platform breadth

Mitigation: full skill support for six; MCP only for three; mark unsupported honestly.

### Corrupting user configuration

Mitigation: plan-only adapters, snapshots, staging, validation, automatic restore,
fixture-based tests, and disposable test homes isolated from the real profile.

### Supply-chain risk

Mitigation: curated catalog, immutable commits, hashes, no lifecycle scripts, static
checks, approval for new powers, no claims that stars imply safety.

### Weak differentiation from OpenPackage/skills installers

Mitigation: lead with one-command diagnosis of what the user already has, honest
provenance, evidence-backed comparison, reviewed-library versus active-set separation,
project optimization, automatic discovery tiers, update explanation, and rollback.

### Competing frontend and CLI behavior

Mitigation: keep one authoritative CLI product surface. The superseded dashboard and
its separate profile/mutation model were removed before the public release candidate.

### GitHub API rate limits

Mitigation: bundled offline catalog, caching, authenticated CI bot later, graceful
stale-data indicator.

### Team integration failure

Mitigation: shared schemas on day one, daily integration, ownership boundaries, CI,
small PRs, no long-lived branches.

## 24. Git workflow

- Default branch: `main`.
- Branches: `codex/<short-task>` or `<member>/<short-task>`.
- One backlog ID per PR where practical.
- PR description includes task ID, test evidence, screenshots for UI, and risks.
- Rebase or update before merge.
- Do not commit secrets, tokens, generated caches, or real user configuration.
- Require one teammate review for core transaction/security changes.
- Tag demo-ready checkpoints.

## 25. Immediate next tasks

Use the `Current remaining work` section at the top of this document. The next action
is founder acceptance testing with `docs/USER_TEST_GUIDE.md`; do not add a new hosted
service, provider dependency, or frontend surface until an observed user-testing issue
justifies it.
