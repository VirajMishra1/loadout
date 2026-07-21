# Upstream license decisions

Reviewed on July 21, 2026 for the public `0.5.7` release.

Loadout records `NOASSERTION` when it cannot identify one repository-wide SPDX
license from the inspected source. Popularity, an official publisher, or a public
GitHub repository does not replace a license grant.

## Release decision

The six records below remain in the credited catalog as source metadata. Loadout
does not copy their source into the npm package, claim ownership, or assign them a
license. A selected profile may fetch a pinned upstream snapshot only after showing
the user a preview. MCP configuration and executable tools remain separate explicit
actions.

None of these six records is part of Stable. Stable continues to use four sources
with identified SPDX licenses. People who select Power, Maximum, or a Custom package
must review the linked upstream terms before using content marked `NOASSERTION`.

| Catalog record                 | Upstream source                                                                 | Recorded decision                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI Skills Catalog          | [openai/skills](https://github.com/openai/skills)                               | Retain the pinned catalog pointer with `NOASSERTION`; no repository-wide root license was identified.                               |
| Anthropic Skills               | [anthropics/skills](https://github.com/anthropics/skills)                       | Retain the pinned catalog pointer with `NOASSERTION`; no repository-wide root license was identified.                               |
| Vercel Agent Skills            | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills)         | Retain the pinned catalog pointer with `NOASSERTION`; no repository-wide root license was identified.                               |
| Vercel Skills                  | [vercel-labs/skills](https://github.com/vercel-labs/skills)                     | Retain the pinned catalog pointer with `NOASSERTION`; no repository-wide root license was identified.                               |
| Sentry MCP                     | [getsentry/sentry-mcp](https://github.com/getsentry/sentry-mcp)                 | Retain the pinned catalog pointer with `NOASSERTION`; the root license file is not identified as a standard SPDX license by GitHub. |
| Model Context Protocol Servers | [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) | Retain the pinned catalog pointer with `NOASSERTION`; the root license file is not identified as a standard SPDX license by GitHub. |

This is a transparent product policy decision, not legal advice or a claim that the
upstream material may be redistributed under Loadout's MIT license. Each upstream
project keeps its own copyright and terms.
