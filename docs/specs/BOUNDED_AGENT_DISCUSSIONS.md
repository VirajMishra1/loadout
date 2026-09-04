# Spec: Bounded agent discussions

## Objective

Add an opt-in design room in which Claude Code and Codex can discuss one
technical question, challenge each other's proposals, and record a final
decision. The user chooses the topic, participants, round count, and provider
turn budget. Success means the exchange is genuinely bidirectional, bounded,
auditable, resumable from the coordination log, and unable to edit files merely
because a discussion was started.

The initial release targets two participants. One is the proposer and one is
the reviewer. A round gives each participant one turn; after the configured
rounds, the proposer receives one synthesis turn and Loadout records the final
decision and considered alternative.

## Assumptions approved by the user

1. `loadout coord discuss start` is explicitly opt-in and may spend paid
   provider turns.
2. A discussion shares only responses produced for the public design room. It
   does not expose hidden reasoning, unrelated chat history, or provider state.
3. Discussion prompts forbid code edits and command execution. Implementation
   begins only after the discussion completes and the user acts on the result.
4. Exactly Claude Code and Codex are supported in the first release, using
   either fresh sessions (`--agents`) or explicit existing sessions
   (`--sessions`).
5. A discussion has 1-8 rounds and a hard turn budget. The expected budget is
   `rounds * 2 + 1`; invalid or insufficient budgets fail before any paid turn.
6. Provider output is untrusted, redacted at the existing persistence boundary,
   length-bounded, and stored only as explicit discussion events.

## Tech stack

- TypeScript 5.7, ESM, Node.js 20+
- Commander 12 for the public CLI
- Zod 4 for boundary validation
- Vitest 4 for unit, integration, and CLI tests
- Existing Claude Code CLI and official Codex SDK adapters
- Existing project-local `.handoff/coordination.jsonl` protocol

## Commands

```bash
# Build and static checks
npm run build
npm run typecheck
npm run lint
npm run format:check

# Focused tests
npx vitest run tests/coordination-discussion.test.ts
npx vitest run tests/coordination-session-commands.test.ts

# Full release gate
npm run verify:full

# Start fresh provider sessions
loadout coord discuss start "REST or GraphQL for checkout?" \
  --agents claude-code,codex --rounds 4 --max-turns 9

# Reuse existing provider sessions
loadout coord discuss start "REST or GraphQL for checkout?" \
  --sessions claude-code:<session-id> codex:<thread-id> \
  --rounds 4 --max-turns 9

# Inspect a discussion without spending provider turns
loadout coord discuss show <thread-id>
loadout coord discuss list
```

## Project structure

- `src/core/coordination/discussion.ts`: pure discussion state, prompts,
  orchestration, result formatting, and bounded public transcript.
- `src/core/coordination/events.ts`: additive discussion payload schema.
- `src/commands/coordination-discussions.ts`: CLI registration and provider
  session composition.
- `src/commands/coordinate.ts`: registers the discussion command group.
- `tests/coordination-discussion.test.ts`: protocol and orchestrator behavior.
- `tests/coordination-session-commands.test.ts`: public argument parsing.
- `docs/decisions/003-bounded-agent-discussions.md`: architecture rationale.
- `docs/LIVE_COLLABORATION.md`, `docs/USER_TEST_GUIDE.md`, `README.md`: user
  workflow and safety language.

## Public contract and code style

Discussion events extend the existing protocol without changing old events:

```ts
type DiscussionPayload = {
  threadId: string;
  kind: "started" | "proposal" | "critique" | "revision" | "summary" | "closed";
  round: number;
  role: "system" | "proposer" | "reviewer";
  content: string;
  participants?: [string, string];
  replyTo?: string;
  alternatives?: string[];
  unresolved?: string[];
  outcome?: "decided" | "failed";
};
```

Names use current camelCase TypeScript conventions. Inputs and outputs are
separate interfaces. Boundary schemas are strict and descriptive. Existing
event error semantics and redaction are reused.

## Testing strategy

- Unit-test schemas, state reconstruction, prompt safety text, reply chains,
  round limits, turn-budget validation, provider failure, and kill-switch
  behavior with real coordination storage and fake participants.
- Integration-test a complete alternating discussion and assert the persisted
  event order and final decision.
- CLI-test parsing for `--agents`, `--sessions`, rounds, and mutually exclusive
  modes without invoking a paid provider.
- Extend replay/adapter formatting tests so discussion events are legible.
- Run all coordination suites, then `npm run verify:full`.
- Manually run one real Claude Code/Codex discussion before publishing 0.9.0.

## Boundaries

### Always

- Validate all CLI and persisted discussion input.
- Check the kill switch before every provider turn and persisted event.
- Emit a stable thread ID and reply ID for every public statement.
- Keep turns sequential so each agent sees the previous public response.
- Redact and bound shared responses through the canonical event store.
- Print the exact paid-turn count before starting fresh or resumed sessions.

### Ask first

- Adding a third provider or more than two participants.
- Allowing discussion prompts to edit files or execute commands.
- Adding remote/networked coordination or a hosted message broker.
- Persisting private provider transcripts or hidden reasoning.

### Never

- Start paid turns when validation or budget checks fail.
- Route a discussion output as an instruction outside its thread.
- Run an unbounded loop or retry provider turns silently.
- Continue after the kill switch, missing response, or provider rejection.
- Claim consensus when the synthesis records unresolved disagreement.

## Success criteria

- `coord discuss start` alternates Claude Code and Codex for exactly the
  requested number of rounds and runs at most the declared turn budget.
- Every response is a validated `discussion` event with `threadId`, `kind`,
  `round`, `role`, and an explicit reply chain.
- A successful discussion ends in `summary`, `decision`, and `closed` events;
  a failed discussion ends in a bounded error/closed state without extra turns.
- `list` and `show` reconstruct bounded discussion state from the JSONL log.
- Both fresh sessions and explicit existing sessions are supported, but cannot
  be selected together.
- The kill switch halts the exchange before the next provider turn.
- Each provider turn defaults to a 120-second timeout and accepts a validated
  10-600 second override.
- Existing coordination consumers continue to parse and operate unchanged.
- Focused tests, all coordination tests, build, lint, formatting, package smoke,
  and the complete release gate pass.

## Open questions

- None for the two-agent MVP. Multi-agent voting, remote machines, and automatic
  implementation are intentionally deferred.
