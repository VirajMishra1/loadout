# Loadout — remaining work

Current version: **0.7.0** (published). Working tree and CI green at time of
writing. This file is the backlog; it is not shipped in the npm package.

Ordering reflects risk, not effort. Items 1–3 should land before the next
public release; 4–7 before promoting the project publicly.

---

## 1. Bound every network and Git operation — P1 security

**Problem.** `src/core/install/source.ts:262` makes time, byte, and file limits
optional, and most callers pass nothing. Affected paths include
`src/core/install/sync.ts:299` and `src/commands/mcp.ts:387`. Remote registry
requests use raw `fetch()` and `response.json()` with no timeout and no cap on
the decoded body.

**Consequence.** A hostile or merely broken repository can hang a Git process
indefinitely, fill the disk, or return a response large enough to exhaust
memory.

**Fix.** `src/core/discovery/discovery-connector.ts:120` already contains a good
bounded implementation. Make bounded behaviour the default rather than an
opt-in:

- Default timeout, max bytes, and max file count on every fetch and clone.
- Callers may raise a limit explicitly; none may omit one.
- Wrap registry `fetch`/`json` with the same timeout and decoded-size cap.
- Add regression tests: a slow server, an oversized body, a repository over the
  file-count limit.

---

## 2. Repair the handoff protocol

**One malformed line hides the whole inbox.** `src/core/routing/handoff.ts:149`
catches every read and parse error and returns an empty list, so a single
truncated JSONL entry makes every pending task disappear silently.

- Parse line by line; keep the good lines.
- Report the corrupt line number instead of swallowing it.

**Terminal states are not honoured.** Only `done` resolves a task. The `error`
and `cancel` message types are defined and never acted on, so a task that failed
stays pending forever.

- Add an explicit `resolves: <id>` field rather than parsing it out of the
  free-text `context` string, which is what the code does today.
- Treat `error` and `cancel` as terminal.
- Keep reading the old `Resolves <id>` form so existing logs still work.

---

## 3. Remove stale command syntax

The handoff redesign collapsed five commands into one, but the old syntax
survives in generated and checked-in files:

- `src/core/routing/handoff.ts:237` and `:343` — generated PROTOCOL.md and
  status text still say `handoff init`, `handoff send`, `handoff done`.
- `AGENTS.md:7` in this repository still carries the old managed block.
- Managed blocks already written into users' `CLAUDE.md` / `AGENTS.md` need
  migrating, not just regenerating: detect the old block and replace it.

---

## 4. Generate completions from the command tree

`src/core/reporting/completion.ts:3` still advertises `pack`, `publish`,
`compare`, `sandbox-run`, `serve`, and `capabilities` — all removed.
`tests/cli-help.test.ts:87` asserts those commands are gone while
`tests/completion.test.ts:37` requires `sandbox-run` to be present, so the test
suite currently encodes the contradiction and passes.

Derive completions from the Commander command tree (or one shared registry) so
the list cannot drift again, and fix the tests to assert agreement rather than
a fixed list.

---

## 5. Fix documentation that describes removed features

- `docs/FEATURE_TEST_MATRIX.md:204` tells the reader to run `pack`, `publish`,
  and `registry-serve`, and cites `tests/registry-api.test.ts`, which does not
  exist.
- `docs/FEATURE_TEST_MATRIX.md:487` documents `sandbox-run`.

The README claim gate passes because it does not validate this document.
Consider extending the gate to check that every command named in docs exists.

---

## 6. Reconcile release history

`package.json` is 0.7.0 and npm serves 0.7.0, but local tags stop at `v0.5.9`
and `CHANGELOG.md:3` jumps from _Unreleased_ straight to 0.5.9. The release
workflow itself is sound and verifies tags at `.github/workflows/release.yml:36`;
the artifacts simply do not match it.

- Backfill `v0.6.0` and `v0.7.0` tags against the commits that produced them.
- Write changelog entries for both.
- Confirm every public version maps to an immutable tag.

---

## 7. Close testing and supply-chain gaps

- **Dev dependency vulnerabilities.** `npm audit` reports three high and one
  moderate: `brace-expansion`, `js-yaml`, `nanoid`, `postcss`. Production
  dependencies are clean. Upgrade, then add `npm audit` to `npm run verify`.
- **No coverage measurement.** `vitest.config.ts:3` has no coverage provider or
  threshold, so entirely unexecuted branches still pass CI. Add V8 coverage with
  ratcheted thresholds and mandatory per-file coverage for `catalog/registry`,
  `catalog/safety`, and `install/`.
- **CI runs one platform.** Automatic CI is Ubuntu + Node 22 only; the
  advertised Node 20 minimum and macOS/Windows run only in a manually triggered
  matrix (`.github/workflows/ci.yml:31`). Make Node 20 and at least one Windows
  job automatic.

---

## 8. Lower-priority quality work

- **Skill counting is still approximate.** `agent-inspection.ts:166` sums units
  across skills, rules, commands, and agents but labels the total "skills", and
  returns either skill roots or loose files rather than their sum.
  `reporting/doctor.ts:131` repeats the label. (The 584-vs-44 bug is fixed; this
  is the remaining imprecision.)
- **Model pricing has no expiry.** `routing/route.ts:23` embeds prices copied
  from third-party pages with no freshness check. Either cite an authoritative
  source with an `updatedAt` date shown in output, or stop showing exact prices
  and show ratios.
- **Large modules.** `catalog/catalog.ts` is 1,292 lines and
  `discovery/candidate-intelligence.ts` is 1,002; several others exceed 600.
  Splitting command registration from orchestration from domain logic would cut
  review and merge risk. The `src/core` regrouping into eight domains is done;
  this is the next layer.

---

## 9. Launch, once 1–7 are done

- Re-record the demo. `docs/DEMO_SCRIPT.md` predates route, handoff, and skills.
- Post. Drafts and an explicit list of claims **not** to make (it does not
  detect your quota, does not switch models for you, handoff is not a live
  channel) were prepared separately.

---

## Context worth keeping

**Why the router works the way it does.** It originally guessed a phase from
keywords and mapped that to a tier by hardcoded judgment; the advice was neither
trustworthy nor changeable. It now reads a policy the user owns
(`~/.loadout/routing.json`, three buckets: hard / normal / cheap), the CLI admits
when it guessed a bucket, and the shipped skill is instructed to classify by
consequence rather than vocabulary. Keep that division: **facts and policy in
the CLI, judgment in the agent.**

**Why the model catalog is only five entries.** Claude Opus 5, Claude Sonnet 5,
GPT-5.6 Sol / Terra / Luna. Older Opus and Sonnet revisions and the o-series were
removed deliberately — every entry is something `--set` can name, and listing a
strictly worse model at the same price invites choosing it. Pinning a dated model
for reproducibility, if ever wanted, is a separate feature and does not belong in
the routing policy.

**Known limitation, stated plainly.** Handoff is a shared log, not a channel.
The receiving agent sees a task when it next checks its inbox, not when you send.
Making it push would need a daemon or an MCP server; that is a real project, not
a tweak.
