# CLI UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Loadout's everyday CLI path understandable for a first-time user while preserving its existing safe, advanced capabilities.

**Architecture:** Keep the CLI as the primary interface. Add one concise, read-only `guide` command and a focused help footer; retain advanced commands but remove them from the first-screen help. Fix JSON output and package-scoped update previews as explicit public CLI contracts. Document a safe test journey and keep the dashboard as an optional local companion.

**Tech Stack:** Node.js 20+, TypeScript, Commander, Vitest, framework-free local dashboard.

## Global Constraints

- Never mutate a user's agent configuration from a default or preview command.
- Existing command names remain valid even if hidden from first-screen help.
- Machine-readable commands must emit valid JSON when `--json` is accepted.
- Do not require an API key or GitHub account for the core test journey.
- Every behavior change gets a test before its production code.

---

### Task 1: Define the beginner CLI contract

**Files:**

- Modify: `tests/cli-help.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**

- Produces: `loadout guide`, a read-only command that explains setup, discovery, project recommendations, recovery, dashboard, and help.

- [x] **Step 1: Write failing CLI contract tests** for `loadout guide`, a focused top-level help footer, and retained access to an advanced command.
- [x] **Step 2: Run** `npm test -- tests/cli-help.test.ts` **and confirm the new assertions fail.**
- [x] **Step 3: Implement** `guide`, hide maintainer-only commands from first-screen help, and add a short help footer that points to the guide.
- [x] **Step 4: Run** `npm test -- tests/cli-help.test.ts` **and confirm it passes.**
- [ ] **Step 5: Commit** the focused CLI discoverability change.

### Task 2: Repair machine-readable and scoped preview contracts

**Files:**

- Modify: `tests/cli-help.test.ts`
- Modify: `tests/update.test.ts`
- Modify: `src/cli.ts`
- Modify: `src/core/update.ts`

**Interfaces:**

- `loadout catalog --json` returns a JSON array.
- `loadout update --package <id>` plans only that managed package and rejects an unknown installed package clearly.

- [x] **Step 1: Write failing tests** for catalog JSON and package-scoped update planning.
- [x] **Step 2: Run the focused test files** and confirm the assertions fail for the existing implementation.
- [x] **Step 3: Implement the smallest compatible fixes.**
- [x] **Step 4: Run the focused tests** and confirm they pass.
- [ ] **Step 5: Commit** the contract fixes separately.

### Task 3: Record user testing and current product scope

**Files:**

- Create: `docs/USER_TEST_GUIDE.md`
- Modify: `MASTER_PLAN.md`

**Interfaces:**

- The guide gives a real-profile-safe order of commands, says which commands change state, and gives rollback instructions.
- `MASTER_PLAN.md` begins with the one authoritative unfinished-work section and moves stale immediate tasks out of the active path.

- [x] **Step 1: Add a concise user testing guide** for daily use, discovery, optional dashboard, safe mutation, rollback, and advanced validation.
- [x] **Step 2: Add the current remaining work section** and mark historic, non-essential ideas as deferred rather than pretending they are active product requirements.
- [x] **Step 3: Run markdown and CLI smoke checks** to make sure command names match the real surface.
- [ ] **Step 4: Commit** documentation separately.

### Task 4: Validate the actual user journey

**Files:**

- Test: `tests/cli-help.test.ts`
- Test: `tests/update.test.ts`
- Test: `tests/dashboard.test.ts`

- [x] **Step 1: Build and run** the CLI guide, catalog JSON, health, library, project recommendation preview, and dashboard endpoint checks without changing agent files.
- [ ] **Step 2: Run** `npm run verify:full` **and inspect every failure if any.**
- [ ] **Step 3: Review the diff for accidental profile/cache/secrets changes.**
- [ ] **Step 4: Commit, then present the exact install/test/recovery commands to the user.**
