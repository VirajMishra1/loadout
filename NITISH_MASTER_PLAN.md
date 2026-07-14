# Loadout — Nitish Product and Implementation Plan

Status: active implementation plan for `dev/nitish`  
Branch boundary: all work stays on `dev/nitish` until Nitish reviews it and opens a PR  
Product position: OpenPackage-compatible package management plus safer installs, explainable updates, recovery, health checks, tested recommendations, and continuous catalog improvement

Current evidence: manifest/lock portability includes validated `export` and dry-run-first
`import`, with secret screening, atomic writes, overwrite protection, and recovery snapshots.
The native CI matrix covers Windows, macOS, and Linux on Node 20 and 22.

## 1. Product promise

Loadout is a universal package manager and safety control center for AI coding agents.
It should install and manage skills, commands, rules, agents, plugins, and MCP servers
across Codex, Claude Code, Cursor, Gemini CLI, OpenCode, and other adapters.

It must match the everyday package-manager workflow:

`discover -> inspect -> install -> list -> update -> remove -> publish -> sync`

Loadout adds a safety and reliability workflow around every mutation:

`scan -> explain -> approve -> snapshot -> apply -> verify -> monitor -> rollback`

## 2. Success criteria

A complete release must let a new user:

1. Detect installed agents and inspect their health.
2. Create or import one shareable Loadout manifest.
3. Install packages from the catalog, GitHub, git URLs, and local paths.
4. Handle skills, commands, rules, agents, plugins, and MCP definitions.
5. Preview every file and configuration change.
6. See conflicts, scripts, domains, environment names, executables, and permissions.
7. Apply changes transactionally without damaging unrelated configuration.
8. Reproduce the same setup from an exact lockfile on another machine.
9. List, update, reconcile, and remove only Loadout-managed content.
10. Restore byte-identical prior state with one rollback command.
11. Choose tested profiles such as Stable, Web, Research, or Maximum.
12. Receive project-aware recommendations with plain-language reasons.
13. Publish and consume versioned community packages.
14. Run locally without an account for all public-package features.

## 3. Product layers

### Layer A — universal package manager

- Sources: catalog id, GitHub repository/path/ref, generic git URL, local directory,
  and Loadout registry package/version.
- Components: skills, rules, commands, agents/subagents, plugins, MCP servers, and
  explicitly declared root files.
- Scopes: user/global and project/local.
- Operations: init, inspect, plan, install, list, remove, sync, update, create,
  pack, publish, search, and import/export.
- Dependencies: production and development dependencies with cycle detection,
  deterministic resolution, and collision policies.
- Adapters: a documented capability matrix and honest native/adapted/unsupported
  results for every component and agent.
- Reproducibility: immutable sources, SHA-256 file records, and `loadout.lock`.

### Layer B — safer and more reliable than a normal package manager

- Read-only inspection before mutation.
- Static scanning for scripts, hooks, binaries, domains, environment names,
  suspicious instructions, path traversal, symlink escapes, and secrets.
- Human-readable permission and behavior summaries.
- Plan collision detection across all selected packages.
- Staging, validation, atomic replacement where supported, and automatic recovery.
- Snapshots before every mutation and exact rollback.
- Drift detection when managed files are changed outside Loadout.
- Update inbox with safe/review/block classifications.
- Publisher, source, signature, and scan evidence shown separately from popularity.

### Layer C — additional Loadout capabilities

- `loadout health`: one clear report for agents, packages, updates, drift, conflicts,
  unsafe components, configuration, and restore readiness.
- Tested Loadouts: curated profiles whose components are compatibility-tested together.
- Repository-aware recommendations based on local files only by default.
- Team mode: commit the manifest and lockfile, then reproduce or audit them in CI.
- Policy files: allow/deny publishers, sources, domains, commands, and risk levels.
- Update automation similar to dependency bots: produce a reviewable update proposal,
  never silently grant new powers.
- Catalog evidence: maintenance, publisher identity, compatibility results, scan time,
  scan engine versions, and known limitations.

## 4. Core files and formats

### `loadout.json`

The human-edited desired state. It contains schema version, scope, enabled agents,
packages and source constraints, profiles, conflict policy, and safety policy.

### `loadout.lock`

The machine-written resolved state. It contains exact source commit/version, package
content digest, dependencies, component inventory, target paths, and scan evidence.
Secret values are never written to either file.

### Local state

`~/.loadout/` contains cached immutable sources, snapshots, staged transactions,
installed-file hashes, catalog data, and non-secret logs. Project state never assumes
that a developer's home directory may be committed.

## 5. Architecture

- CLI: command parsing and plain-language output only.
- Core resolver: turns all source types into immutable package snapshots.
- Parser: creates one normalized component graph.
- Adapter registry: translates normalized components into agent-specific plans.
- Planner: merges plans, detects conflicts, scans risk, and produces a safe preview.
- Transaction engine: snapshots, stages, validates, commits, verifies, and restores.
- State/lock engine: records ownership, hashes, exact sources, and dependencies.
- Health engine: combines detection, state integrity, updates, conflicts, and policy.
- Recommendation engine: maps project signals and user profiles to catalog packages.
- Catalog/registry: metadata and immutable package records; registry code is optional
  for local/public GitHub usage.
- Local API/dashboard: presents the same core operations; the CLI remains authoritative.

## 6. Delivery phases

### Phase 1 — trustworthy local foundation

- Finish manifest and lockfile schemas with runtime validation.
- Add installed-package listing, drift detection, safe removal, and reconciliation.
- Make multi-package installation one transaction instead of independent writes.
- Add staging and post-apply verification.
- Apply safe updates while requiring explicit override for blocked findings.
- Expand health/doctor output and machine-readable forms.

### Phase 2 — OpenPackage feature parity

- Normalize rules, commands, agents, plugins, MCP, and root files.
- Add project/global scopes and full adapter capability matrix.
- Add git/local/registry sources, refs, subpaths, dependencies, and lock resolution.
- Add init, sync, search, create, pack, publish, and import/export commands.
- Build registry API and signed immutable package storage.

### Phase 3 — Loadout differentiation

- Add pluggable security scanners and a local baseline scanner.
- Add policies, trust evidence, quarantine, and update inbox.
- Add tested profiles and compatibility fixtures.
- Add project-aware recommendations and explain every recommendation.
- Add team CI audit and update-proposal workflows.

### Phase 4 — platform breadth and product UI

- Pass adapter conformance suites for each claimed platform.
- Complete interactive dashboard progress events and richer per-file review (safe
  preview/apply/rollback with a session token is implemented).
- Verify Windows, macOS, and Linux using native CI fixtures.
- Add accessibility, recovery UX, offline behavior, and performance gates.

### Phase 5 — ecosystem and continuous improvement

- Publisher verification, reports, moderation, signatures, and revocation.
- Anonymous opt-in failure/compatibility evidence with no secrets or source content.
- Adapter SDK and community conformance program.
- Scheduled catalog refresh and regression tests.

## 7. Self-improving loop

The loop improves evidence and reliability; it does not autonomously rewrite or deploy
unreviewed code.

1. **Observe:** collect local, non-secret health results, failed compatibility tests,
   stale catalog entries, update candidates, and user-approved feedback.
2. **Prioritize:** rank problems by users affected, safety severity, reproducibility,
   and confidence of the evidence.
3. **Propose:** generate a small issue or update proposal containing evidence,
   acceptance tests, risk, and rollback instructions.
4. **Implement:** work on a developer branch with the narrowest complete change.
5. **Verify:** run unit, integration, adapter, security, cross-platform, and demo tests.
6. **Review:** require a human for product judgment, new permissions, registry trust,
   compatibility claims, or deployment.
7. **Release safely:** sign catalog/package artifacts, preserve old versions, and
   prepare rollback before rollout.
8. **Learn:** compare expected and actual outcomes, add regression fixtures, update
   compatibility evidence, and repeat.

### Loop prompt template

```text
You are improving Loadout using evidence, not guesses.

Inputs:
- current manifest, lockfile, health report, test results, catalog evidence
- unresolved failures and user-approved feedback
- supported-agent capability matrix and safety policy

For each loop:
1. Select the highest-impact unresolved problem supported by evidence.
2. State the user harm, root cause, desired outcome, and acceptance tests.
3. Inspect current behavior before editing.
4. Implement the smallest complete solution without weakening safety.
5. Add regression tests and plain-language documentation.
6. Run all relevant verification and record exact evidence.
7. Stop for human review if permissions, trust, compatibility claims, or release
   behavior changes.
8. Never expose secrets, execute untrusted package code, rewrite Git history, force
   push, or merge branches automatically.
9. If verification fails, keep iterating or restore the known-good state.
10. Report what changed, what remains, risks, and the next evidence-backed priority.
```

## 8. Quality gates

- Every mutation has a dry-run plan and snapshot.
- Every managed file has ownership and a recorded digest.
- Install, update, remove, sync, and rollback have failure-injection tests.
- Every adapter has fixtures for each claimed native component.
- No third-party lifecycle script runs during discovery or installation.
- No secret value appears in plans, state, logs, API results, or any artifact intended
  for sharing. Private recovery snapshots may contain exact pre-change bytes required
  for rollback and must remain local with owner-only file permissions; encrypted
  snapshots are required before any remote backup feature.
- No compatibility or safety claim is made without dated evidence.
- All supported operating systems build and pass their relevant tests.
- Documentation distinguishes complete, experimental, and planned behavior.

## 9. Branch and review policy

- Nitish implementation branch: `dev/nitish` only.
- Temporary Nitish branches may start from and return to `dev/nitish`.
- Push only to `origin/dev/nitish` unless Nitish explicitly requests otherwise.
- Nitish reviews the completed branch before opening a PR to `develop`.
- `develop` is integration/testing; `main` receives only approved stable work.
- Never force-push, rewrite shared history, or merge automatically.

## 10. Immediate implementation order on this branch

1. Manifest and lockfile.
2. List, health, drift, remove, and sync.
3. Multi-package transaction and applied updates.
4. Recommendations and tested profiles.
5. Normalized additional component types and adapters.
6. Source/dependency/registry parity.
7. Security plugins, policies, and quarantine.
8. Complete dashboard and cross-platform verification.
