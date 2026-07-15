# Provider-neutral model configuration

Loadout can validate and share a model-selection document before it has a
provider adapter. The schema is provider-neutral: a selection identifies a
provider, model, HTTPS endpoint, optional credential _reference_, and optional
target agent IDs. `openrouter` is an ordinary provider identifier, so an
OpenRouter selection needs no special schema or stored integration.

```json
{
  "schemaVersion": 1,
  "selections": [
    {
      "id": "coding",
      "provider": "openrouter",
      "model": "anthropic/claude-sonnet-4",
      "endpoint": "https://openrouter.ai/api/v1",
      "credential": { "kind": "environment", "name": "OPENROUTER_API_KEY" },
      "targetAgents": ["codex", "claude-code"]
    }
  ]
}
```

## Credential boundary

The document contains only a credential location, never a credential value.
The accepted references are an environment-variable **name** or an OS-keychain
service/account reference. It has no `apiKey`, `token`, `authorization`, or
arbitrary-header fields; strict runtime validation rejects them. Endpoints must
be credential-free HTTPS URLs (no userinfo, query string, or fragment), and
secret-looking values are rejected in model/identifier fields.

Loadout does not resolve the reference, write it to state/lockfiles, log it,
or transmit it in this design. A future provider adapter may read the named
environment variable or keychain entry only at execution time, and must redact
it from errors, plans, snapshots, logs, exports, and telemetry. That adapter is
explicitly outside P11-05.

## Deliberate scope

This schema declares intent; it does not configure Codex, Claude, Cursor, or
any provider, call OpenRouter, select a model automatically, or store provider
headers. Keeping those side effects out of the schema layer makes the document
portable and safe to review in version control.
