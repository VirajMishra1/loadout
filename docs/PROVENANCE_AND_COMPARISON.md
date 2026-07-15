# Provenance and comparison contract

Loadout must answer “where did this skill come from?” and “is there a better reviewed
alternative?” without turning weak signals into facts. Both workflows are read-only.

## Provenance confidence

From strongest to weakest:

1. `catalog-exact` / `exact`: the installed `SKILL.md` SHA-256 is byte-identical to a
   skill indexed from a catalog repository at its reviewed immutable commit.
2. `loadout-managed` / `high`: Loadout state owns the installed path. The file may
   still be reported separately as drifted if the user edited it after installation.
3. `embedded-source` / `medium`: the skill text contains a GitHub repository that is in
   the reviewed index, but the instruction fingerprint differs. A documentation link
   or fork can create this signal, so it is evidence rather than proof.
4. `catalog-name-candidate` / `low`: only the normalized skill name matches. Names are
   not unique and cannot establish authorship, equivalence, or quality.
5. `unknown` / `unknown`: no supported evidence matched. Loadout preserves this result
   rather than guessing from a directory name.

`loadout scan` uses only an existing local reviewed index. It never performs network
access unless `--refresh-provenance` is passed. Refresh fetches only catalog repositories
with reviewed skill evidence, checks out their exact 40-character commit, fingerprints
their `SKILL.md` files, and writes a local index below `LOADOUT_HOME/provenance`.

## Relationship classification

`loadout compare` uses deterministic relationships:

- `exact-copy`: identical instruction fingerprint;
- `divergent-same-name`: same normalized name, different instructions;
- `overlapping-capability`: at least 30% Jaccard overlap after conservative
  name/description token normalization; and
- `same-category-candidate`: reviewed catalog category matches but textual overlap is
  weak.

Two additional capability-family states are deliberately not inferred from text:

- `complementary-capability` requires an explicit reviewed catalog relationship showing
  that the tools solve different parts of a workflow; and
- `verified-hard-conflict` requires a catalog conflict-family record with hard severity
  and blocks installation until resolved.

If neither reviewed relationship exists, Loadout leaves the relationship unclassified
rather than calling two vaguely related tools complementary or incompatible.

Cross-agent installations with the same name and fingerprint are mirrors, not duplicate
problems. Divergent same-name installations require `--agent` disambiguation. Existing
catalog conflict families remain the source of verified soft/hard package conflicts.

## Comparison evidence and guardrails

Alternatives show repository, reviewed commit, tier, license, deterministic relationship,
text similarity, and the existing catalog evidence score. Adoption, momentum,
maintenance, compatibility, permission, and evaluation evidence are printed separately;
missing evidence is stated instead of being silently treated as good. The score orders
available catalog evidence; it does not measure model-output quality.

The comparison recommendation follows these rules:

- strongly attributable installed skills remain in place by default;
- same-name or overlapping candidates require head-to-head evaluation or explicit user
  experience before replacement;
- weak same-category candidates are exploration only; and
- no command changes agent files, activates a skill, or removes an unknown skill.

Limitations are explicit: `SKILL.md` fingerprinting does not prove that referenced assets
are identical, GitHub URLs embedded in instructions do not prove provenance, semantic
token overlap is not an embedding or behavioral evaluation, and current comparison does
not claim universal “best.” Phase 12 task evaluations and local human outcomes are
required before guided optimization may apply a replacement.
