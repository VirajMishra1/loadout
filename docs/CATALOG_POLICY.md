# Catalog ranking and conflict policy

Loadout's ranking is an explanation, not a claim that one agent extension is
universally "best." It compares candidates only when they serve the same
capability family. An impressive star count cannot promote an uninspected
package over a safety or provenance failure.

Trust and ranking are deliberately separate. Every package is labelled as
`discovered`, `inspected`, `human-reviewed`, `benchmarked`, or `recommended`.
The bundled 50-repository release is technically screened and pinned, but that
does not mean all 50 are universal winners or have received human review. The
current Stable recommendation is narrower: 17 selected skills from four
immutable, SPDX-identified sources whose prepared plan needs no additional
static-risk approval.

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
research MCP servers. They are soft overlaps: Stable chooses a deliberately
curated skill subset, while Power, Maximum, and Custom retain broader choices
with a plain-language warning. Power filters collections at skill granularity;
Maximum stores the full technically screened set disabled in the library. A hard
family is only added with evidence of real incompatibility; it blocks every
profile until a person removes all but one candidate.

Run `loadout setup --mode stable` for the recommended preview or `loadout plan
--mode power` for the broader set. The resolver runs before changing agent
directories.
