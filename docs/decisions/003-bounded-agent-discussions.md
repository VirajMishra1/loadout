# ADR 003: Bounded sequential agent discussions

## Status

Accepted

## Date

2026-09-04

## Context

The coordination bridge can deliver structured events to Claude Code and Codex,
but it does not make the agents deliberate. Users who want both models to weigh
the same feature must manually relay responses, and an unconstrained automatic
relay could consume quota indefinitely, spread prompt injection, or let two
agents edit the same files concurrently.

Provider interfaces can start or resume turns, but neither supported interface
offers a shared hidden context or reliable mid-turn steering. Provider output
is also untrusted data and may be empty, malformed, oversized, or contain
instructions unrelated to the user's question.

## Decision

Implement an opt-in, two-participant design room as a sequential protocol:

- one proposer and one reviewer alternate for 1-8 rounds;
- each response is explicitly public, redacted, bounded, persisted, and linked
  to the prior event by thread and reply IDs;
- each round costs two provider turns and final synthesis costs one, so the
  exact required budget is known before any provider session starts;
- prompts prohibit file edits, commands, tools, and disclosure of private
  reasoning;
- the proposer returns a strict final JSON decision, rationale, alternatives,
  and unresolved disagreements;
- Loadout emits a normal decision event and a terminal discussion event;
- provider rejection, invalid output, and empty output close the discussion as
  failed without silent retries;
- the existing project kill switch is checked before every provider turn;
- provider turns default to 120 seconds and are explicitly bounded to a
  user-selectable 10-600 seconds.

Fresh sessions start lazily with their first discussion prompt so setup does not
spend a hidden extra turn. Existing provider session IDs are attached without a
turn and then resumed on the first discussion response. The project bridge
lease prevents a background bridge and a design room from controlling the same
sessions concurrently.

## Alternatives considered

### Let both agents edit the same feature during the discussion

Rejected. The purpose of the design room is to settle an approach before file
ownership and implementation. Concurrent edits make the outcome harder to
review and reintroduce the conflicts the ownership protocol prevents.

### Forward full provider transcripts automatically

Rejected. It would expose unrelated context, increase prompt-injection risk,
and make storage and quota use unpredictable. Only responses requested for the
public discussion are shared.

### Run both agents concurrently and ask a third model to judge

Rejected for the first release. Parallel first proposals do not support genuine
back-and-forth critique, and a third model adds provider, billing, and tie-break
semantics without evidence that it improves decisions.

### Continue until the agents agree

Rejected. Agreement is not guaranteed, and an unbounded loop is unsafe. The
final result preserves unresolved disagreement rather than claiming consensus.

### Host a remote coordination bus

Rejected for this release. Authentication, tenant isolation, encryption,
availability, and remote conflict semantics require a separate design. The
current protocol remains local to one repository and machine.

## Consequences

- Users get a real Claude↔Codex critique loop with a predictable maximum cost.
- The transcript is inspectable with `coord discuss show` and the normal replay.
- The discussion cannot steer a provider mid-turn; a kill switch takes effect
  before the next turn.
- Strict final JSON may fail when a provider ignores the requested format. That
  failure is visible and auditable instead of being misrepresented as a valid
  decision.
- More than two agents, voting, hosted rooms, and automatic implementation are
  intentionally out of scope.
