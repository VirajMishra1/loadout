# Coordination Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Loadout coordination safe under concurrent processes, secure on localhost, correctly packaged over MCP, truthful about provider capabilities, and releasable behind an explicit beta contract.

**Architecture:** Keep the human-readable JSONL audit log, but serialize every state-changing operation through one project-local lock and one canonical validated/redacted write path. Treat the HTTP daemon and stdio MCP server as authenticated/validated adapters over that core. Provider adapters may submit a new turn to a resumable session; they must never claim to inject into an active turn unless the host exposes that capability.

**Tech Stack:** Node.js 20+, TypeScript, Zod, Vitest, `@modelcontextprotocol/sdk` v1, `@openai/codex-sdk`.

## Global Constraints

- Preserve existing `loadout handoff` behavior and `.handoff/messages.jsonl` compatibility.
- Persist coordination events before notifying watchers or SSE subscribers.
- Every persisted event has a unique, strictly increasing sequence number across concurrent processes.
- Bind HTTP only to loopback and require a project-scoped bearer token for every API/SSE request.
- Never persist raw secrets through any CLI, HTTP, or MCP write path.
- Keep destructive actions, publishing, deployment, and permission expansion under user control.
- Mark provider-driven live turns beta until both installed-host integration tests pass.

---

### Task 1: Restore the quality gate

**Files:**
- Modify: `src/core/coordination/adapters/codex.ts`
- Modify: `src/core/coordination/daemon.ts`
- Modify: `src/core/coordination/retention.ts`
- Modify: `tests/coordination-concurrency.test.ts`
- Modify: `tests/coordination-crash-recovery.test.ts`
- Modify: `tests/coordination-interrupt-policy.test.ts`

**Interfaces:**
- Produces: a zero-error `npm run lint` baseline without weakening ESLint rules.

- [ ] Remove imports that have no runtime or type use.
- [ ] Rename or omit unused parameters rather than disabling lint rules.
- [ ] Run `npm run lint`; expect exit 0.
- [ ] Run `npm run typecheck`; expect exit 0.
- [ ] Commit as `chore: restore coordination quality gate`.

### Task 2: Serialize the coordination log and enforce invariants

**Files:**
- Create: `src/core/coordination/lock.ts`
- Modify: `src/core/coordination/coordinator.ts`
- Modify: `src/core/coordination/events.ts`
- Modify: `src/commands/coordinate.ts`
- Modify: `tests/coordination-concurrency.test.ts`
- Create: `tests/fixtures/coordination-writer.mjs`

**Interfaces:**
- Produces: `withCoordinationLock<T>(projectRoot, operation): Promise<T>`.
- Produces: `claimOwnership(projectRoot, input): Promise<CoordinationEvent>`.
- Produces: atomic `publishContract` revision allocation and validated `ack` watermarks.

- [ ] Add a failing multi-process test that starts independent Node writers and asserts 100 unique sequence numbers equal `0..99`.
- [ ] Add failing tests for overlapping ownership (`src/api` vs `src/api/user.ts`), future acknowledgements, concurrent contract revisions, stale-lock recovery, and permission errors from an existing unreadable log.
- [ ] Run `npx vitest run tests/coordination-concurrency.test.ts`; confirm failures describe duplicate sequences and missing validation.
- [ ] Implement an exclusive lock file using `open(path, "wx", 0o600)`, bounded jittered retries, owner metadata, stale-owner recovery, and `finally` cleanup.
- [ ] Move append, sequence allocation, contract revision allocation, ownership check/claim, and acknowledgement validation inside the lock.
- [ ] Normalize project-relative paths and detect equal, parent, and child overlap.
- [ ] Catch only `ENOENT` as an empty coordination log; propagate other I/O errors.
- [ ] Cap IDs/agent names at 128 characters, descriptions at 8 KiB, context at 64 KiB, path counts at 256, and paths at 1 KiB.
- [ ] Run the focused test until green, then run all coordination tests.
- [ ] Commit as `fix: make coordination state atomic across processes`.

### Task 3: Make redaction canonical

**Files:**
- Modify: `src/core/coordination/redaction.ts`
- Modify: `src/core/coordination/coordinator.ts`
- Modify: `src/core/coordination/daemon.ts`
- Modify: `tests/coordination-redaction.test.ts`
- Modify: `tests/coordination.test.ts`

**Interfaces:**
- Produces: `sanitizeEmitOptions(options): EmitOptions` used by the sole append path.

- [ ] Add failing tests that emit secrets through direct core calls, CLI-equivalent calls, nested payloads, and daemon calls.
- [ ] Confirm direct writes currently persist the sample secret.
- [ ] Apply redaction inside the canonical locked writer before schema validation and persistence.
- [ ] Remove adapter-specific duplicate redaction.
- [ ] Verify all paths persist `[REDACTED]` and preserve non-sensitive fields.
- [ ] Commit as `fix: redact every coordination write path`.

### Task 4: Secure the localhost daemon and stabilize its API

**Files:**
- Create: `src/core/coordination/auth.ts`
- Create: `src/core/coordination/http-api.ts`
- Modify: `src/core/coordination/daemon.ts`
- Modify: `src/commands/coordinate.ts`
- Modify: `tests/coordination-daemon.test.ts`
- Create: `tests/coordination-daemon-security.test.ts`

**Interfaces:**
- Produces: `ensureDaemonToken(projectRoot): Promise<string>` with a mode-0600 token file.
- Produces: one structured error shape `{ error: { code, message } }`.
- Consumes: atomic coordinator operations from Task 2.

- [ ] Add failing tests for missing/wrong bearer token, malicious `Origin`, forged `Host`, unauthenticated SSE, oversized bodies, malformed JSON, and project-root leakage.
- [ ] Confirm authenticated loopback requests remain possible.
- [ ] Generate a 32-byte random token, store it under `.handoff` with mode `0600`, and compare tokens using `timingSafeEqual`.
- [ ] Require `Authorization: Bearer <token>` for API requests; allow a query token only for the initial dashboard document and immediately move it to session storage/history-free state.
- [ ] Replace wildcard CORS with same-origin behavior and reject non-loopback Host headers.
- [ ] Return 400 for malformed JSON, 401 for missing authentication, 403 for origin/host rejection, 409 for ownership/revision conflict, and 413 for oversized bodies.
- [ ] Stop returning absolute project paths from browser-visible status payloads.
- [ ] Split the 700-line daemon into HTTP policy/route and lifecycle modules.
- [ ] Run daemon security, daemon behavior, and full coordination tests.
- [ ] Commit as `fix: authenticate and isolate the coordination daemon`.

### Task 5: Ship a real MCP server

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Modify: `src/core/coordination/mcp-server.ts`
- Create: `tests/coordination-mcp.test.ts`
- Modify: `scripts/package-smoke.mjs`

**Interfaces:**
- Produces: packaged `dist/src/core/coordination/mcp-server.js`.
- Produces: stdio tools backed only by validated coordinator operations.

- [ ] Add `@modelcontextprotocol/sdk` v1 as a runtime dependency and remove the TypeScript exclusion.
- [ ] Add a failing package test asserting that `mcp-server.js` exists in the tarball.
- [ ] Add an MCP client smoke test that initializes the server, lists tools, emits an event, and reads a snapshot in a temporary project.
- [ ] Update handlers to use the SDK v1 API and convert validation/conflict failures into MCP tool errors.
- [ ] Verify stdout contains only protocol messages and diagnostics go to stderr.
- [ ] Run MCP tests and `npm pack --dry-run --json`.
- [ ] Commit as `fix: compile and package the coordination MCP server`.

### Task 6: Replace fictional provider commands with supported adapters

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/core/coordination/adapters/types.ts`
- Modify: `src/core/coordination/adapters/codex.ts`
- Modify: `src/core/coordination/adapters/claude-code.ts`
- Modify: `src/core/coordination/session-manager.ts`
- Create: `tests/coordination-adapter-codex.test.ts`
- Create: `tests/coordination-adapter-claude.test.ts`
- Create: `tests/coordination-session-manager.test.ts`

**Interfaces:**
- Produces: capability `canSubmitTurn`, distinct from unsupported mid-turn injection.
- Produces: Codex `start`, `resume`, and `submitTurn` through `@openai/codex-sdk`.
- Produces: Claude `start`, `resume`, and `submitTurn` through documented positional CLI prompts.

- [ ] Write adapter contract tests around injected process/SDK drivers so exact command arguments and session IDs are observable.
- [ ] Assert Codex never uses `--quiet` and Claude never uses `--message` or `sessions list`.
- [ ] Add `@openai/codex-sdk` as a runtime dependency and implement start/resume/turn using `startThread()`, `resumeThread(id)`, and `run()`.
- [ ] Implement Claude print-mode turns as `claude -p --output-format json [--resume id] <prompt>` and parse `session_id` from validated output.
- [ ] Track sessions Loadout itself creates instead of claiming to enumerate every host session.
- [ ] Queue relevant events until an adapter is idle; do not interrupt active work unless a future host capability explicitly supports steering.
- [ ] Run adapter and session-manager tests with fake drivers, followed by opt-in smoke checks against the locally installed CLIs.
- [ ] Commit as `fix: use supported Codex and Claude session APIs`.

### Task 7: Reconcile retention, recovery, and observability

**Files:**
- Modify: `src/core/coordination/retention.ts`
- Modify: `src/core/coordination/crash-recovery.ts`
- Modify: `src/core/coordination/replay.ts`
- Modify: `src/core/coordination/watcher.ts`
- Modify: `tests/coordination-retention.test.ts`
- Modify: `tests/coordination-crash-recovery.test.ts`
- Modify: `tests/coordination-replay.test.ts`

**Interfaces:**
- Consumes: the same lock from Task 2 for compaction and recovery.
- Produces: explicit health data without filesystem secrets.

- [ ] Add failing tests for append-during-compaction, truncated final lines, duplicate legacy sequences, reconnect after compaction, and backup restoration.
- [ ] Make compaction and recovery use the same exclusive lock as append.
- [ ] Preserve corrupt-line evidence rather than silently discarding it.
- [ ] Bound replay and snapshot queries by event count and serialized byte size.
- [ ] Add counters for connected clients, high watermark, corrupt records, rejected writes, and last compaction time.
- [ ] Run focused recovery/retention/replay tests.
- [ ] Commit as `fix: harden coordination recovery and retention`.

### Task 8: Make the product contract truthful and test the release artifact

**Files:**
- Create: `docs/decisions/001-coordination-jsonl-locking.md`
- Create: `docs/decisions/002-local-daemon-authentication.md`
- Modify: `README.md`
- Modify: `MASTERPLAN.md`
- Modify: `docs/LIVE_COLLABORATION.md`
- Modify: `docs/USER_TEST_GUIDE.md`
- Modify: `CHANGELOG.md`
- Modify: `scripts/readme-product-flow.mjs`
- Modify: `scripts/cli-product-flow.mjs`

**Interfaces:**
- Produces: one user-facing distinction between durable handoff, live coordination, and provider-driven beta turns.

- [ ] Document the locking and authentication decisions, rejected alternatives, limitations, and recovery behavior.
- [ ] Remove contradictory phase/status claims and document exact supported commands.
- [ ] Add a two-agent walkthrough: backend contract publish, frontend acknowledgement, revision diff, ownership conflict, reconnect, and kill switch.
- [ ] Add CLI/product-flow coverage for the walkthrough without invoking paid model turns.
- [ ] Run `npm run verify:full` from the clean branch.
- [ ] Run `npm pack --dry-run --json`, install the tarball in a temporary directory, and execute `loadout --version`, `loadout coord --help`, daemon authentication, and MCP initialization.
- [ ] Run opt-in real-host smoke tests with installed Codex and Claude CLIs; do not make destructive project changes.
- [ ] Review `git diff` for secrets and unrelated changes.
- [ ] Commit as `docs: define the live coordination beta contract`.

## Self-review

- Spec coverage: concurrency, authentication, MCP packaging, real provider APIs, validation, redaction, ownership overlap, acknowledgements, retention, recovery, documentation, clean-room packaging, and launch gates are each assigned to a task.
- Placeholder scan: no deferred implementation placeholders are used; provider mid-turn interruption is explicitly excluded until supported by a host API.
- Type consistency: all external adapters converge on `canSubmitTurn` and canonical coordinator operations; HTTP and MCP do not own state logic.
