# Spec: Safe handoff context bundles

## Objective

Let a user attach the exact text files needed for a Claude Code ↔ Codex task so
the receiving agent can begin from a bounded, durable snapshot instead of a
manually written pointer. The feature must improve cold-start context without
turning `.handoff/` into an unbounded secret or binary store.

```bash
loadout handoff codex "write auth tests" --bundle src/auth.ts src/types.ts
```

Success means the handoff message references a versioned bundle, the receiver's
normal inbox output makes that bundle impossible to miss, and unsafe inputs fail
before either the task or bundle is written.

## Tech stack

- TypeScript on Node.js 20+
- Commander for the public CLI
- Zod for persisted protocol validation
- Vitest for unit and CLI tests
- Existing coordination redaction and atomic-file helpers

No new runtime dependency is permitted.

## Commands

```bash
npm test -- tests/handoff-bundle.test.ts tests/handoff.test.ts
npm run typecheck
npm run lint
npm run build
npm run verify
```

## Project structure

- `src/core/delegation/handoff-bundle.ts` — safe paths, bounded reads,
  redaction, versioned persistence, and bundle inspection
- `src/core/delegation/handoff.ts` — additive bundle reference and inbox output
- `src/commands/catalog-workflows.ts` — `--bundle <paths...>` CLI boundary
- `tests/handoff-bundle.test.ts` — filesystem and security behavior
- `tests/handoff.test.ts` — message compatibility and receiver output
- `README.md`, `docs/REFERENCE.md`, `docs/USER_TEST_GUIDE.md`, and
  `skills/loadout-handoff/SKILL.md` — user and agent documentation

## Public contract

Task messages gain one optional additive field:

```ts
interface HandoffBundleReference {
  schemaVersion: 1;
  path: string;
  fileCount: number;
  storedBytes: number;
  isTruncated: boolean;
}
```

`path` is project-relative and always names `.handoff/bundles/<bundle-id>.json`.
The referenced strict, versioned JSON contains records with `path`,
`sourceBytes`, `storedBytes`, `sourceSha256`, `isTruncated`, and `content`.
`sendHandoff` accepts an optional pre-created reference; old callers and logs
remain valid.

## Code style

Use immutable values, Zod at persistence boundaries, and errors that name the
rejected path and violated rule:

```ts
const result = handoffBundleSchema.safeParse(JSON.parse(raw));
if (!result.success)
  throw new Error(`Invalid handoff bundle: ${formatZodError(result.error)}`);
```

## Testing strategy

- Unit tests use real temporary repositories and files.
- Every new behavior starts as a failing test observed before implementation.
- Cover happy path, Unicode, redaction, traversal, absolute paths, symlinks,
  directories, binary content, per-file and total truncation, maximum file
  count, corrupt reads, legacy compatibility, and CLI text/JSON output.
- Run the complete project verification suite before claiming completion.

## Boundaries

- Always: explicit opt-in, repository-relative regular files, deterministic
  order, secret redaction, atomic owner-only writes, strict validation, and
  additive protocol evolution.
- Ask first: new dependencies, changing the 50 KiB cap, automatically adding
  bundles to Git, or executing verification commands.
- Never: follow symlinks, leave the project, store binary files, silently omit a
  requested path, include `.git/` or `.handoff/`, upload content, or mutate
  source files.

## Limits

- Maximum files: 20
- Maximum stored UTF-8 bytes per file: 32 KiB
- Maximum stored UTF-8 bytes per bundle: 50 KiB
- Larger text files are truncated on a valid UTF-8 boundary and marked.
- Once the total limit is exhausted, remaining requested files are represented
  with empty content and `isTruncated: true`; none disappear silently.

## Security and trust model

Bundle content is untrusted project data, not agent instructions. Common secret
patterns are redacted before storage, but heuristic redaction is not a guarantee
and users must not bundle credential files. Bundles are owner-only and are not
automatically committed.

## Success criteria

- The example creates one task and one readable bundle.
- The task JSON contains a valid additive reference.
- Inbox output prints bundle path, file list, size, truncation warning, and an
  untrusted-data notice without dumping all source into the terminal.
- Unsafe files fail before a task is appended.
- Stored content never exceeds the limits.
- Secret fixture values are absent from persisted bundle text.
- Old logs without `bundle` behave identically.
- Complete repository verification passes.

## Deferred work

- Typed verification criteria and completion evidence
- Bounded provider-driven retry loops
- Handoff templates and automatic context selection
- Cross-machine bundle publication policy

These require separate contracts and are not hidden inside `--bundle`.

## Open questions

None for this conservative, opt-in slice.
