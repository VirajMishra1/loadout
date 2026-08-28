# Active-set selection policy

Loadout treats the reviewed library as inventory and the active set as a constrained,
per-agent decision. It never equates repository popularity with universal quality.
The policy is deterministic, local by default, explainable in the preview, and ordered
by these constraints:

1. Block quarantined, removed, incompatible, missing-cache, and unreviewed candidates.
2. Honor an explicit full `package/skill` pin before defaults. A short skill-name pin
   may match a reviewed equivalent, but cannot bypass a safety blocker.
3. Preserve verified hard conflicts and choose only one default from equivalent skill
   names. Other reviewed sources remain disabled and are shown as alternatives.
4. Score project language/framework signals and broad task families such as planning,
   debugging, testing, review, security, documentation, architecture, and delivery.
   A generic word match is supporting evidence, not enough to activate a specialized
   domain tool by itself.
5. Add cross-project foundations and stop at the user-specified per-agent capacity.
   Capacity is a ceiling, never a quota; unused slots are safer than irrelevant skills.
6. Use category-specific evaluation confidence when evidence exists; no benchmark is
   treated as universal across tasks, agents, models, or versions.
7. Apply explicit local human outcomes only within the same task/agent scope. Pins,
   rollback, rejection, and later re-activation outweigh aggregate popularity. Until
   the privacy-safe outcome store is complete, this term is neutral rather than
   guessed.
8. Use maintenance and bounded adoption evidence only as a final tie-breaker. Stars
   cannot override safety, compatibility, conflicts, pins, evaluations, or local
   outcomes.

The current project selector implements steps 1–5 and exposes its scores, reasons,
equivalent-source decisions, exact activation delta, hash verification, and rollback
snapshot. Steps 6–7 are deliberately connected to P12-15 through P12-20 rather than
filled with fake benchmark or feedback data.

## Commands

```bash
loadout activate --project . --limit 30
loadout activate --project . --pin openai-skills/playwright
loadout optimize --project .
loadout optimize --project . --yes
```

All commands are dry-run unless `--yes` is present. Project scanning reads only
well-known root metadata files and does not require GitHub, upload source code, or
execute a skill.
