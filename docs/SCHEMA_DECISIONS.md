# Runtime schema decision

Loadout treats catalog JSON, shared manifests and lockfiles, persisted install
state, and inter-module install plans as untrusted data. `src/shared/schemas.ts`
is the single runtime-validation boundary for those structures. It uses Zod so
the parsed output has inferred TypeScript types as well as a path-aware runtime
error for the CLI and tests.

The schemas intentionally model identifiers, source provenance, agent IDs,
component kinds, hashes, and safety levels. They do not define fields for MCP
environment values, API keys, tokens, or other secret values. MCP environment
values remain in their agent-owned configuration and are only summarized using
counts/names elsewhere in the product.

Compatibility and failure handling:

- New manifest, lockfile, and state writers always emit schema version 1.
- Lockfiles produced before `generatedAt` existed remain readable as the
  explicit legacy value `unknown`; newly written lockfiles always include the
  timestamp.
- Unknown catalog and policy fields are retained where required for existing
  portable-export secret scanning. They are never interpreted as executable
  configuration by the schema layer.
- Invalid data fails before install, audit, or update processing with the exact
  field path (for example, `installs.0.targetAgents.0`).
