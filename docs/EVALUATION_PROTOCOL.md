# Evaluation protocol and uncertainty

Loadout evaluates package **evidence**, not the universal quality of an agent.
Scores are category-specific, reproducible, and carry an uncertainty statement.

## Category 1: Skill package hygiene

Inputs are a pinned source snapshot and discovered `SKILL.md` directories. Checks:

- required frontmatter name and description parse;
- names are unique within the package;
- paths stay within the snapshot and are not symlinks;
- instruction text is scanned for scripts, credential references, and external
  domains; and
- the package declares at least one compatible target layout.

Result: `ready`, `needs-review`, `blocked`, or `not-applicable`, plus findings.
An absent component category is `not-applicable` and never blocks a different
supported component. This says nothing about whether the instructions improve a
particular model's output.

## Category 2: MCP manifest safety

Inputs are static JSON manifests only. Checks:

- valid command/argument structure or HTTPS endpoint;
- no inline credential values;
- declared environment variable names only;
- no executable runs during evaluation; and
- each server has a concrete compatible configuration target.

Result: `ready`, `needs-approval`, or `blocked`, plus the exact permission/finding
that led there. A passing result does not attest to server reliability or data access.

## Uncertainty rules

No score uses stars, social mentions, or a single benchmark as proof of quality.
Missing evidence lowers confidence; it is not treated as negative evidence. Evaluators
are deterministic over the same pinned snapshot and report their version and inputs.
Human review remains mandatory for all findings that require approval.
