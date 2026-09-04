# ADR 001: JSONL plus a project lock for coordination state

- Status: accepted
- Date: 2026-09-03

## Context

Loadout coordinates a small number of local coding-agent processes in one
repository. Events need durable ordering, human inspectability, recovery after
partial writes, and parity across CLI, MCP, HTTP, and provider adapters. A
database would add installation, migration, backup, and corruption-recovery
surface before the expected workload requires indexed storage.

## Decision

Use `.handoff/coordination.jsonl` as the source of truth. Serialize every
mutation with `.handoff/coordination.lock`, created exclusively with owner-only
permissions. Allocate event sequences and contract revisions while holding that
lock. Derive current ownership, contracts, acknowledgements, and snapshots from
validated events.

Compaction holds the same lock, writes a complete owner-only archive first,
then atomically replaces the working log with a valid summary and retained
events. Missing files mean empty state; other I/O errors propagate. Invalid
lines are reported without hiding valid neighbors.

## Consequences

- The audit trail is readable and easy to back up or remove.
- Independent local processes cannot allocate duplicate sequences or accept
  conflicting ownership claims concurrently.
- Reads are linear in the active log, so retention must keep it bounded.
- This design is for local repository coordination, not a remote multi-user
  service. A future remote transport would require a separate trust and storage
  decision rather than exposing this daemon to a network.
