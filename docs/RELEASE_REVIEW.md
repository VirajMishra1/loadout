# Archived release review

This page is an archive of the repository stabilization review completed between
July 15 and July 19, 2026. It evaluated the former 0.1.x–0.3.x product, including a
loopback dashboard that has since been removed. Its package availability, test counts,
catalog totals, CI run IDs, and dashboard findings are historical evidence—not current
release status or supported product claims.

The archived deterministic and live evidence is bound to exact tested commit
`8f8eccdd20272ebb88d0339087fc9cd3828e65c9`. That binding is retained so the evidence
remains reproducible; it does not describe the current release candidate.
The linked sanitized live observation was generated at
`2026-07-19T13:45:14.945Z`; registry and GitHub results recorded there are likewise
historical and may have changed.

For current behavior and evidence, use:

- the [README](../README.md) for the CLI product, trust boundaries, and generated
  catalog/support facts;
- the [changelog](../CHANGELOG.md) for released behavior;
- the [feature test matrix](./FEATURE_TEST_MATRIX.md) for adapter evidence;
- the [repository stabilization record](./REPOSITORY_STABILIZATION.md) and
  [sanitized July 19 live checks](./evidence/live-checks-2026-07-19.json) only when
  investigating that historical release line.

The current release gate is `npm run verify`. Publication status must be checked
against the npm registry and the corresponding GitHub release rather than inferred
from this archived document.
