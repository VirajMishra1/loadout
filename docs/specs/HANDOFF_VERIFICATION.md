# Spec: Handoff verification evidence

## Objective

Close the handoff reliability loop without an unbounded agent conversation or
implicit shell execution. A sender can attach acceptance criteria and,
optionally, an exact executable plus arguments. When the receiver explicitly
adds `--run-verification` while completing the task, Loadout runs only that
stored argv command from the project root. A
passing check records bounded evidence and settles the task; a failing check
records the attempt and leaves the task pending.

```bash
loadout handoff codex "write auth tests" \
  --verify "the focused tests pass" \
  --verify-command npm --verify-args '["test","--","tests/auth.test.ts"]'
```

Human-only criteria remain useful. They require an explicit completion note:

```bash
loadout handoff --done <task-id> --evidence "Reviewed the rendered states"
```

## Tech stack and structure

- `src/core/delegation/handoff.ts` owns additive persisted types and schemas.
- `src/core/delegation/handoff-verification.ts` owns no-shell command execution,
  output bounding/redaction, and completion transitions.
- `src/commands/catalog-workflows.ts` owns Commander validation and output.
- Vitest unit and CLI tests use real temporary repositories; the command runner
  is injectable for deterministic timeout/output/error cases.
- No new dependency.

## Public contract

Task messages may add:

```ts
interface HandoffVerification {
  criteria: string;
  command?: {
    executable: string;
    args: string[];
    timeoutMs: number;
  };
}
```

`done` and verification `status` messages may add bounded evidence with mode,
status, command argv, exit code, duration, stdout, stderr, timeout, and
truncation fields. Old messages remain valid.

## Bounds and safety

- Criteria and manual evidence: 2,000 UTF-8 characters maximum.
- Command: one non-empty executable, at most 64 arguments and 4,096 characters
  per argument; no shell is used.
- Timeout: 1-900 seconds, default 120.
- Persisted stdout and stderr: 8 KiB each after secret redaction, with a visible
  truncation flag.
- The command runs only with `--done <id> --run-verification`; legacy `--done`
  alone never executes a stored command.
- A nonzero exit, timeout, output overflow, or spawn failure never settles the
  task.
- There is no autonomous retry loop. The receiver fixes the work and explicitly
  invokes `--done` again.

## Success criteria

- Existing sends and `--done` behave unchanged without verification.
- `--verify-command` or `--verify-timeout` without `--verify` fails before send.
- Human-only criteria cannot be completed without `--evidence`.
- Commands receive literal argv with `shell: false` and run at project root.
- Passing commands append one `done` event with redacted, bounded evidence.
- Failing commands append a nonterminal `status` event and keep the task in the
  receiver inbox, where the last failure is visible.
- Full verification and coverage gates pass.

## Deferred

Provider-bridge retries may consume this evidence in a later feature, but must
remain opt-in, preview their provider-turn budget, and enforce a hard round cap.
