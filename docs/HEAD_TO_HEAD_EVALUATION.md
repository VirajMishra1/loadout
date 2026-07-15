# Head-to-head capability evaluation design

This protocol compares two reviewed skill instruction sets on one declared task
family. It does not rank repositories globally, execute candidate code, or silently
change an active set.

## Evidence envelope

Every run stores:

- evaluation schema and harness version;
- category and fixture ids plus the fixture/rubric SHA-256;
- candidate package, skill path, reviewed commit, and instruction SHA-256;
- agent surface, model provider/model/version, sampling settings, and tool policy;
- per-trial rubric dimensions, grader rationale, raw aggregate, variance, and trial
  count;
- input/output token counts, reported provider cost or 'unknown', duration, failures,
  and retries;
- deterministic grader version, human audit status, uncertainty statement, timestamp,
  and machine-verifiable signature.

Candidate instructions are data. The harness never runs their scripts, shell commands,
hooks, MCP servers, network requests, or tool calls. Fixtures use disposable synthetic
repositories and redact secrets. A model request is permitted only through an explicit
provider selection and cost ceiling.

## Initial categories

### Workflow adherence

Fixtures ask for a change under explicit constraints: inspect before editing, preserve
unrelated work, write a focused test, verify, and report uncertainty. Rubric:
constraint recall (25), plan-to-action consistency (20), safe scope (20), verification
quality (20), and honest completion report (15). A hidden forbidden action produces a
blocking safety failure rather than a negative quality point.

### Code-review coverage

Fixtures contain synthetic diffs with seeded correctness, security, concurrency,
compatibility, and test-gap defects plus harmless distractors. Rubric: weighted seeded
defect recall (45), precision (20), severity calibration (15), actionable file/line
evidence (10), and regression-test advice (10). Findings not grounded in the fixture
count against precision.

### Documentation retrieval

Fixtures provide versioned local documentation and deliberately stale alternatives.
Rubric: correct source/version choice (30), supported API facts (30), citation
traceability (20), uncertainty handling (10), and absence of invented APIs (10).
Network access is disabled so retrieval quality is not confused with internet access.

### Browser-test planning

Fixtures provide an HTML/accessibility snapshot, user journey, and failure evidence.
Rubric: critical-path coverage (25), stable locator strategy (20), accessibility and
responsive cases (20), isolation/setup (15), failure diagnostics (10), and avoidance
of brittle timing (10). The first harness plans tests only; browser execution is a
separate sandboxed verification stage.

## Trial and decision rules

- Minimum five trials per candidate/fixture/model; alternate candidate order.
- Identical prompts, context budget, model version, temperature, tool policy, and
  timeout within a comparison.
- Report mean, median, standard deviation, failures, and 95% bootstrap interval. Fewer
  than five successful trials is 'insufficient-evidence'.
- A result is only 'preferred-for-this-category' when the interval clears the declared
  practical-effect threshold and no safety failure exists. Otherwise it is 'tie',
  'mixed', or 'insufficient-evidence'.
- One fixture, model, or judge cannot promote a global default. Active-set replacement
  always requires a preview and explicit user approval.

## Signed snapshot boundary

The harness writes canonical JSON, hashes fixtures and candidate inputs, and signs the
evidence envelope with Loadout's existing Ed25519 catalog-signing primitive. Private
keys stay outside the repository. Verification must fail on any changed score,
metadata, candidate hash, or rubric. Unsigned local experiments may be displayed but
cannot influence shared ranking evidence.
