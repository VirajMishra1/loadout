# Loadout evaluation protocol v1

Status: engineering foundation. Protocol identifier: `loadout-evaluation-v1`.

This protocol defines how Loadout may plan a paired baseline-versus-candidate
benchmark without turning a single model run into a universal ranking. The current
implementation validates metadata, derives a deterministic schedule, previews the
worst-case budget, and validates resumable run records. It does **not** send model
requests, resolve credentials, store prompts or outputs, execute candidate content, or
promote a package.

The machine contract lives in `src/core/benchmark-campaign.ts`. The existing
head-to-head harness remains the deterministic scoring and signed-evidence boundary;
provider execution, if it is added later, must remain a separate explicitly approved
adapter.

The module also exposes deterministic campaign and schedule hashes plus structured
and plain-text campaign summaries. These helpers are content-free integration points
for a future CLI: they validate and describe a plan but cannot authorize or execute it.

## 1. Safety and authority boundaries

The protocol separates five authorities:

1. **Campaign author:** selects immutable synthetic fixtures, two reviewed candidate
   instruction references, a declared provider/model version, sampling controls, and
   hard ceilings.
2. **Budget reviewer:** verifies the deterministic worst-case preview before any
   provider adapter is authorized.
3. **Runner:** may later execute only the approved schedule. The v1 foundation has no
   runner and therefore cannot spend money.
4. **Evidence signer:** signs deterministic scored evidence after completeness,
   integrity, and privacy verification.
5. **Human promoter:** may approve a category-scoped catalog or active-set change.
   Signed evidence alone never installs, enables, updates, removes, or promotes.

No one authority silently implies the next. In particular, campaign validation is not
execution approval, execution is not evidence signing, and signing is not promotion.

## 2. Paired methodology

Every campaign contains exactly two immutable references:

- `baseline`: the current reviewed package/skill being compared;
- `candidate`: the reviewed alternative being evaluated.

Each reference contains only a candidate id, package id, portable skill path, full
40-character reviewed Git commit, and instruction SHA-256. Instruction text and
repository files are not embedded in campaign or run state.

A trial pair sends the same synthetic fixture, rubric version, model version, sampling
settings, token ceilings, timeout, isolation policy, and tool policy to both roles.
There must be at least five pairs. A pair is the unit of comparison: unpaired successes
cannot be used to manufacture a preferred result.

The campaign identifies both the fixture and rubric by SHA-256. Changing a seeded
defect, hidden constraint, rubric weight, or fixture byte requires a new hash and thus
a different campaign hash.

## 3. Randomization and blinding

The only v1 strategy is `paired-balanced-sha256-v1`:

1. Hash the public 64-hex seed, campaign id, and zero-based pair index.
2. Use the first digest byte to choose baseline-first or candidate-first for that pair.
3. Derive each request id from the complete canonical campaign hash, pair index, and
   role.
4. Conceal role labels from any grader. `concealCandidateLabels` must be `true`.

The strategy removes author discretion from request order and makes the schedule
reproducible. The seed is public reproducibility metadata, not a secret. Reusing a seed
with changed campaign content still produces different request ids because the full
campaign hash is included.

Order randomization does not remove every source of model variance. Results must still
report model version, sampling parameters, failures, retries, and uncertainty.

## 4. Isolation

Every v1 campaign is structurally fixed to:

- `toolPolicy: none`;
- `networkPolicy: disabled`;
- `candidatePolicy: instructions-as-data`;
- `fixturePolicy: synthetic-only`.

Candidate repositories, scripts, hooks, binaries, lifecycle commands, MCP servers,
plugins, tools, and network instructions are never run by the benchmark foundation.
The model, if a future approved runner is added, receives only a separately reviewed
synthetic fixture and static candidate instructions. It receives no real project,
home directory, credential, shell, browser, repository checkout, or agent profile.

Relaxing one of these policies requires a new protocol version, threat model, and
review. It cannot be expressed as an optional v1 field.

## 5. Provider neutrality

Campaigns name a provider id, model id, and immutable or release-specific model
version. They do not contain:

- an endpoint or arbitrary URL;
- a credential value or credential reference;
- request headers;
- provider-specific request bodies;
- prompts, messages, or model outputs; or
- a client or execution callback.

Strict unknown-field rejection prevents these values from being smuggled into the v1
schema. Provider/model metadata is descriptive. A future provider adapter must map it
to a separately approved credential reference at execution time without writing that
reference or its resolved value into campaign, run, logs, errors, or evidence.

## 6. Deterministic budget preview

Campaigns declare:

- pairs and maximum retries per request;
- per-attempt input and output token caps;
- request, total input-token, total output-token, and USD ceilings; and
- declared input/output USD rates per million tokens.

The preview uses worst-case arithmetic:

```text
scheduled requests = pairs * 2
worst-case requests = scheduled requests * (1 + retries per request)
worst-case input = worst-case requests * input cap per request
worst-case output = worst-case requests * output cap per request
worst-case cost = input/1M * input rate + output/1M * output rate
```

Cost is rounded to six decimal places after the complete calculation. The preview
reports every exceeded ceiling rather than stopping at the first. It performs no
request and does not claim that declared pricing is current; the campaign author must
obtain and review the provider's applicable rate. A campaign whose preview is over
budget is valid metadata but is not execution-ready.

Retry ceilings are included in the preview even if the first attempt is expected to
succeed. A runner may never treat an optimistic average as an authorization limit.

## 7. Campaign schema

The top-level campaign fields are:

| Field                                 | Purpose                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `schemaVersion`                       | Integer `1`.                                                             |
| `protocolVersion`                     | Exact string `loadout-evaluation-v1`.                                    |
| `campaignId`, `createdAt`, `category` | Stable identity, canonical UTC timestamp, and category scope.            |
| `fixture`                             | Fixture id/version plus fixture and rubric SHA-256.                      |
| `candidates`                          | Exactly one baseline and one candidate immutable reference.              |
| `model`, `sampling`                   | Provider-neutral model identity and fixed sampling/token controls.       |
| `trials`, `randomization`             | Pair/retry/timeout ceilings and reproducible blinded ordering.           |
| `isolation`                           | Fixed no-tool, no-network, static-data, synthetic-fixture boundary.      |
| `budget`                              | Hard request/token/USD limits and declared pricing inputs.               |
| `decision`                            | Minimum successful pairs, practical delta, and human promotion boundary. |

All objects reject unknown and missing fields. Identifiers and portable paths are
bounded. Hashes and commits must be lowercase full-length values. Numbers must be
finite; counts are bounded integers. Timestamps must equal their canonical ISO-8601
UTC representation.

The minimum practical score delta is category-specific evidence policy. It is not a
promise that a candidate is globally better. `minimumSuccessfulPairs` must be at least
five and cannot exceed planned pairs.

## 8. Run schema and resumability

A run is metadata tied to one exact campaign and schedule. It contains:

- run and campaign ids;
- canonical campaign and deterministic schedule SHA-256;
- canonical creation/update timestamps and lifecycle status;
- terminal completion records keyed by deterministic request id;
- uncertainty and safety-boundary statements.

Completion records contain only:

- terminal `succeeded` or retry-exhausted status;
- attempts used;
- aggregate input/output tokens, duration, and reported cost;
- output SHA-256 for success; or
- a bounded failure code for exhausted attempts.

Raw inputs and outputs are excluded. A success hash can later bind a separately
protected observation artifact without putting its text in resumable state.

The parser recomputes campaign and schedule hashes, rejects unknown request ids and
duplicates, validates per-attempt token ceilings, enforces retry exhaustion, and
checks aggregate request/token/cost ceilings. A `planned` run must have no completed
requests. A `completed` run must account for every scheduled request.

`pendingBenchmarkRequests` recomputes the schedule and subtracts terminal request ids.
It never trusts a caller-provided “next index.” This permits a paused process to resume
without duplicating completed work or changing order. Completed and cancelled runs
have no resumable requests.

Run records should be written atomically by a future runner. Concurrent runners must
use an exclusive campaign/run lock; this foundation deliberately provides no runner
or persistence function.

## 9. Deterministic verification and tamper response

Before any resume, scoring, or signing step:

1. Strictly parse the campaign.
2. Recompute its canonical SHA-256.
3. Recompute the complete request schedule and schedule SHA-256.
4. Strictly parse the run against that campaign.
5. Recompute remaining request ids rather than trusting progress counters.
6. Confirm recorded usage is within both per-attempt and campaign ceilings.
7. Confirm successful outputs are referenced only by SHA-256.

Any changed candidate commit, instruction hash, fixture, rubric, model version,
sampling control, seed, isolation policy, pricing input, or budget changes the campaign
hash and invalidates the run. Any changed request id or schedule hash is rejected.
Duplicate terminal records and early “exhausted” records are rejected.

The run schema is not itself signed evidence. After observations have been scored by a
deterministic harness, the complete evidence envelope must be signed with the existing
Ed25519 mechanism. Signature verification must cover scores, category, fixture/rubric
hashes, candidate hashes, model metadata, usage, failures, uncertainty, and audit
status. Tampering invalidates the envelope rather than being repaired silently.

## 10. Privacy and data minimization

Campaign and run JSON may be shareable only because the schema excludes content.
They must never contain:

- prompts, conversations, model outputs, rationales, or user queries;
- project paths, project source, repository contents, or real diffs;
- usernames, home directories, organization metadata, or telemetry identifiers;
- credential values, credential references, endpoints, or headers; or
- unredacted provider errors.

Fixtures must be synthetic and reviewed for secrets before hashing. Candidate
instructions are referred to by immutable commit/path/hash and remain data. If a
future execution adapter needs transient prompt construction, it must happen in
memory, under an explicit budget approval, and outside serialized campaign/run state.

Failure codes must be categorical (for example `timeout` or `provider-unavailable`),
not copied provider error bodies. Output hashes are not a license to retain sensitive
raw output indefinitely; retention needs a separate policy.

## 11. Uncertainty and reporting

At minimum, final evidence must disclose:

- synthetic-fixture scope;
- exact successful and failed pair counts;
- model/provider/version and sampling controls;
- retries, durations, input/output tokens, and reported cost;
- category-specific mean, median, variance, and confidence interval;
- blocking safety failures;
- minimum practical delta; and
- whether a human audited the evidence.

Fewer than the declared minimum successful pairs is `insufficient-evidence`. A safety
failure blocks preference regardless of average score. An interval that does not clear
the practical delta is a tie or mixed result. One fixture, category, model, judge,
campaign, or campaign author cannot establish universal superiority.

Provider non-determinism is never hidden behind deterministic scheduling. Reproducible
metadata makes differences inspectable; it does not make stochastic outputs identical.

## 12. Promotion boundary

The only v1 promotion policy is
`signed-evidence-plus-human-approval`. Promotion requires all of:

1. complete paired evidence meeting minimum successful-pair rules;
2. no blocking safety failure;
3. a practical delta supported by the declared uncertainty analysis;
4. a valid trusted signature over the evidence;
5. a human review of usefulness, permissions, compatibility, cost, and limitations;
6. a normal Loadout preview and rollback checkpoint; and
7. explicit approval for the exact category-scoped change.

Even then, the valid statement is “preferred for this declared category, fixture set,
model version, and policy.” The protocol never supports “best skill,” “best agent,” or
automatic global replacement.

## 13. What is intentionally not implemented

The v1 foundation does not include:

- a CLI command;
- provider SDK integration;
- credential or environment resolution;
- prompt construction or prompt persistence;
- a model judge;
- candidate/tool/script execution;
- raw observation storage;
- background or scheduled evaluation;
- automatic retry execution;
- evidence promotion; or
- catalog/active-set mutation.

Those omissions are safety properties, not missing implicit behavior. Each future
layer needs its own explicit plan, tests, authorization boundary, and budget review.
