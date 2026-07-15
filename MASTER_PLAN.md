# Loadout Master Plan

Status: Approved baseline for implementation  
Hackathon: OpenAI Build Week 2026  
Category: Developer Tools  
Team size: 3  
Target submission: July 21, 2026 at 5:00 PM Pacific / July 22 at 4:00 AM Dubai

## 1. Executive summary

Loadout is a universal extension manager for AI coding agents. It detects the agents
installed on a user's computer, discovers trusted skills and MCP tools from official
catalogs and high-signal GitHub repositories, installs them in the correct format,
keeps configurations synchronized, checks for updates, and restores a known-good
snapshot if an update fails.

The product is intentionally consumer-first. A user should not need to understand
`SKILL.md`, MCP configuration, plugin manifests, platform-specific directories, or
GitHub repository layouts. The primary experience is one command followed by one
choice:

```bash
npx loadout
```

```text
Detected: Claude Code, Codex, Cursor

Choose a setup:
1. Stable Boost
2. Maximum Boost
3. Custom
```

The hackathon MVP will prove the full loop with a curated catalog rather than trying
to index the entire internet: discover -> recommend -> install -> verify -> update ->
block an unsafe or incompatible update -> rollback.

## 2. Product thesis

Developers increasingly use multiple AI coding agents, but the ecosystem of skills,
plugins, agents, rules, and MCP tools is fragmented across GitHub, official
marketplaces, social media, and independent registries. Existing package managers
focus on files and packages. Loadout focuses on the outcome a user wants: make every
installed agent more capable without requiring manual discovery or configuration.

Loadout wins through:

1. A one-click consumer experience.
2. Broad agent and operating-system support.
3. A maintained Stable and Trending catalog.
4. Conflict-aware activation instead of blindly enabling every package.
5. Human-readable update and permission diffs.
6. Snapshots and rollback.
7. Optional project-aware recommendations without requiring GitHub access.

## 3. Product and delivery scope

### 3.1 Submission-critical vertical slice

- TypeScript CLI installable through `npx loadout`.
- Local React dashboard opened by the CLI.
- Windows 11, macOS, and Linux support.
- Agent detection for:
  - Claude Code
  - Codex
  - Cursor
  - Gemini CLI
  - OpenCode
  - Hermes
- Skill installation for all six agents where their supported layout is known.
- MCP configuration for Claude Code, Codex, and Cursor.
- Curated catalog containing 20-30 real packages.
- Stable, Trending, Official, and Community catalog tiers.
- Stable Boost, Maximum Boost, and Custom modes.
- Immutable package records pinned by Git commit SHA.
- Snapshot before the first mutation.
- Update detection and human-readable diff.
- Block at least one incompatible or risky update in the demo.
- One-command rollback.
- No GitHub login required for the core experience.
- Optional local-folder scan for project-aware recommendations.
- Clear display of `native`, `adapted`, and `unsupported` components.

### 3.2 Committed full-product scope

These are committed capabilities, not disposable ideas. The team attempts them after
the submission-critical vertical slice is integrated and passing. Any capability that
is incomplete at submission must remain behind an experimental flag rather than being
presented as production-ready.

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

Default path: Maximum Boost.

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

1. User runs `npx loadout`.
2. CLI checks Node version and operating system.
3. Loadout detects installed agents without modifying anything.
4. Loadout creates a backup of discovered configuration files.
5. Browser opens the local dashboard.
6. Dashboard shows detected agents and existing extensions.
7. User selects Stable, Maximum, or Custom.
8. Loadout shows a plan: packages, platforms, files, permissions, and conflicts.
9. User confirms.
10. Loadout downloads pinned sources into its cache.
11. Loadout stages all writes in a transaction directory.
12. Schemas and paths are validated.
13. Changes are atomically committed where the operating system permits.
14. Smoke tests run.
15. `loadout.lock` and a restore point are written.
16. Dashboard displays success and any components that require a restart.

### 5.2 Normal use

- `loadout status`: agents, packages, conflicts, and update health.
- `loadout add <package>`: plan and add a package.
- `loadout remove <package>`: remove only files managed by Loadout.
- `loadout update`: fetch catalog and package update information.
- `loadout update --plan`: make no changes; display proposed updates.
- `loadout rollback`: restore the previous snapshot.
- `loadout doctor`: validate configurations and dependencies.
- `loadout ui`: reopen the local dashboard.

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

### 9.1 Monorepo

```text
loadout/
├── apps/
│   ├── cli/                 # Commands and local HTTP server
│   └── dashboard/           # React/Vite local UI
├── packages/
│   ├── core/                # Plans, transactions, snapshots, lockfile
│   ├── catalog/             # Catalog schema, discovery, scoring
│   ├── adapters/            # One subfolder per agent
│   ├── scanners/            # Static safety and manifest checks
│   └── shared/              # Types, schemas, logging
├── catalog/
│   ├── packages.json        # MVP curated catalog
│   └── conflicts.json       # Conflict families and policies
├── fixtures/                # Fake home directories and package fixtures
├── tests/
├── README.md
├── MASTER_PLAN.md
└── loadout.lock.example
```

### 9.2 Suggested stack

- Node.js 22+
- TypeScript
- pnpm workspaces
- Commander or Clipanion for CLI
- React + Vite for dashboard
- Zod for runtime schemas
- Vitest for unit/integration tests
- Playwright for dashboard end-to-end tests
- TOML parser preserving unrelated configuration where possible
- JSON/JSONC parser that preserves comments where required
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

- [x] `P0-01 [LUNA]` Add pnpm workspace skeleton matching section 9.1.
  - Acceptance: `pnpm install` succeeds and every workspace has a placeholder test.
- [x] `P0-02 [LUNA]` Add `.gitignore`, `.editorconfig`, Prettier, and ESLint defaults.
  - Acceptance: formatting and lint commands run at repository root.
- [x] `P0-03 [TERRA]` Add GitHub Actions matrix for Node on Windows, macOS, Linux.
  - Acceptance: install, lint, typecheck, and tests run on all three.
- [ ] `P0-04 [HUMAN]` Add all three teammates to the private repository.
- [ ] `P0-05 [HUMAN]` Protect `main` after the first working CI run.

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
- [x] `P6-05 [TERRA]` `loadout apply` with confirmation.
- [x] `P6-06 [TERRA]` `loadout add` and `loadout remove`.
- [x] `P6-07 [TERRA]` `loadout update --plan`.
- [x] `P6-08 [TERRA]` `loadout rollback`.
- [x] `P6-09 [LUNA]` CLI snapshot tests for help and error messages.
- [x] `P6-10 [SOL]` Review destructive command confirmation and recovery behavior.

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
- [x] `P11-09 [TERRA]` Implement background update service and notifications.
  - `loadout watch` performs read-only interval checks and emits human or JSON notifications; it never applies updates automatically.
- [x] `P11-10 [SOL]` Define catalog signing, rotation, and compromise recovery.
- [x] `P11-11 [TERRA]` Implement catalog signing in CI and verification in client.
- [x] `P11-12 [SOL]` Design cross-platform hook/subagent compiler with loss reports.
- [ ] `P11-13 [TERRA]` Implement first two hook/subagent conversion targets.
- [x] `P11-14 [SOL]` Design sandbox threat model for third-party installers.
- [ ] `P11-15 [TERRA]` Implement disposable sandbox runner with no host secrets.
- [x] `P11-16 [SOL]` Design OS-keychain-backed credential interface.
- [ ] `P11-17 [TERRA]` Implement macOS, Windows, and Linux credential backends.
- [x] `P11-18 [SOL]` Define autonomous-update permission policies and recovery rules.
- [ ] `P11-19 [TERRA]` Implement policy-gated canary update pipeline.
- [x] `P11-20 [SOL]` Publish adapter SDK and conformance contract.
- [ ] `P11-21 [TERRA]` Add the next six agent adapters through the SDK.
- [ ] `P11-22 [TERRA]` Add compliant Hacker News and community-source connectors.
- [x] `P11-23 [SOL]` Design team/enterprise policy and audit schemas.
- [x] `P11-24 [TERRA]` Implement shared Loadouts, allowlists, denylists, and audit view.
  - Manifest policy now enforces package/repository allowlists and denylists before synchronization; existing audit output remains the read-only decision view.

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
5. Select Stable or Maximum Boost.
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

## 22. Demo script

1. Show Claude, Codex, and Cursor with inconsistent/manual setup.
2. Run `npx loadout`.
3. Dashboard detects agents and shows missing capabilities/conflicts.
4. Select Maximum Boost.
5. Preview packages and platform compatibility.
6. Apply; show synchronized success and restore point.
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
fixture-based tests, demo mode isolated from the real home directory.

### Supply-chain risk

Mitigation: curated catalog, immutable commits, hashes, no lifecycle scripts, static
checks, approval for new powers, no claims that stars imply safety.

### Weak differentiation from OpenPackage/skills installers

Mitigation: lead with one-click diagnosis, Stable/Maximum outcomes, automatic
discovery tiers, conflict resolution, update explanation, and rollback.

### Dashboard consumes too much time

Mitigation: four screens only; CLI remains source of truth; no cloud accounts.

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

1. Assign Track A/B/C owners.
2. Complete P0 repository tasks.
3. Complete P1-01 and P2-01 architecture contracts with Sol/Extra High review.
4. Give Luna the fixture, catalog-record, and repository-configuration tasks.
5. Give Terra the first implementations after interfaces are approved.
6. Integrate one thin vertical slice before expanding platform breadth:
   detect -> plan -> install one skill -> snapshot -> rollback -> display in UI.
