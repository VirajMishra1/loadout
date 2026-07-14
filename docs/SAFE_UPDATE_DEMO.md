# Safe update demonstration

Loadout treats an update as a reviewable filesystem transaction; it never runs
repository scripts, hooks, package-manager lifecycle commands, or MCP servers.

The regression demo uses only the inert local repositories in
`tests/fixtures/update-safety`:

1. `benign-v1` to `benign-v2` is a documentation-only skill update. Loadout
   copies it, validates the copied `SKILL.md`, and records the new commit.
2. `risky-v2` adds a hook-shaped shell file and an external domain. Static
   inspection marks it as requiring explicit approval. Without that approval,
   Loadout writes review metadata to its quarantine directory and leaves the
   installed files and state untouched.
3. A simulated post-copy static verification failure restores the exact
   transaction snapshot, including the previous skill bytes and install state.

Run the evidence locally:

```bash
npm test -- --reporter=verbose tests/update-safety-demo.test.ts
```

The hook fixture contains a marker command solely to prove that inspection does
not execute it. The test asserts that the marker is absent.
