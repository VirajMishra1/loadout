# README Truth Alignment Design

**Date:** 2026-07-16  
**Status:** Approved direction; written specification pending user review

## Objective

Make every material product claim in `README.md` either:

1. provably true from current code, generated evidence, and repeatable verification; or
2. explicitly bounded so a reader cannot reasonably infer capability or validation that Loadout does not possess.

The project will not manufacture benchmark results, human-review evidence, platform coverage, safety guarantees, or release provenance. Where stronger evidence can be produced practically, the product and tests will be improved. Where it cannot, the README will state the exact verified boundary.

## Success Criteria

The work is complete only when all of the following are true:

- A versioned claim manifest enumerates every material README claim and its authoritative evidence.
- A repository check fails when generated catalog counts, package version, npm availability wording, supported-agent names, capability summaries, test counts, or documented commands drift from source truth.
- README terminology distinguishes structural inspection, static screening, human review, real execution, benchmarking, and recommendation policy.
- No package is described as human-reviewed or benchmarked without a stored, verifiable evidence artifact.
- “Recommended” is presented as a Loadout policy choice, not empirical superiority.
- Supported-agent language distinguishes directory-level skill support from full component support and from live conformance evidence.
- Platform claims identify which behavior is unit-tested, CI-tested, and live-tested.
- The bundled catalog's signature boundary is stated accurately: signed update envelopes are supported, while the repository-bundled JSON is protected only by source control and release process unless an actual signature artifact is added.
- npm publication and release statements agree with observable package/repository state.
- README workflows execute successfully in disposable environments, or are clearly marked as examples requiring external prerequisites.
- The complete verification suite and a claim-by-claim audit pass from a clean checkout.

## Non-Goals

- Claiming universal safety for third-party agent instructions.
- Claiming scientific superiority without real controlled trials.
- Creating synthetic “human review” or benchmark evidence.
- Pretending that knowing an agent's directory layout equals full integration.
- Building accounts, cloud synchronization, or a hosted service merely to make broad language appear true.
- Expanding the catalog solely to increase counts.

## Evidence Model

Each material claim receives one evidence class:

- **Structural:** schema, manifest, immutable pin, or static file evidence exists.
- **Unit-verified:** deterministic behavior is covered by tests with controlled inputs.
- **Integration-verified:** multiple real Loadout components execute together in a disposable environment.
- **Live-verified:** the current external service or upstream artifact was contacted successfully.
- **Platform-verified:** the flow executed on the named operating system in CI or an equivalent clean host.
- **Human-reviewed:** a review artifact identifies reviewer, scope, source commit, findings, and decision.
- **Benchmarked:** signed results from the versioned protocol and real runner exist.
- **Policy-selected:** Loadout maintainers selected the item using disclosed rules; this is not a quality measurement.

README prose must use the weakest class necessary and may not imply a stronger class.

## Architecture

### 1. Claim Manifest

Add a machine-readable manifest under `docs/evidence/readme-claims.json`. Each entry contains:

- stable claim identifier;
- README section or marker;
- claim summary;
- evidence class;
- authoritative source paths or verification command;
- external prerequisites;
- current status: `proven`, `bounded`, or `unfulfilled`.

The manifest is not evidence by itself. It is an index pointing to the code, test, artifact, or live command that proves the claim.

### 2. Claim Verifier

Add `scripts/check-readme-claims.mjs` and include it in `check:evidence`. The verifier will derive facts rather than compare duplicated magic numbers wherever possible:

- catalog record/category/component/license counts from `catalog/packages.json`;
- Stable/Power source and skill counts from profile allowlists and catalog component evidence;
- supported agent names and component matrix from adapter definitions;
- package version and Node requirement from `package.json`;
- command names from the compiled Commander tree or a shared command inventory;
- workflow/test descriptions from package scripts;
- current trust-stage counts from catalog logic;
- absence of contradictory publication statements;
- presence and validity of every evidence path referenced by the claim manifest.

Dynamic external claims such as npm publication will be worded with a verification date or generated release badge rather than made timeless. Offline verification must not fail merely because npm is unavailable.

### 3. Generated README Facts

Frequently changing factual blocks will use guarded generated markers. A generator will update only those blocks, including:

- catalog coverage;
- current evidence/trust-stage coverage;
- supported-agent summary;
- verification-suite summary;
- current limitations.

Human-written product explanation remains hand-edited. Generated blocks prevent counts from becoming stale without turning the entire README into generated output.

### 4. Trust Vocabulary

Replace ambiguous labels with explicit terms:

- `inspected` means immutable source and component evidence were structurally checked;
- `policy-selected` means selected by disclosed Loadout rules;
- `human-reviewed` requires a review artifact;
- `benchmarked` requires signed real-run evidence;
- `recommended` may appear only as “Loadout policy recommendation,” accompanied by the rule and evidence boundary.

The internal trust-stage API may retain compatibility aliases if needed, but user-facing output must not imply human or empirical validation that is absent.

### 5. Support and Conformance Matrix

The authoritative matrix will distinguish:

- install path known;
- component planning supported;
- disposable integration test passed;
- native application live-tested;
- operating systems with current CI evidence.

Initial work will generate the README from existing adapter capabilities and CI evidence. New disposable conformance tests will exercise every agent's supported filesystem behavior using `LOADOUT_USER_HOME` and `LOADOUT_HOME`. Native-application execution is a separate evidence class and will remain unclaimed where unavailable.

### 6. Core Workflow Verification

Add a README workflow smoke test that executes documented local workflows in an isolated profile. It will cover commands that do not require secrets or paid services:

- `upgrade` preview and approved Stable application;
- `library`, `status`, `health`, and `card`;
- `optimize` preview/application;
- rollback;
- manifest init/add/lock/sync/audit/export/import;
- dashboard preview/application;
- relevant dry-run discovery and MCP planning commands using bounded fixtures where live services are not authoritative.

The test must verify outcomes, not merely exit codes: installed directories, state records, snapshot restoration, unchanged unmanaged content, and privacy-safe report fields.

### 7. External Integration Evidence

External integrations are divided into three groups:

- **Required live beta path:** npm package installation and pinned public-GitHub Stable installation.
- **Optional live checks:** discovery providers, native credential stores, schedulers, MCP connection recipes, Graphify runtime recipe.
- **Fixture-only portability checks:** unsupported host combinations and paid/credentialed providers.

README wording will identify the group. CI will run required live checks where credentials and network policy allow. Optional checks will report evidence without making the main test suite flaky.

### 8. Release Integrity

Repository-owned improvements will include:

- immutable SHA pins for third-party GitHub Actions;
- a release-consistency check connecting package version, npm wording, and tag expectations;
- documented required branch-protection settings and a repository audit command;
- removal of the stale “not yet published” statement;
- no assertion that current bundled catalog JSON is signed unless a checked-in signature and trusted public key are actually introduced and verified.

Applying GitHub branch protection, creating tags/releases, or publishing npm versions changes external state and requires explicit authorization at that step. The repository can still enforce and document the expected state beforehand.

## Implementation Phases

### Phase 1: Stop README Drift

Build the claim manifest, fact derivation, generated blocks, contradiction checks, and precise vocabulary. This immediately makes the document defensible and prevents recurrence.

### Phase 2: Prove Core Journeys

Expand disposable integration tests and test the README's primary local workflows with outcome assertions. Fix any discovered implementation defects test-first.

### Phase 3: Prove Adapter Boundaries

Create filesystem conformance coverage for every advertised agent and produce an evidence-aware support matrix. Remove or narrow any unsupported claim.

### Phase 4: Harden Release and Supply Chain

Pin Actions, enforce release consistency, document/probe branch governance, and establish verifiable catalog-signature wording.

### Phase 5: External and Empirical Evidence

Run live optional integrations where the host and credentials permit. Design and execute genuine benchmark/human-review campaigns separately. Until evidence exists, the README continues to state that these stages are absent.

## Error Handling

- Claim verification reports the claim ID, expected source, observed fact, and exact remediation.
- Generated-block updates refuse malformed or duplicate markers.
- Missing external access produces `not verified` evidence, never a successful result.
- Live checks distinguish network failure, authentication failure, upstream incompatibility, and Loadout defects.
- A claim cannot move to `proven` when its referenced command is optional, skipped, or fixture-only unless the prose explicitly describes that boundary.

## Testing Strategy

All behavior changes follow red-green-refactor:

1. Add a focused failing test for the unsupported claim or drift condition.
2. Confirm it fails for the expected reason.
3. Implement the minimum production behavior or README correction.
4. Run the focused test and relevant subsystem suite.
5. Run full `npm run verify`; run `npm run verify:full` for dashboard changes.

The completion audit additionally runs:

- the claim verifier;
- clean npm tarball installation;
- isolated real Stable installation and rollback;
- README workflow smoke test;
- adapter filesystem conformance matrix;
- catalog coverage/trust report;
- GitHub workflow and release-state inspection where access remains available.

## Completion Rule

“Almost 100% true” does not mean hiding failures. Completion requires every material README claim to be `proven` or explicitly `bounded`, with no `unfulfilled` claim presented as current functionality. Stronger aspirational work may remain in plans, but not as a present-tense product assertion.
