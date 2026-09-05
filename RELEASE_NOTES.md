# Loadout v0.9.1 — Pre-release Hardening

Production-grade hardening across the coordination protocol, snapshot system, and provider adapters.

## What's New

### Snapshot Permissions

Snapshot capture and restore now preserve Unix file permission modes. Legacy snapshots without modes are tolerated; invalid modes are rejected at validation time.

### Provider Cancellation

Adapter `start()` and `submitTurn()` accept an `AbortSignal`. Cancelled turns release the busy flag so new turns can proceed without waiting for a timeout.

### Lock Recovery Race Fix

Coordination lock recovery uses atomic `rename` so concurrent recoverers cannot both delete and recreate the lock file. Post-acquisition token verification ensures the winner still holds the lock after write. Windows `EPERM` during rename contention is treated as transient.

### State-Preserving Compaction

Log compaction extracts the latest checkpoint for each ownership, contract, and decision state key before removing events. Double compaction is stable — running it twice produces the same result.

### Conservative Contracts

- Auto-detected contracts handle mixed `import { A, type B }` syntax correctly
- Incomplete multi-line `const` declarations are rejected as unpublishable instead of emitting truncated contract bodies

## Stats

- **902 tests** across 136 test files
- **42k LOC** source, **25k LOC** tests
- Type-checks clean under strict mode
- Passes on macOS, Ubuntu, and Windows (Node 20 + 22)

## Install

```bash
npm install -g loadout-ai@0.9.1
```
