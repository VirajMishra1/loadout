# Catalog ranking and conflict policy

Loadout's ranking is an explanation, not a claim that one agent extension is
universally "best." It compares candidates only when they serve the same
capability family. Tier remains an admission/review decision; an impressive
star count cannot promote an unreviewed package over a safety or provenance
failure.

The current score has five bounded factors: logarithmic GitHub stars (30),
measured momentum (20), code-push maintenance (20), evidenced components and
platforms (15), and immutable source/license/review evidence (15). A factor
with no stored evidence receives zero points. In particular, one star snapshot
does not establish momentum, `updated_at` metadata is not code maintenance,
and README claims/topics are not independent trust evidence.

This limits obvious gaming and bias: stars are capped and logarithmic; missing
data does not gain a neutral score; archived packages are not auto-selected;
official publisher status is not a security guarantee; and deterministic ID
ordering breaks exact ties. The score must not be used to compare unrelated
categories, infer security, or make a personal recommendation from protected
or private data.

Conflict families are maintained policy, separate from filesystem collision
checks. The current real-catalog families are broad skill collections and web
research MCP servers. They are soft overlaps: Stable Boost chooses one default
and defers the others, while Maximum and Custom retain them with a plain-language
warning. A hard family is only added with evidence of real incompatibility; it
blocks every profile until a person removes all but one candidate.

Run `loadout plan --mode stable` to see the safely selected package set. The
resolver runs before cloning repositories or changing agent directories.
