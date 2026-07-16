# Candidate intelligence and catalog trust

Loadout deliberately separates discovery, inspection, catalog admission, and
installation. A repository can be popular or fast-growing without being useful,
compatible, licensed for the intended use, safe, or better than a catalog package.

## Evidence pipeline

```text
daily GitHub observations
  -> candidate list (triage only)
  -> immutable source snapshot
  -> static dossier
  -> human-reviewed proposal
  -> technically screened catalog JSON
  -> Ed25519-signed release
  -> explicit local diff and apply
  -> normal preview/install/rollback workflow
```

No step silently skips the next authority boundary.

## Triage today's feed

```bash
loadout candidate list --limit 20
loadout candidate list --query "codex skills" --json
```

The displayed `triagePriority` is deterministic discovery ordering, not a quality or
safety score. It is capped at 100 points: up to 30 for bounded-query coverage, 35 for
the disclosed star-growth signal, 25 for log-scaled adoption, and 10 for appearing in
the latest run. Before a complete observation day exists, growth is labelled
`lifetime-star-average`; it is never mislabelled as measured velocity.

## Inspect real source safely

```bash
loadout candidate inspect owner/repository --output ./candidate-dossier.json
```

Loadout performs a shallow public Git clone, resolves the result to a full immutable
commit, and scans files statically. The dossier records:

- discovery date, queries, adoption and growth evidence;
- immutable repository, commit, branch, and evidence paths;
- installability as portable components, explicit runtime setup, or unsupported
  source shape;
- observed skills, rules, commands, agents, plugin manifests, and MCP declarations;
- secret/instruction/static-safety findings and explicit uncertainty;
- possible catalog overlaps based on disclosed shared terms; and
- reasons a human must block or review the candidate.

Absolute cache paths are removed from the dossier. Copy the path printed by `--write`,
or use `--output` as above for a shell- and platform-independent path. Loadout does not
run install scripts, package lifecycle commands, hooks, MCP servers, candidate models,
or arbitrary repository executables.

An `explicit-runtime-setup` or `unsupported-source-shape` result is not a dead end and
does not authorize execution. A maintainer may create a separately reviewed runtime
recipe with an immutable executable artifact, bounded commands, isolated state,
credential stripping, preview, verification, rollback, and removal. Graphify 0.9.17
is the first such recipe and is invoked with `loadout tool graphify`; it is not part
of broad `setup`.

Candidate fetches use a two-minute timeout and an isolated Git environment: system
and global config, templates, hooks, credential helpers, inherited `GIT_*` overrides,
and LFS smudging cannot affect provenance or execute during checkout. Before blob
materialization, a bounded GitHub tree-API response must be complete and prove every
blob size, at most 100 MiB total, and at most 20,000 files. The checked-out snapshot
is measured again before static analysis; rejected temporary clones are removed.

## Create a human-gated proposal

```bash
loadout candidate propose ./candidate-dossier.json \
  --id package-id --category workflow \
  --platforms windows,macos,linux

loadout candidate propose ./candidate-dossier.json \
  --id package-id --category workflow \
  --platforms windows,macos,linux \
  --approve --output ./package-id.proposal.json
```

Platforms are mandatory human claims; Loadout does not infer them from stars or a
successful clone. Before proposal preview or output, Loadout reopens the exact pinned
commit and recomputes the complete inspection and static evaluation; edited evidence
is rejected. A blocked dossier cannot become a proposal. `--approve` only writes an
isolated proposal record—it never edits the bundled catalog and never installs the
candidate. A maintainer must still review usefulness, overlap, license, runtime
powers, platform behavior, category, and catalog policy.

## Distribute a trusted catalog release

Maintainers sign a technically screened full catalog array with an Ed25519 key kept outside the
repository:

```bash
loadout keygen --private-key /secure/catalog-private.pem \
  --public-key ./catalog-public.pem
loadout catalog-sign --catalog ./catalog/packages.json \
  --private-key /secure/catalog-private.pem \
  --output ./catalog.signed.json
```

Users preview the verified release before trusting it:

```bash
loadout catalog-update --source ./catalog.signed.json \
  --public-key ./catalog-public.pem
loadout catalog-update --source ./catalog.signed.json \
  --public-key ./catalog-public.pem --yes
```

`--source` also accepts HTTPS with a 15-second timeout and streaming 5 MiB limit; other remote
schemes are rejected. The command verifies the signature, fingerprint, complete
catalog schema, immutable evidence, and exact add/update/remove diff. Removals require
the separate `--allow-removals` acknowledgement. Apply rejects replayed/older releases,
snapshots previous state, writes atomically, journals the transaction, and re-verifies
the stored signature whenever the effective catalog loads. The first successful apply
pins the signing key and a non-rollback replay high-water mark; signer changes require
an explicit trust-reset/key-rotation decision outside the normal update command.

The public key is stored beside the signed envelope because it is verification data,
not a secret. Trust in that key still has to come from a separately authenticated
project release channel.

## Local personalization

```bash
loadout recommend --project . --agent codex --json
```

When an agent is supplied, baseline project recommendations are adjusted only by the
local outcome store for the same agent and task family. The evidence contains no
project paths, prompts, code, or source content. It can reorder or lower confidence in
catalog packages, but it cannot promote a discovery candidate or create a global
popularity loop.
