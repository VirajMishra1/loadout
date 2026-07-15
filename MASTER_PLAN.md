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
- Skill installation for all six agents where their supported layout is known.
- MCP configuration for Claude Code, Codex, and Cursor.
- Curated catalog containing 20 pinned real repositories.
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
- [ ] `P1-11 [TERRA]` Expand from 20 to at least 50 fully reviewed catalog records.
  - Every record needs immutable commit, license review, component evidence, platform
    evidence, and an install/config path; popularity alone is insufficient.

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
- [ ] `P11-17 [TERRA]` Implement macOS, Windows, and Linux credential backends.
- [x] `P11-18 [SOL]` Define autonomous-update permission policies and recovery rules.
- [x] `P11-19 [TERRA]` Implement a policy-gated canary planning pipeline.
  - `loadout canary` performs a non-mutating static gate; promotion requires explicit approval plus injected verification and transaction callbacks, so it cannot silently update agent files.
- [x] `P11-20 [SOL]` Define the internal adapter contract and conformance tests.
  - `src/core/adapters.ts`, the shared capability matrix, compatibility policy, and
    conformance tests are the implemented contract. A separately versioned public SDK
    package and community registry are not yet published.
- [ ] `P11-21 [TERRA]` Add the next six agent adapters through the SDK.
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
    the environment credential only at the explicit verification boundary.
- [x] `P12-22 [TERRA]` Add reviewed MCP setup recipes and connection verification.
  - `mcp-recipe` provides source-linked Playwright and GitHub read-only recipes,
    previews commands, permissions, environment names, and target config without
    printing values, and separates authorization from configuration. It preserves
    unrelated JSON keys and verifies the configured transport/references without
    launching a server; the existing Codex MCP planner remains the TOML-preserving
    path.
- [ ] `P12-23 [TERRA]` Complete P11-17 keychain backends and connect them to provider,
      private-discovery, registry, and MCP workflows.
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
- [ ] `P12-26 [TERRA]` Polish the CLI as the sole required product surface.
  - Consistent progress, compact tables, accessible color/no-color output, actionable
    errors, interruption handling, shell completion, noninteractive JSON, and terminal
    widths from 80 to 200 columns.
  - Partial: the primary workflows are CLI-only, dry-run first, JSON-capable, and
    actionable. Shell completion, width-aware tables, signal cleanup, and explicit
    color policy remain.
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
- [ ] `P12-29 [TERRA]` Complete P1-11 with at least 50 reviewed records and capability
      coverage metrics.
  - Measure unique capabilities, overlap, licenses, immutable commits, install shape,
    platforms, activity, and evaluation readiness rather than raw repository count.
- [ ] `P12-30 [HUMAN]` Complete legal/license attribution review, including all current
      `NOASSERTION` records, before distribution.
- [ ] `P12-31 [TERRA]` Publish `loadout-ai` to npm and run clean-machine package tests
      from outside the repository on macOS, Windows, Linux, and Node 20/22.
- [ ] `P12-32 [HUMAN]` Run moderated founder testing on the real Claude and Codex
      profiles with snapshots and explicit rollback checkpoints.
- [ ] `P12-33 [HUMAN]` Run at least ten external user tests spanning new users, power
      users, Windows, macOS, Linux, one-agent, and multi-agent setups.
- [ ] `P12-34 [SOL]` Public-beta go/no-go review.
  - Required: zero known destructive data-loss defects; every mutation previewed and
    recoverable; no false “best” or compatibility claims; install/optimize/rollback
    success on all supported platforms; p95 local scan under five seconds for 1,000
    skills; actionable failure messages; npm provenance and attribution complete.

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

## 22. Demo script

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
fixture-based tests, demo mode isolated from the real home directory.

### Supply-chain risk

Mitigation: curated catalog, immutable commits, hashes, no lifecycle scripts, static
checks, approval for new powers, no claims that stars imply safety.

### Weak differentiation from OpenPackage/skills installers

Mitigation: lead with one-command diagnosis of what the user already has, honest
provenance, evidence-backed comparison, reviewed-library versus active-set separation,
project optimization, automatic discovery tiers, update explanation, and rollback.

### Dashboard consumes too much time

Mitigation: stop feature investment in the dashboard for the hackathon. The CLI is the
only required surface; the existing dashboard remains optional diagnostics.

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

1. Complete P12-15 through P12-18: category-specific signed evaluations, daily
   multi-source queue refresh, star-velocity prioritization, and evaluation-backed
   replacement alerts.
2. Complete P12-22 and P12-23: reviewed MCP recipes, connection verification, and
   selected native keychain backends.
3. Finish P12-26, P12-27, and P12-29: CLI polish, CLI-first demo, at least 50
   reviewed catalog records, and capability coverage metrics.
4. Fix and regression-test every issue found by real Claude/Codex founder testing
   before expanding the default catalog or enabling scheduled work.
5. Complete P10-05 through P10-10: license review, demo recording, Codex usage
   explanation, feedback session ID, Devpost fields, and submission.
6. Have the repository owner choose npm publishing credentials, publish
   `loadout-ai`, and immediately verify the interactive `npx loadout-ai` setup from
   outside the repository on clean machines.
7. Resolve P0-05 when repository visibility or the GitHub plan permits branch
   protection.
8. Implement P11-17 only after selecting and threat-modeling real macOS, Windows,
   and Linux keychain integrations.
9. Design and add the six P11-21 adapters from official path/config documentation;
   do not infer support from repository popularity.
10. Expand P1-11 with reviewed skill and MCP sources, measuring unique capabilities and
    overlap rather than treating GitHub stars or raw repository count as quality.
11. Run real user testing from disposable profiles, record every failure, and feed
    reproducible defects into `loadout improve` and the regression suite.
