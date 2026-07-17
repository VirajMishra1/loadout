# README Truth Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every material README claim machine-verifiable or explicitly bounded by the strongest evidence the repository actually contains.

**Architecture:** Introduce a checked-in claim manifest and a deterministic verifier/generator that derives README facts from authoritative code and data. Strengthen disposable end-to-end and adapter-conformance coverage, then revise product language and release configuration to match verified evidence classes. External service checks remain separate from deterministic offline gates and cannot silently promote a claim.

**Tech Stack:** Node.js 20+, TypeScript, ESM JavaScript, Vitest, Playwright, Commander, Zod, GitHub Actions.

## Global Constraints

- Do not manufacture human-review, benchmark, security, platform, publication, or release evidence.
- Every production behavior change follows red-green-refactor.
- A README claim may be `proven` or explicitly `bounded`; no `unfulfilled` claim may remain written as current capability.
- Required offline verification must remain deterministic and must not fail solely because an external service is unavailable.
- Live checks must report `not-verified` on missing access and may not convert that state into success.
- Preserve the local-first architecture and existing transaction/snapshot safety boundaries.
- Do not publish npm packages, create releases, push branches, or change GitHub repository settings without separate explicit authorization.

---

### Task 1: Define and Validate the Claim Manifest

**Files:**
- Create: `docs/evidence/readme-claims.json`
- Create: `src/core/readme-claims.ts`
- Modify: `src/shared/schemas.ts`
- Modify: `src/shared/types.ts`
- Create: `tests/readme-claims.test.ts`

**Interfaces:**
- Produces: `readmeClaimManifestSchema`, `ReadmeClaim`, `ReadmeClaimManifest`, `parseReadmeClaimManifest(value)`.
- Consumes: existing schema error formatting from `src/shared/schemas.ts`.

- [ ] **Step 1: Write the failing manifest-schema test**

```ts
import { describe, expect, it } from "vitest";
import { parseReadmeClaimManifest } from "../src/core/readme-claims.js";

describe("README claim manifest", () => {
  it("rejects proven claims without authoritative evidence", () => {
    expect(() =>
      parseReadmeClaimManifest({
        schemaVersion: 1,
        claims: [{
          id: "catalog.coverage",
          section: "What Loadout manages",
          summary: "The catalog has generated coverage facts.",
          evidenceClass: "structural",
          status: "proven",
          evidence: [],
        }],
      }),
    ).toThrow(/authoritative evidence/i);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- tests/readme-claims.test.ts --run`  
Expected: FAIL because `src/core/readme-claims.ts` does not exist.

- [ ] **Step 3: Add strict types and Zod schemas**

Implement evidence classes `structural`, `unit-verified`, `integration-verified`, `live-verified`, `platform-verified`, `human-reviewed`, `benchmarked`, and `policy-selected`; statuses `proven`, `bounded`, and `unfulfilled`; safe dotted IDs; non-empty summaries/sections; and at least one evidence reference for `proven` claims.

- [ ] **Step 4: Add the initial complete claim manifest**

Enumerate claims for product scope, catalog coverage, Stable/Power/Maximum selection, agent support, platforms, installation, update, rollback, recommendations, trust stages, discovery, credentials, MCP, manifests, benchmarks, dashboard, npm distribution, release state, testing, and current limits. Set unsupported strong interpretations to `bounded`, not `proven`.

- [ ] **Step 5: Run focused and schema suites**

Run: `npm test -- tests/readme-claims.test.ts tests/schemas.test.ts --run`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/evidence/readme-claims.json src/core/readme-claims.ts src/shared/schemas.ts src/shared/types.ts tests/readme-claims.test.ts
git commit -m "feat: define README evidence claims"
```

### Task 2: Derive Authoritative README Facts

**Files:**
- Create: `src/core/readme-facts.ts`
- Create: `tests/readme-facts.test.ts`
- Modify: `src/core/catalog-coverage.ts`
- Modify: `src/core/adapters.ts`

**Interfaces:**
- Produces: `deriveReadmeFacts({ catalog, packageJson, agents, profiles })` returning catalog counts, license counts, component/install-shape counts, profile counts, supported-agent names, and package/runtime facts.
- Consumes: `buildCatalogCoverage`, `ADAPTER_CAPABILITIES`, `STABLE_SKILL_ALLOWLIST`, `POWER_SKILL_ALLOWLIST`.

- [ ] **Step 1: Write failing deterministic fact tests**

```ts
it("derives catalog facts without duplicated README constants", () => {
  const facts = deriveReadmeFacts({ catalog, packageJson, agents, profiles });
  expect(facts.catalog.records).toBe(catalog.length);
  expect(facts.catalog.noAssertionLicenses).toBe(
    catalog.filter((item) => item.license === "NOASSERTION").length,
  );
  expect(facts.runtime.node).toBe(packageJson.engines.node);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- tests/readme-facts.test.ts --run`  
Expected: FAIL because `deriveReadmeFacts` is missing.

- [ ] **Step 3: Implement pure fact derivation**

Reuse existing catalog coverage logic and expose structured adapter/profile facts. Do not parse README text inside this module.

- [ ] **Step 4: Cover the real catalog fixture**

Assert the current derived values are 50 records, 37 categories, 31 records with skill components, 19 MCP-only records, four Stable sources, 30 Stable skill directories, and six `NOASSERTION` licenses. These assertions intentionally catch unexpected source-data changes and must be updated only alongside reviewed catalog changes.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- tests/readme-facts.test.ts tests/catalog-coverage.test.ts tests/adapters.test.ts tests/profiles.test.ts --run`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/readme-facts.ts src/core/catalog-coverage.ts src/core/adapters.ts tests/readme-facts.test.ts
git commit -m "feat: derive authoritative README facts"
```

### Task 3: Add Generated README Fact Blocks

**Files:**
- Create: `scripts/update-readme-facts.mjs`
- Create: `tests/readme-facts-script.test.ts`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Produces CLI: `node scripts/update-readme-facts.mjs [--check]`.
- Consumes built or source-derived facts and guarded markers `<!-- loadout:NAME:start -->` / `<!-- loadout:NAME:end -->`.

- [ ] **Step 1: Write failing generator tests**

Test that `--check` reports a stale block, duplicate/missing markers are rejected, and an update changes only bytes within the selected marker pair.

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- tests/readme-facts-script.test.ts --run`  
Expected: FAIL because the script is missing.

- [ ] **Step 3: Implement guarded rendering**

Generate blocks for catalog coverage, evidence stages, support summary, verification summary, and current limits. Use stable sorting and platform-independent newlines.

- [ ] **Step 4: Replace duplicated README facts with generated blocks**

Retain explanatory prose but move changing counts/matrices into guarded sections. Add `readme:update` and `readme:check` package scripts.

- [ ] **Step 5: Verify idempotence**

Run twice: `npm run readme:update && git diff -- README.md && npm run readme:update && npm run readme:check`  
Expected: second update makes no changes; check exits 0.

- [ ] **Step 6: Commit**

```bash
git add README.md package.json package-lock.json scripts/update-readme-facts.mjs tests/readme-facts-script.test.ts
git commit -m "feat: generate README evidence facts"
```

### Task 4: Enforce Claim-to-Evidence Consistency

**Files:**
- Create: `scripts/check-readme-claims.mjs`
- Create: `tests/readme-claim-check.test.ts`
- Modify: `package.json`
- Modify: `scripts/check-release-claims.ts`

**Interfaces:**
- Produces CLI: `node scripts/check-readme-claims.mjs`.
- Consumes: claim manifest, README, derived facts, filesystem evidence paths, package scripts, and release-claim index.

- [ ] **Step 1: Write failing contradiction tests**

Cover stale npm wording, absent evidence paths, duplicate claim IDs, an `unfulfilled` claim written in present tense, a human-reviewed claim without review artifacts, a benchmarked claim without signed run evidence, and a command documented but absent from CLI help.

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- tests/readme-claim-check.test.ts --run`  
Expected: FAIL because the verifier is missing.

- [ ] **Step 3: Implement actionable verification**

Every failure must include claim ID, observed fact, authoritative source, and remediation. Verify commands through built CLI help and subcommand help rather than a hand-maintained duplicate list.

- [ ] **Step 4: Integrate into `check:evidence`**

Add the check after catalog/discovery validation and before unit tests. Ensure it works after `npm ci` without network.

- [ ] **Step 5: Run focused and evidence gates**

Run: `npm test -- tests/readme-claim-check.test.ts --run && npm run check:evidence`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json scripts/check-readme-claims.mjs scripts/check-release-claims.ts tests/readme-claim-check.test.ts
git commit -m "test: enforce README evidence claims"
```

### Task 5: Correct Trust and Recommendation Semantics

**Files:**
- Modify: `src/core/profiles.ts`
- Modify: `src/core/catalog-coverage.ts`
- Modify: `src/core/ranking.ts`
- Modify: `src/core/recommend.ts`
- Modify: `src/core/agent-health-score.ts`
- Modify: `src/cli.ts`
- Modify: `dashboard/app.js`
- Modify: `README.md`
- Modify: `tests/profiles.test.ts`
- Modify: `tests/catalog-coverage.test.ts`
- Modify: `tests/recommend.test.ts`
- Modify: `tests/agent-health-score.test.ts`
- Modify: `tests/dashboard.test.ts`

**Interfaces:**
- Produces user-facing evidence labels that distinguish `policy-selected`, `inspected`, `human-reviewed`, and `benchmarked`.
- Preserves machine compatibility for existing stored trust-stage values where required.

- [ ] **Step 1: Write failing terminology tests**

Assert that Stable output says “Loadout policy selection,” recommendation output identifies rule-based reasoning, and zero human-reviewed/benchmarked catalog records cannot be rendered as reviewed/tested winners.

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- tests/profiles.test.ts tests/catalog-coverage.test.ts tests/recommend.test.ts tests/agent-health-score.test.ts tests/dashboard.test.ts --run`  
Expected: FAIL on current stronger wording.

- [ ] **Step 3: Implement precise labels and explanations**

Keep useful policy selection while removing “strongest,” empirical “tested,” and generic “recommended” implications. Health output must say it measures evidence coverage and managed-state hygiene.

- [ ] **Step 4: Regenerate README facts and verify UI text**

Run: `npm run readme:update && npm run readme:check`  
Expected: PASS.

- [ ] **Step 5: Run affected suites**

Run the focused command from Step 2.  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src dashboard README.md tests
git commit -m "fix: align trust language with evidence"
```

### Task 6: Add Full Adapter Filesystem Conformance Evidence

**Files:**
- Create: `src/core/conformance.ts`
- Create: `tests/adapter-conformance.test.ts`
- Modify: `src/core/adapters.ts`
- Modify: `src/core/paths.ts`
- Modify: `src/shared/types.ts`
- Modify: `README.md`

**Interfaces:**
- Produces `buildAdapterConformanceMatrix()` and evidence fields `pathKnown`, `filesystemVerified`, `nativeApplicationVerified`, `platformEvidence`.
- Consumes adapter capability declarations and isolated path environment.

- [ ] **Step 1: Write table-driven failing tests for every advertised agent**

For Codex, Claude Code, Cursor, Gemini CLI, OpenCode, Hermes, Windsurf, Cline, GitHub Copilot, Roo Code, Kiro CLI, and Junie, build a disposable home, plan a supported skill copy, apply it, inspect it, disable/re-enable it where supported, and roll it back. Assert unsupported component types are skipped with an explicit reason.

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- tests/adapter-conformance.test.ts --run`  
Expected: FAIL because evidence-aware conformance output is missing or exposes an adapter defect.

- [ ] **Step 3: Implement evidence-aware conformance matrix and fix defects**

Do not mark native application behavior verified from filesystem simulation. Use `filesystemVerified: true` only after the full disposable flow passes.

- [ ] **Step 4: Generate the README support matrix**

Replace broad “supports on all platforms” prose with filesystem support, additional components, and current CI/native evidence.

- [ ] **Step 5: Run adapter and native filesystem suites**

Run: `npm test -- tests/adapter-conformance.test.ts tests/adapters.test.ts tests/agent-inspection.test.ts tests/native-filesystem-smoke.test.ts tests/paths.test.ts --run`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src README.md tests/adapter-conformance.test.ts
git commit -m "test: prove agent filesystem conformance"
```

### Task 7: Turn the README Core Journey into an Outcome-Tested Flow

**Files:**
- Create: `scripts/readme-product-flow.mjs`
- Create: `tests/readme-product-flow.test.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Produces package script `test:e2e:readme`.
- Consumes built CLI and disposable `LOADOUT_HOME`/`LOADOUT_USER_HOME`.

- [ ] **Step 1: Write a failing harness test**

Assert the harness verifies directory creation, install records, hashes, snapshots, active-library transitions, manifest/lock consistency, privacy-safe card fields, rollback restoration, and preservation of a sentinel unmanaged file.

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- tests/readme-product-flow.test.ts --run`  
Expected: FAIL because the harness is missing.

- [ ] **Step 3: Implement the disposable core journey**

Use a local fixture source for deterministic CI and provide `--live-catalog` for the real pinned Stable repositories. Capture JSON output and validate outcomes, not output slogans.

- [ ] **Step 4: Fix any discovered core defects test-first**

For each defect, add a focused test in the owning subsystem, confirm RED, implement the minimal fix, then return to the full flow.

- [ ] **Step 5: Add deterministic flow to `verify`**

Run: `npm run build && npm run test:e2e:readme`  
Expected: PASS without external network.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json README.md scripts/readme-product-flow.mjs tests/readme-product-flow.test.ts src tests
git commit -m "test: verify the documented product journey"
```

### Task 8: Make External and Release Claims Explicitly Verifiable

**Files:**
- Create: `scripts/check-live-evidence.mjs`
- Create: `docs/evidence/live-checks.schema.json`
- Create: `tests/live-evidence.test.ts`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/daily-discovery.yml`

**Interfaces:**
- Produces `npm run check:live -- [--npm] [--stable-install] [--github]` with `verified`, `failed`, and `not-verified` results.
- Produces immutable SHA-pinned Actions configuration.

- [ ] **Step 1: Write failing live-evidence state tests**

Test that absent network/auth returns `not-verified`, upstream incompatibility returns `failed`, and only a successful version/content check returns `verified`.

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- tests/live-evidence.test.ts --run`  
Expected: FAIL because the live checker is missing.

- [ ] **Step 3: Implement bounded live checks**

Verify npm metadata matches `package.json`, npm tarball installs, and an isolated Stable install/rollback succeeds. Never run this as a required offline unit test.

- [ ] **Step 4: Pin GitHub Actions to immutable SHAs**

Resolve official current SHAs for `actions/checkout` and `actions/setup-node`, retain version comments, and add tests that reject tag-only `uses:` entries.

- [ ] **Step 5: Correct release/signature prose**

Remove the stale unpublished statement. State that signed catalog update envelopes are implemented, while the bundled catalog is source-controlled unless a verified signature artifact is later added. State that branch protection is required policy but not code-enforced.

- [ ] **Step 6: Run focused tests and live checks available on the host**

Run: `npm test -- tests/live-evidence.test.ts tests/release-workflow.test.ts --run && npm run check:live -- --npm --stable-install --github`  
Expected: focused tests PASS; each requested live check is explicitly `verified`, `failed`, or `not-verified`.

- [ ] **Step 7: Commit**

```bash
git add .github README.md package.json package-lock.json scripts/check-live-evidence.mjs docs/evidence/live-checks.schema.json tests
git commit -m "chore: verify release and live evidence boundaries"
```

### Task 9: Complete Claim Audit and Full Verification

**Files:**
- Modify: `docs/evidence/readme-claims.json`
- Modify: `README.md`
- Modify: `docs/FEATURE_TEST_MATRIX.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/RELEASE_REVIEW.md`

**Interfaces:**
- Consumes all previous evidence and produces no unverified present-tense claim.

- [ ] **Step 1: Audit every claim manifest entry**

For each entry, inspect its evidence path/command and set only `proven` or `bounded`. Any remaining `unfulfilled` claim must be removed from present-tense README prose or implemented before continuing.

- [ ] **Step 2: Run the deterministic claim gate**

Run: `npm run readme:check && npm run check:evidence`  
Expected: PASS with zero contradictory, missing, or unsupported claims.

- [ ] **Step 3: Run complete repository verification**

Run: `npm run verify:full`  
Expected: formatting, lint, typecheck, evidence checks, all unit/integration tests, CLI flows, package smoke, performance gate, and Playwright dashboard check PASS.

- [ ] **Step 4: Run clean package and real Stable verification**

Run: `npm run test:package && npm run check:live -- --npm --stable-install --github`  
Expected: package smoke PASS; live evidence reports explicit current states with npm and Stable install `verified` when network is available.

- [ ] **Step 5: Inspect final repository state**

Run: `git diff --check && git status --short && git log --oneline origin/main..HEAD`  
Expected: no whitespace errors, only intentional tracked changes, and scoped commits for every task.

- [ ] **Step 6: Commit final evidence alignment**

```bash
git add README.md docs/evidence/readme-claims.json docs/FEATURE_TEST_MATRIX.md docs/TESTING.md docs/RELEASE_REVIEW.md
git commit -m "docs: certify README claim boundaries"
```

## Plan Self-Review Results

- **Spec coverage:** All success criteria map to Tasks 1–9; external repository mutations remain separately authorized.
- **Placeholder scan:** No implementation step relies on unresolved placeholder tokens or unspecified error handling.
- **Type consistency:** Claim, fact, conformance, and live-evidence interfaces are introduced before their consumers.
- **Scope:** The plan preserves the full README-truth objective while sequencing deterministic truth enforcement before expensive external validation.
