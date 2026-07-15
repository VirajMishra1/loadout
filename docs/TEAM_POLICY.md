# Team policy and audit schema

A shared Loadout is a versioned declarative manifest plus a signed catalog reference;
it never contains credentials or private repository names by default. Team policy has
four independent controls:

- allowlist: package IDs/repository identities eligible for planning;
- denylist: identities, domains, component types, or risk findings that block;
- required approvals: roles required for risky changes; and
- audit events: timestamp, actor label, manifest/catalog hashes, decision, and reason.

The serverless/local MVP stores policy in a project-controlled JSON file and validates
it before a plan. There is no hidden admin override. A later hosted product can add
identity and retention without changing the portable policy semantics.

The current manifest implementation enforces package/repository allowlists and
denylists before synchronization, alongside the existing blocked-domain and
blocked-command rules. Violations are included in the dry-run plan and stop apply.
