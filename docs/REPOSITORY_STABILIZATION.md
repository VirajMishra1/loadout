# Repository stabilization record

Status date: 2026-07-19. This document records evidence gathered while consolidating
the repository. `MASTER_PLAN.md` is the only active plan; this is an audit record, not
a second backlog.

## Starting synchronization inventory

The investigation fetched all visible branches and tags before making cleanup
decisions. The starting GitHub default was `main` at
`189cb7a0e918860fc37bb92639126b93b387abec` (`v0.3.2`).

| Local branch/worktree                             | Starting head | Tracking state                                              | Starting disposition                        |
| ------------------------------------------------- | ------------- | ----------------------------------------------------------- | ------------------------------------------- |
| `codex/readme-truth`, `/tmp/loadout-readme-truth` | `ee8d548`     | 29 ahead of `origin/main`, clean                            | Preserve and integrate                      |
| `dev/nitish`, user checkout                       | `69b8fe7`     | one ahead of `origin/dev/nitish`; untracked `.superpowers/` | Preserve user state and safety requirements |
| local `main`                                      | `d2a11d8`     | 101 behind `origin/main`                                    | Fast-forward after integration              |
| local `develop`, `dev/amartya`, `dev/viraj`       | `d2a11d8`     | stale or merged                                             | Remove after final-main verification        |

No local commit was treated as remote merely because it existed in a worktree.

## Failure ledger

| Failure                                                                                           | Reproduction/evidence                                                                                                                                                                                                                                                                                                                                            | Root cause/classification                                                                   | Resolution/status                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Risky setup preview omitted `--approve-risk`                                                      | Prepared risky catalog plan printed an incomplete rerun command                                                                                                                                                                                                                                                                                                  | Product guidance defect                                                                     | Fixed in `1f62a1b`; regression test derives guidance from the prepared plan                                                                                                          |
| Unknown command ran default onboarding                                                            | Unknown positional top-level command reached the root action                                                                                                                                                                                                                                                                                                     | CLI routing defect                                                                          | Fixed in `1f62a1b`; unknown commands fail non-zero while bare invocation remains valid                                                                                               |
| Explicit rollback could erase later user changes                                                  | Persisted snapshots recorded only pre-mutation bytes                                                                                                                                                                                                                                                                                                             | Product data-safety defect                                                                  | Fixed in `1f62a1b`; committed post-state is checked before user-requested rollback                                                                                                   |
| Dashboard and special-file rollback bypasses                                                      | Default dashboard restore omitted the guard; nested FIFOs/sockets/devices were skipped                                                                                                                                                                                                                                                                           | Product data-safety defect                                                                  | Fixed in `6fd1a2c`; dashboard and unsupported-entry regressions pass                                                                                                                 |
| `dev/nitish` adoption preview covered only `SKILL.md` while ownership covered the whole directory | Deletion review traced preview through apply and `recordInstall`; auxiliary drift, cloned-plan forgery, and review over-attribution were reproducible                                                                                                                                                                                                            | Product ownership/integrity defect; valuable safety intent existed only on the stale branch | Fixed in the current architecture by `186daa0`, `09e0e0c`, `3f2cafe`, and `10d6109`; focused and full verification pass                                                              |
| Fresh-clone live Stable rollback refused on `state.json`                                          | `npm run check:live -- --stable-install` installed four pinned packages, then refused the Stable snapshot because later state differed                                                                                                                                                                                                                           | Product transaction-boundary defect plus invalid non-LIFO evidence-flow ordering            | `5f8e38e` records profile state inside the catalog transaction and rolls Stable back before unrelated fixture transactions; exact state and managed-root drift checks remain enabled |
| Windows snapshot-root test used a POSIX fixture                                                   | CI run `29502017220` executed at `41b53e0`; Windows reported “absolute normalized path” before the test's expected “filesystem root” message                                                                                                                                                                                                                     | Test portability defect, not a runtime rollback failure                                     | `c5fe192` changed the fixture to the host filesystem root; rerun `29502324100` passed                                                                                                |
| Recent GitHub CI and discovery runs did not start                                                 | Earlier blocked runs plus CI runs [`29691581581`](https://github.com/VirajMishra1/loadout/actions/runs/29691581581) and [`29692535521`](https://github.com/VirajMishra1/loadout/actions/runs/29692535521) have no executed steps; both CI annotations say the job was not started because recent account payments failed or the spending limit must be increased | GitHub account billing/spending-limit condition                                             | External failure; no product-test result was produced                                                                                                                                |
| `loadout-ai@0.3.2` unavailable                                                                    | npm registry version list ends at `0.3.1`; bounded live evidence records the same result                                                                                                                                                                                                                                                                         | Package publication                                                                         | Not verified; publish and test the exact tarball externally                                                                                                                          |
| `main` protection unavailable                                                                     | GitHub branch-protection endpoint returns 404                                                                                                                                                                                                                                                                                                                    | Repository setting/authorization                                                            | Absent or not observable; requires owner decision                                                                                                                                    |

Internal failed-transaction recovery deliberately restores the pre-mutation snapshot
without the later-drift guard. The guard applies to user-requested CLI, dashboard, and
runtime-tool rollback. Legacy snapshots fail closed for those explicit paths.

## Recent Viraj commits and GitHub Actions

The recent Viraj changes were inspected as code and exercised locally; commit messages
were not used as proof.

| Commit    | Implemented area                                                                                     | Main/Actions evidence                                                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `817c38f` | Public-beta CLI, package, credential, catalog, and release foundation                                | In `main`; CI run `29486160804` passed                                                                                                                                              |
| `9798f1c` | Continuous discovery, generated catalog evidence, and snapshot hardening                             | In `main`; CI run `29491118338` passed                                                                                                                                              |
| `6994d4e` | Candidate intelligence, signed catalog release, locking, and transaction hardening                   | In `main`; CI run `29497632211` passed                                                                                                                                              |
| `41b53e0` | Stable profile, daily autopilot, and release workflow                                                | In `main`; CI run `29502017220` failed on the Windows-only test fixture described above                                                                                             |
| `c5fe192` | Host-portable snapshot root guard test                                                               | In `main`; CI rerun `29502324100` passed                                                                                                                                            |
| `4e93f5d` | Cross-platform release-matrix documentation                                                          | In `main`; CI run `29502646004` passed                                                                                                                                              |
| `05e52a4` | Expanded Stable profile and reviewed Graphify recipe                                                 | In `main`; CI run `29505093720` passed                                                                                                                                              |
| `f7f53fa` | Release-work documentation clarification                                                             | In `main`; CI run `29505532691` was cancelled after a newer push; no product failure was produced                                                                                   |
| `e35b8ff` | Upgrade, health-score, benchmark-campaign, and discovery foundation                                  | In `main`; CI run `29508916710` passed                                                                                                                                              |
| `3cb5505` | Trust, intelligence, benchmark, import, and skill-security systems                                   | In `main`; CI run `29520771134` passed                                                                                                                                              |
| `8e80ab4` | npm beta metadata and package-smoke adjustment                                                       | In `main`; CI run `29522705571` passed                                                                                                                                              |
| `1fe9890` | Codex Desktop installation detection                                                                 | In `main`; CI run `29524710934` and discovery run `29557150915` passed                                                                                                              |
| `e4e469e` | Credential-aware setup, Maximum quarantine, and managed update scoping                               | In `main`; CI run `29583273859` passed                                                                                                                                              |
| `ebb8133` | Unit-level Power quarantine and onboarding rewrite                                                   | In `main`; CI run `29585379546` passed                                                                                                                                              |
| `88466ef` | npm `0.2.0` verification documentation                                                               | In `main`; CI run `29586111523` passed                                                                                                                                              |
| `cf406e8` | Safe Stable/profile setup reruns                                                                     | In `main`; CI run `29588415904` passed                                                                                                                                              |
| `a016c0f` | Exact managed-profile reconciliation                                                                 | In `main`; CI run `29590309101` passed                                                                                                                                              |
| `33225ef` | Large rollback-snapshot validation                                                                   | In `main`; CI run `29591059217` passed                                                                                                                                              |
| `15f36e3` | Pinned Graphify generated fallback                                                                   | In `main`; CI run `29591567247` passed                                                                                                                                              |
| `16b8a7e` | Beginner and advanced CLI routing                                                                    | In `main`; covered by current CLI tests                                                                                                                                             |
| `31cb755` | Saved-profile updates and complete uninstall                                                         | In `main`; its CI job never started because of billing                                                                                                                              |
| `56ab3af` | Separation of model API keys from service credentials                                                | In `main`; its CI job never started because of billing                                                                                                                              |
| `189cb7a` | Recursively empty skill-directory recovery                                                           | In `main`; its CI job never started because of billing                                                                                                                              |
| `e74ba16` | Consolidated README truth, lifecycle hardening, safety fixes, adoption integrity, and cleanup record | Current remote `main`; CI run [`29692535521`](https://github.com/VirajMishra1/loadout/actions/runs/29692535521) failed before steps because of the billing/spending-limit condition |
| `5f8e38e` | Transactional installed-profile state and valid live Stable rollback ordering                        | Tested local `main`; pending remote synchronization                                                                                                                                 |

Earlier green runs prove their own commits only. They do not prove later commits that
GitHub never executed. Current local verification and future post-integration Actions
must remain separately reported.

## Branch cleanup results

There is one merged PR: [#1](https://github.com/VirajMishra1/loadout/pull/1),
`dev/nitish` into `develop`, merged as `69594f2`; its recorded Linux, macOS, and
Windows Node 20/22 jobs passed. There are no open PRs.

| Branch                                    | Unique work relative to starting `origin/main`                                                                                                    | Final result                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `codex/readme-truth`                      | README evidence, adapter/product-flow coverage, release hardening, safety fixes, and consolidation                                                | Integrated into `main`; local and remote branch deleted                          |
| `dev/nitish`                              | Its one real adoption-integrity gap is fully reimplemented and tested by `186daa0`, `09e0e0c`, `3f2cafe`, and `10d6109`; no valuable work remains | Local and remote branch deleted; unrelated `.superpowers/` preserved and ignored |
| `codex/cli-ux-polish`                     | None; tip `31cb755` is in main                                                                                                                    | Local and remote branch deleted                                                  |
| `codex/fix-large-snapshot-validation`     | None; tip `33225ef` is in main                                                                                                                    | Local and remote branch deleted                                                  |
| `codex/fix-profile-reconciliation`        | None; tip `a016c0f` is in main                                                                                                                    | Local and remote branch deleted                                                  |
| `codex/fix-stable-rerun`                  | None; tip `cf406e8` is in main                                                                                                                    | Local and remote branch deleted                                                  |
| `codex/harden-graphify-generated-install` | None; tip `15f36e3` is in main                                                                                                                    | Local and remote branch deleted                                                  |
| `dev/amartya`                             | Integrated through `6161c48` and later follow-ups                                                                                                 | Local and remote branch deleted                                                  |
| `dev/viraj`                               | Old main ancestor                                                                                                                                 | Local and remote branch deleted                                                  |
| `develop`                                 | Old integration ancestor                                                                                                                          | Local and remote branch deleted                                                  |

Cleanup completed only after the integrated work reached remote `main` and the open-PR
list was empty. Git now exposes only local `main`, `origin/main`, and the retained
release tags. The `/tmp/loadout-readme-truth` worktree was removed. The user's
untracked `.superpowers/` directory remains present and is ignored by `.gitignore`;
no user artifact was deleted.

## Planning and dead-file consolidation

`MASTER_PLAN.md` is authoritative because Viraj created it, maintained it across the
project history, linked it from README, and explicitly labeled its top section as the
active list. The removed files were unreferenced or self-described historical plans
whose implementation/status had moved elsewhere.

| Removed file                                         | Evidence for deletion                                   | Preserved outcome                                            |
| ---------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| `NITISH_MASTER_PLAN.md`                              | Unreferenced; stale `dev/nitish`/`develop` policy       | Durable safety work is in the master plan and implementation |
| `SIMPLE_PLAN.md`                                     | Duplicate summary that named `MASTER_PLAN.md` canonical | README retains the user-facing summary                       |
| `docs/plans/2026-07-18-release-0.3.md`               | Completed code plan with stale merge/publish boxes      | External publication remains explicit in the master plan     |
| `docs/superpowers/plans/2026-07-18-cli-ux-polish.md` | Implemented on main; stale commit/verify boxes          | Founder testing remains explicit in the master plan          |
| README truth implementation plan and design          | Implemented, reviewed, and encoded by tests/evidence    | Current status is in the master plan and release evidence    |

Operational contracts such as `docs/TESTING.md`, `docs/FEATURE_TEST_MATRIX.md`,
`docs/RELEASE_REVIEW.md`, policy documents, and machine-readable evidence remain.

## README research and redesign evidence

Current upstream READMEs inspected:

- [Ponytail](https://github.com/DietrichGebert/ponytail#readme): strong outcome,
  before/after, reproducible benchmark links, corrections, and host-specific removal;
  reject absolute safety jokes and its long uncollapsed install wall.
- [uv](https://github.com/astral-sh/uv#readme): adopt concise highlights,
  platform-specific install paths, real transcripts, and readiness/version links.
- [mise](https://github.com/jdx/mise#readme): adopt compact navigation; do not hide
  Loadout's safety boundaries behind an ultra-thin documentation handoff.
- [pnpm](https://github.com/pnpm/pnpm#readme): adopt mechanism-backed benefits and
  linked benchmarks; avoid sponsor clutter and unbounded platform language.
- [Semgrep](https://github.com/semgrep/semgrep#readme): adopt explicit security,
  local-data, metrics, and capability boundaries; avoid marketing-stat density.
- [Aider](https://github.com/Aider-AI/aider#readme): adopt a real workflow visual and
  feature-to-documentation links; avoid testimonial walls and stale model advice.
- [ripgrep](https://github.com/BurntSushi/ripgrep#readme): adopt precise defaults,
  exclusions, overrides, and platform wording.

The recommended Loadout order is: one-sentence outcome and status; compact navigation;
source-checkout quickstart while npm `0.3.2` is unavailable; a tested
preview/apply/list/rollback transcript; modes; trust/data boundaries; compatibility;
state and architecture; commands; limitations/evidence; troubleshooting/uninstall;
development, security reporting, attribution, and license. The full 12-agent matrix
belongs below the quickstart, not before it. Use one reproducible terminal recording,
not a decorative or mocked dashboard image.

## Current external truth

- GitHub default branch: `main`; local `main`, `origin/main`, and the remote branch all
  resolved to `e74ba1676ee63cea48e6a22b08318580eebe8fda` after cleanup. Local
  `main` now contains tested commit `5f8e38e`; `origin/main` remains at the prior
  synchronized commit until the next push.
- Branches and PRs: only `main` exists locally and remotely; there are no open PRs.
- npm: versions through `0.3.1`; `0.3.2` is not verified as published.
- GitHub Actions: CI run [`29691581581`](https://github.com/VirajMishra1/loadout/actions/runs/29691581581)
  for `4fdc473` and the newer run [`29692535521`](https://github.com/VirajMishra1/loadout/actions/runs/29692535521)
  for `e74ba16` both failed before any step ran. Their annotations state that recent
  account payments failed or the spending limit must be increased. These runs provide
  no product-test result.
- Branch protection: 404 from the protection endpoint; absent or not observable.
- Native application consumption of every configured adapter path remains unverified;
  disposable filesystem lifecycle evidence must not be promoted into a native-host
  support claim.

## Local verification after consolidation

On 2026-07-19, `npm run verify:full` completed successfully on macOS with Node 25.4.0:

- formatting, lint, type checking, build, catalog/discovery evidence, README claims,
  and release claims passed;
- 112 Vitest files passed with 589 tests passing and one intentionally skipped;
- CLI and README product flows passed;
- packaged CLI smoke passed;
- the 1,000-skill scan benchmark passed at 240.5 ms p95 across seven CLI runs; and
- both desktop Chromium and mobile Chromium dashboard tests passed.

The fresh-clone live Stable gate also installed four pinned packages and completed
state and filesystem rollback assertions at `5f8e38e`. An initially considered
state-ignore fix was rejected during independent review because restoring an old
registry while leaving later package files could orphan installations. The final fix
keeps exact `state.json` and managed-root drift protection, includes installed-profile
state in transaction post-evidence, and uses strict LIFO ordering in the live flow.

An npm dry-run contained 137 entries, included this record and `MASTER_PLAN.md`, and
excluded every deleted plan. These local results do not substitute for GitHub Actions,
the unpublished `0.3.2` npm tarball, native-host acceptance, or branch protection.
