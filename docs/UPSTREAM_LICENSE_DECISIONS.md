# Upstream license decisions

Reviewed on July 21, 2026 for the public release catalog. Re-reviewed on August 30,
2026: two of the original six records had identifiable repository-wide licenses and
were updated in `catalog/packages.json`; four remain `NOASSERTION`.

Loadout records `NOASSERTION` when it cannot identify one repository-wide SPDX
license from the inspected source. Popularity, an official publisher, or a public
GitHub repository does not replace a license grant.

## Resolved out of NOASSERTION (August 30, 2026)

| Catalog record | Upstream source                                                 | Recorded decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel Skills  | [vercel-labs/skills](https://github.com/vercel-labs/skills)     | Updated `license` to `MIT`. The repository now carries a root `LICENSE` file (MIT, Vercel, Inc., 2026) and GitHub's license API confirms `mit`. No longer `NOASSERTION`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Sentry MCP     | [getsentry/sentry-mcp](https://github.com/getsentry/sentry-mcp) | Updated `license` to `FSL-1.1-ALv2`. The root `LICENSE.md` is the Functional Source License 1.1, Apache-2.0 Future License — a single, identifiable repository-wide license, just not one GitHub's detector classifies as a standard OSS license. **This is not a permissive OSI license**: it forbids "Competing Use" (offering the software, or a substitute for it, as a competing commercial product or service) until it converts to Apache-2.0 two years after each release. Sentry MCP is not part of Stable and should stay out of any default/non-custom mode; Power, Maximum, or Custom selections must show this restriction before fetch, not just a generic "review upstream terms" notice. |

## Remaining NOASSERTION (four records)

The four records below remain in the credited catalog as source metadata. Loadout
does not copy their source into the npm package, claim ownership, or assign them a
license. A selected profile may fetch a pinned upstream snapshot only after showing
the user a preview. MCP configuration and executable tools remain separate explicit
actions.

None of these four records is part of Stable. Stable continues to use four sources
with identified SPDX licenses. People who select Power, Maximum, or a Custom package
must review the linked upstream terms before using content marked `NOASSERTION`.

| Catalog record                 | Upstream source                                                                 | Recorded decision                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OpenAI Skills Catalog          | [openai/skills](https://github.com/openai/skills)                               | Retain `NOASSERTION`; the repository has no root `LICENSE` file of any kind.                                                                                                                                                                                                                                                                                       |
| Anthropic Skills               | [anthropics/skills](https://github.com/anthropics/skills)                       | Retain `NOASSERTION`; the repository has no root `LICENSE` file of any kind.                                                                                                                                                                                                                                                                                       |
| Vercel Agent Skills            | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills)         | Retain `NOASSERTION`; the repository has no root `LICENSE` file of any kind.                                                                                                                                                                                                                                                                                       |
| Model Context Protocol Servers | [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) | Retain `NOASSERTION`; the root `LICENSE` file itself states the project is mid-transition from MIT to Apache-2.0 — new/relicensed contributions are Apache-2.0, contributions whose authors have not consented to relicensing remain MIT. No single SPDX identifier covers the whole repository, so this is a genuine mixed-license case, not a missing-file case. |

This is a transparent product policy decision, not legal advice or a claim that the
upstream material may be redistributed under Loadout's MIT license. Each upstream
project keeps its own copyright and terms.
