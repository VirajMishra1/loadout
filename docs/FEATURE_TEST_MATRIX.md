# Complete CLI feature test matrix

This matrix is the pre-release, founder-facing procedure for exercising Loadout's
public CLI without guessing which commands write files, use the network, start a
process, consume provider credit, or modify the host. It is generated from the
current `loadout --help` and command-specific help, not from a future product plan.

Run the automated gate first. Then use the disposable profile for every ordinary
feature. Only the final, explicitly labelled host-integration track should touch a
real credential store, scheduler, Docker daemon, or agent profile.

## Safety legend

| Mark | Meaning                                                                         |
| ---- | ------------------------------------------------------------------------------- |
| R    | Read-only with respect to agent profiles. It may still read local files.        |
| S    | Writes only to `LOADOUT_HOME` or an explicitly supplied disposable path.        |
| A    | Writes to a disposable agent profile after `--yes`. A snapshot must be printed. |
| N    | Uses the public network. GitHub rate limits may apply.                          |
| X    | Starts an external process or server.                                           |
| H    | Mutates a host integration and is not isolated by `LOADOUT_HOME`.               |
| $    | Makes an authenticated provider request that may consume API credit.            |

`--yes`, `--apply`, `--approve-risk`, `--connect`, `--private`, `--write`, and
`--approve` are mutation or authority boundaries. Never add one merely to make a
preview “work.” Read its plan first.

## 0. Prerequisites and disposable environment

Required everywhere:

- Node.js 20 or 22 and npm;
- Git for GitHub-backed package tests;
- a checkout of this repository with dependencies installed and `npm run build`
  completed;
- internet access only for tests marked N.

Optional integrations:

- Docker for `sandbox-run`;
- macOS Keychain, Windows Credential Manager, or Linux Secret Service plus
  `secret-tool` for credential tests;
- an OpenRouter key only for the optional paid model verification;
- `curl` for manually probing loopback HTTP services.

From the repository root, create a shell function that always invokes the built npm
entry point, even after commands change directories.

macOS or Linux:

```bash
export LOADOUT_ROOT="$PWD"
npm ci
npm run build
loadout() { node "$LOADOUT_ROOT/dist/src/cli.js" "$@"; }

export TEST_ROOT="$(mktemp -d)"
export LOADOUT_USER_HOME="$TEST_ROOT/user"
export LOADOUT_HOME="$TEST_ROOT/state"
export TEST_PROJECT="$TEST_ROOT/project"
mkdir -p "$LOADOUT_USER_HOME/.codex" "$LOADOUT_USER_HOME/.claude" "$TEST_PROJECT"
printf '{"scripts":{"test":"vitest run"},"dependencies":{"zod":"latest"}}\n' \
  > "$TEST_PROJECT/package.json"
```

PowerShell:

```powershell
$env:LOADOUT_ROOT = (Get-Location).Path
npm ci
npm run build
function loadout { node "$env:LOADOUT_ROOT/dist/src/cli.js" @args }

$env:TEST_ROOT = Join-Path $env:TEMP ("loadout-test-" + [guid]::NewGuid())
$env:LOADOUT_USER_HOME = Join-Path $env:TEST_ROOT "user"
$env:LOADOUT_HOME = Join-Path $env:TEST_ROOT "state"
$env:TEST_PROJECT = Join-Path $env:TEST_ROOT "project"
New-Item -ItemType Directory -Force `
  (Join-Path $env:LOADOUT_USER_HOME ".codex"), `
  (Join-Path $env:LOADOUT_USER_HOME ".claude"), `
  $env:TEST_PROJECT | Out-Null
'{"scripts":{"test":"vitest run"},"dependencies":{"zod":"latest"}}' |
  Set-Content (Join-Path $env:TEST_PROJECT "package.json")
```

The empty `.codex` and `.claude` directories make those two virtual agents
detectable. They do not read or write the real profile.

The remaining transcripts use POSIX shell line continuations. The CLI names, options,
and expected results are identical on Windows. In PowerShell, omit `\`, use backtick
for a continued command, replace `mkdir -p <path>` with
`New-Item -ItemType Directory -Force <path>`, `cp` with `Copy-Item`, and a `(cd ...;
commands)` subshell with `Push-Location ...; try { commands } finally { Pop-Location
}`. Native credential and scheduling behavior remains platform-specific as described
in tracks 9 and 10.

Confirm isolation before any applied command:

```bash
loadout status --json
loadout capabilities
```

Expected: paths, if shown, are below `TEST_ROOT`; Codex and Claude Code are detected;
the capability table names native, adapted, and unsupported surfaces honestly.

## 1. Automated release gate

Run the entire required gate with one command:

```bash
npm run verify
```

`npm run verify:full` is an alias for the same CLI release gate. The individual stages
are listed below for focused reruns and diagnosis.

| Command                    | Coverage                                                                | Expected result                                    |
| -------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| `npm run format:check`     | Repository formatting                                                   | Exit 0; no files changed.                          |
| `npm run lint`             | TypeScript lint rules                                                   | Exit 0.                                            |
| `npm run typecheck`        | TypeScript contract                                                     | Exit 0.                                            |
| `npm run check:evidence`   | Catalog/discovery attribution, README claims, and release boundaries    | Exit 0; no claim is silently promoted.             |
| `npm test`                 | Unit, integration, native filesystem, safety, and regression suites     | All tests pass.                                    |
| `npm run test:e2e:cli`     | Disposable scan → compare → optimize → apply → rollback journey         | Prints a successful CLI product flow.              |
| `npm run test:e2e:readme`  | Isolated library/activation/manifest/card/rollback journey              | Prints README product flow success.                |
| `npm run test:package`     | `npm pack`, install outside the checkout, packaged CLI install/rollback | Prints package smoke success.                      |
| `npm run test:performance` | Seven scans of 1,000 real on-disk skill directories                     | p95 remains below the enforced five-second budget. |

The focused regression contract for the v0.3.x profile lifecycle is:

```bash
npx vitest run tests/upgrade.test.ts tests/profile-state.test.ts \
  tests/update.test.ts tests/uninstall.test.ts tests/install.test.ts \
  tests/mcp-recipes.test.ts tests/cli-help.test.ts
```

It verifies preview/apply upgrade behavior, saved-profile refresh detection, safe
profile reconciliation, complete-uninstall drift protection, recursively empty target
recovery, and the separation between model-provider access declarations and service
credentials. These are disposable automated filesystem tests; they do not prove that
a native agent consumes the resulting files or that a host scheduler/keychain works.

## 2. Read-only inventory, ranking, and recommendation track (R; some N)

```bash
loadout --help
loadout catalog --coverage --json
loadout catalog --explain superpowers
loadout search frontend --json
loadout profiles --json
loadout recommend --project "$TEST_PROJECT" --json
loadout doctor --json
loadout status --json
loadout versions --json
loadout list --json
loadout library --json
loadout health --explain --json
loadout report --json
loadout card --json
loadout outcomes --json
loadout capabilities --inspect --json
```

Expected:

- catalog coverage reports technically screened and recommended counts separately,
  all trust stages, component/install shapes, licenses, evidence, categories, and
  overlap statistics;
- ranking explanation cites stored evidence and guardrails rather than claiming that
  stars alone prove quality;
- recommendation reflects the disposable project's JavaScript/testing signals;
- empty-state commands return a valid report instead of inventing installations;
- privacy-safe reports contain no project paths, prompts, source code, or secrets.
- version evidence comes only from bounded sanitized read-only probes; explained
  health lists contribution, cap, evidence, uncertainty, and remediation for every
  dimension and gives missing evidence no credit;
- the card contains aggregate inventory and evidence coverage only, with an explicit
  boundary against universal-quality or task-improvement claims.

Network variants must be run deliberately:

```bash
loadout catalog --refresh --json
loadout health --updates --json
loadout scan --agents codex,claude-code --refresh-provenance --json
loadout compare brainstorming --offline --json
loadout discover --source mcp-registry --limit 10 --json
loadout discover --source skills-sh --limit 10 --json
```

The first three use network access and may update history/provenance below
`LOADOUT_HOME`; after a **successful** complete provenance refresh, the reviewed
Superpowers `brainstorming` skill can be compared with `--offline` and no fetch. If a
rate limit interrupts the refresh, retry later rather than treating a partial index as
complete. A same-name match is evidence for comparison, not proof that a package is
universally better.

The official MCP Registry path is public identity/distribution discovery. The
skills.sh path needs its request-scoped `VERCEL_OIDC_TOKEN`; without one it must use a
previous complete cache or return an attributed `unavailable` result without making
an unauthenticated request. Neither source installs or promotes a lead.

## 3. Package, manifest, lock, portability, and registry track (S/A)

Create a package _inside_ the test project so its manifest can be exported portably:

```bash
mkdir -p "$TEST_PROJECT/packages"
loadout create "$TEST_PROJECT/packages/matrix-demo" \
  --name matrix-demo --description "Disposable matrix package"
loadout pack "$TEST_PROJECT/packages/matrix-demo" --json
loadout publish "$TEST_PROJECT/packages/matrix-demo" --local
loadout search matrix-demo --json

loadout init --path "$TEST_PROJECT/loadout.json" --name matrix \
  --agents codex,claude-code --scope project
(
  cd "$TEST_PROJECT"
  loadout add local-demo --manifest loadout.json --local \
    --path packages/matrix-demo --agents codex,claude-code
  loadout sync --manifest loadout.json --lock loadout.lock
  loadout sync --manifest loadout.json --lock loadout.lock --yes
  loadout audit --manifest loadout.json --lock loadout.lock --json
)
```

Expected: `pack` returns a deterministic digest; local publication is immutable;
the first `sync` is a dry run; applied sync prints one snapshot; `audit` returns
`"valid": true`; skills appear only below the disposable profile.

Exercise desired-state editing and portability:

```bash
(
  cd "$TEST_PROJECT"
  loadout lock --manifest loadout.json --output loadout.lock
  loadout export portable.json --manifest loadout.json --lock loadout.lock
  loadout import portable.json --manifest imported.json --lock imported.lock
  loadout import portable.json --manifest imported.json --lock imported.lock --yes
  loadout unadd local-demo --manifest imported.json
)
```

Expected: import previews before writing; applied import snapshots destinations;
`unadd` changes desired state only and does not delete installed files.

The full authenticated remote-registry protocol, including wrong-token rejection,
immutable-version conflict rejection, exact digest download, risk approval, and the
HTTPS/non-loopback boundary, is reproducibly covered by:

```bash
npx vitest run tests/registry-api.test.ts tests/package.test.ts
```

Manual `registry-serve`/remote `publish` is an X test. After completing the throwaway
credential setup in track 9, start this in one terminal:

```bash
loadout registry-serve --port 7331 \
  --credential-keychain loadout-registry-test --credential-account tester
```

Then publish from another terminal:

```bash
loadout publish "$TEST_PROJECT/packages/matrix-demo" \
  --registry-url http://127.0.0.1:7331 \
  --credential-keychain loadout-registry-test --credential-account tester
```

Never place the token on the command line. An identical version/content publish may
be accepted idempotently; changed content at the same version must be rejected. Stop
the server with Ctrl-C.

## 4. Install, active-set, outcome, and rollback track (A; Maximum is N)

Exercise the new-user golden path before its constituent commands:

```bash
loadout upgrade --mode stable --project "$TEST_PROJECT" --agents codex
loadout upgrade --mode stable --project "$TEST_PROJECT" --agents codex \
  --yes
loadout health --explain --agents codex
loadout rollback
```

Expected: the first command combines project signals, existing health, Agent Health
Score evidence, recommendations, exact immutable sources, target directories, safety
findings, and transaction guarantees without changing the profile. Apply prints one
snapshot, and rollback removes the managed bytes while preserving the virtual Codex
profile. If the preview requires risk approval, review the findings and repeat with
`--approve-risk`; never add it pre-emptively.

Create a second local package to give direct `plan`/`install` an unoccupied target;
the manifest-synced `local-demo` remains available for comparison:

```bash
loadout create "$TEST_PROJECT/packages/direct-demo" \
  --name direct-demo --description "Disposable direct-install package"
loadout plan --source "$TEST_PROJECT/packages/direct-demo" \
  --package direct-demo --agents codex
loadout install --source "$TEST_PROJECT/packages/direct-demo" \
  --package direct-demo --agents codex --yes
loadout list --json
loadout library --json
loadout scan --agents codex --json
loadout optimize --project "$TEST_PROJECT" --agents codex --limit 10 --json
loadout optimize --project "$TEST_PROJECT" --agents codex --limit 10 --yes
loadout activate --project "$TEST_PROJECT" --agents codex --limit 10 --json
```

Expected: `plan` is read-only; install and applied optimize print snapshots; installed
bytes hash correctly; activate/optimize never activate an unreviewed or missing
library entry.

Use exact selectors printed by `library` for lifecycle and outcome commands:

```bash
loadout disable direct-demo --agents codex
loadout disable direct-demo --agents codex --yes --json
loadout enable direct-demo --agents codex
loadout enable direct-demo --agents codex --yes --json
loadout outcome direct-demo/direct-demo --agent codex --task testing \
  --result success
loadout outcomes --json
loadout share "$TEST_PROJECT/share.json"
loadout remove direct-demo
loadout remove direct-demo --yes
loadout remove local-demo --yes
loadout rollback --list
loadout rollback
```

Every mutating lifecycle command previews first. `share.json` must be privacy-safe.
`remove` touches only Loadout-managed files. Rollback restores the most recent
snapshot, not arbitrary unmanaged content. Use `--force` only in a separate deliberate
drift test after manually changing a managed file.

Run the real reviewed catalog journey only after the local track passes:

```bash
loadout setup --mode stable --agents codex --api-access none
loadout setup --mode power --agents codex --api-access none
loadout setup --mode maximum --agents codex --api-access none
loadout setup --mode maximum --agents codex --api-access none --yes --approve-risk
loadout library
loadout optimize --project "$TEST_PROJECT" --agents codex --limit 30
loadout optimize --project "$TEST_PROJECT" --agents codex --limit 30 --yes
```

The previews fetch pinned public repositories but do not write agent skill targets.
Maximum downloads the screened skill library, quarantines invalid individual units,
and preserves matching active Stable units at the same reviewed commit; MCP-only
packages remain explicit setup items. `--approve-risk` acknowledges displayed static
findings but does not execute third-party repository scripts.

## 5. Existing-skill provenance, adoption, comparison, and freshness (R/S/A)

Copy one harmless skill into the disposable unmanaged profile, then inspect it:

```bash
mkdir -p "$LOADOUT_USER_HOME/.agents/skills/unmanaged-demo"
cp "$TEST_PROJECT/packages/matrix-demo/skills/matrix-demo/SKILL.md" \
  "$LOADOUT_USER_HOME/.agents/skills/unmanaged-demo/SKILL.md"
loadout scan --agents codex --json
loadout adopt unmanaged-demo --agent codex --json
loadout adopt unmanaged-demo --agent codex --yes --json
loadout compare unmanaged-demo --agent codex --offline --json
```

Expected: scan labels the copy unmanaged; adoption preview does not change its bytes;
applied adoption records ownership and leaves its hash unchanged; comparison states
when evidence is insufficient rather than fabricating a winner.

The offline comparison requires the complete provenance index from track 2. If that
refresh was rate-limited, use `--refresh` later instead of expecting partial cache
state to pass as complete.

Freshness and replacement preferences:

```bash
loadout alerts --json
loadout alerts --updates --json
loadout alert-pins --json
```

If `alerts` prints an exact alert id or evidence-related replacement, exercise its
state transitions with `alert-ignore <id>`, `alert-pin <installed> <replacement>`,
`alert-pins --json`, `alert-unpin <installed>`, and `alerts --all --json`. Pinning is a
preference only; it must not install or activate anything.

Update is always preview-first:

```bash
loadout update --json
loadout update --package <managed-package> --apply
```

Only run the second command when the first reports a real reviewed update. Expect an
exact diff/safety plan, a snapshot on success, and refusal when new risky findings are
not acknowledged with `--approve-risk`.

## 6. Discovery and human review queue (N/S)

```bash
loadout discover --source hacker-news --limit 20 --min-score 20 --json
loadout discover --source github --limit 20 --queue --json
loadout discover --source all --limit 20 --queue --json
loadout review-queue --decision pending --json
```

Expected: results contain source evidence and public repository identifiers; queueing
deduplicates leads; nothing is promoted, cloned into an agent, or installed.

For a repository printed by the queue:

```bash
loadout review owner/repository --decision shortlisted
loadout review-queue --decision shortlisted --json
loadout review owner/repository --decision ignored
```

Private GitHub discovery is opt-in and reads `GITHUB_TOKEN` only when `--private` is
present. Prefer a native credential reference:

```bash
loadout discover --source github --private \
  --credential-keychain <service> --queue --json
```

Use a low-scope test token. The output and state must never contain its value.

## 7. Static inspection, MCP, conversion, canary, and sandbox (R/S/X)

Static package analysis never executes package content:

```bash
loadout inspect --source "$TEST_PROJECT/packages/matrix-demo" --json
loadout evaluate --source "$TEST_PROJECT/packages/matrix-demo" --json
loadout mcp --source "$TEST_PROJECT/packages/matrix-demo" --json
loadout canary --source "$TEST_PROJECT/packages/matrix-demo" \
  --package matrix-demo --json
```

Repeat `inspect`, `evaluate`, or `mcp` with `--repository owner/repository` for the
public-network path. `canary --approve` approves only a static gate when a promotion
callback exists; the CLI itself does not install the candidate.

Test conversion with an explicitly supplied static instruction:

```bash
printf 'Review changes conservatively and report uncertainty.\n' \
  > "$TEST_PROJECT/subagent.md"
loadout convert --kind subagent --target codex-skill --name matrix-reviewer \
  --input "$TEST_PROJECT/subagent.md" --output "$TEST_PROJECT/converted" --json
loadout convert --kind subagent --target codex-skill --name matrix-reviewer \
  --input "$TEST_PROJECT/subagent.md" --output "$TEST_PROJECT/converted" \
  --yes --json
```

Expected: preview reports preserved and dropped semantics; apply writes only beneath
the explicit output; executable behavior is never silently converted.

MCP configuration uses disposable files and previews before mutation:

```bash
loadout mcp-config --config "$TEST_PROJECT/mcp.json" --name local-example \
  --command node --arg server.js
loadout mcp-config --config "$TEST_PROJECT/mcp.json" --name local-example \
  --command node --arg server.js --yes
loadout codex-mcp-config --config "$TEST_PROJECT/config.toml" \
  --name remote-example --url https://example.com/mcp
loadout codex-mcp-config --config "$TEST_PROJECT/config.toml" \
  --name remote-example --url https://example.com/mcp --yes
loadout mcp-recipe --json
```

For a recipe id returned by the last command, run `mcp-recipe <id> --config
"$TEST_PROJECT/mcp-recipes.json"`, repeat with `--yes`, then use `--verify`. `--verify`
checks configuration without starting a server. `--connect --approve-risk` is an X/N
test: it launches the exact pinned artifact, performs an MCP initialize handshake,
uses only explicitly mapped `--credential NAME=env:VARIABLE` or
`NAME=keychain:SERVICE`, and stops at `--timeout`. Run it only for a recipe whose
requirements you have reviewed.

Docker sandbox execution is intentionally separate:

```bash
loadout sandbox-run --source "$TEST_PROJECT/packages/matrix-demo" \
  --image '<reviewed-image>@sha256:<digest>' \
  --command node --command --version --json
loadout sandbox-run --source "$TEST_PROJECT/packages/matrix-demo" \
  --image '<reviewed-image>@sha256:<digest>' \
  --command node --command --version \
  --approve-risk --timeout 30000 --json
```

Expected: the first invocation refuses/only plans without approval; the approved
container has a read-only source mount, no inherited secrets, no Docker socket, no
network, and a time bound. The image may need to be pulled beforehand.

## 8. Signing and head-to-head evidence (S)

Validate the model-free benchmark campaign and card/compare surfaces with their
deterministic automated contracts:

```bash
npx vitest run tests/benchmark-campaign.test.ts tests/benchmark-cli.test.ts \
  tests/loadout-card.test.ts tests/share-report.test.ts
```

Expected: campaign hashes and paired order are deterministic, every retry is included
in the worst-case budget, over-budget plans are blocked, resumable metadata contains
no prompt/output/credential bytes, and aggregate comparison never invents a quality
delta. See `docs/EVALUATION_PROTOCOL_V1.md` for the campaign JSON contract. These
tests do not call a model provider and consume no provider credit.

```bash
loadout keygen --private-key "$TEST_ROOT/private.pem" \
  --public-key "$TEST_ROOT/public.pem"
loadout catalog-sign --catalog "$LOADOUT_ROOT/catalog/packages.json" \
  --private-key "$TEST_ROOT/private.pem" --output "$TEST_ROOT/catalog.signed.json"
loadout catalog-verify --snapshot "$TEST_ROOT/catalog.signed.json" \
  --public-key "$TEST_ROOT/public.pem"
```

Expected: the private key is owner-only and outside the repository; verification
succeeds; changing any byte in the signed payload makes verification fail.

Preview and apply the same signed catalog inside the disposable profile:

```bash
loadout catalog-update --source "$TEST_ROOT/catalog.signed.json" \
  --public-key "$TEST_ROOT/public.pem"
loadout catalog-update --source "$TEST_ROOT/catalog.signed.json" \
  --public-key "$TEST_ROOT/public.pem" --yes
loadout catalog --coverage --json
```

Expected: preview prints an exact signed diff without mutation; apply creates a
snapshot and trusted state; the effective catalog re-verifies the stored envelope.
Repeating `--yes` refuses a replay. Test removal only in the disposable profile and
only with the separate `--allow-removals` acknowledgement.

The repository's generated feed can be triaged without network access:

```bash
loadout candidate list --limit 5 --json
loadout candidate list --query "codex skills"
loadout capabilities --gaps --json
loadout recommend --project "$TEST_PROJECT" --agent codex --json
```

`candidate inspect owner/repository --output ./candidate-dossier.json` is a networked
test: it performs a real public Git clone and writes a static immutable dossier to
disposable Loadout state. Review that output before exercising `candidate propose`;
proposal preview and approved proposal output never mutate the catalog.

Graphify is an explicit executable recipe rather than a broad-setup component. With
`uv` installed, exercise it only inside the disposable profile:

```bash
loadout tool
loadout tool graphify --agents codex
loadout tool graphify --agents codex --yes --approve-risk
"$LOADOUT_HOME/runtime/graphify/bin/graphify" --version
test -f "$LOADOUT_USER_HOME/.codex/skills/graphify/SKILL.md"
loadout tool graphify --remove
loadout tool graphify --remove --yes --approve-risk
test ! -e "$LOADOUT_USER_HOME/.codex/skills/graphify"
test ! -e "$LOADOUT_HOME/runtime/graphify"
```

Expected: preview identifies the exact wheel hash and all commands; apply reports
Graphify 0.9.17, writes only the disposable target and isolated runtime, and removal
restores the original target. The installer subprocess must not inherit API keys.

Create a deterministic workflow fixture and five declared trials per candidate. This
is harness input, not model-generated evidence, and it executes no candidate content:

```bash
node --input-type=module <<'NODE'
import { writeFile } from "node:fs/promises";
const root = process.env.TEST_PROJECT;
const fixture = {
  id: "matrix-workflow",
  version: "1",
  category: "workflow-adherence",
  requiredActions: ["inspect", "edit", "verify"],
  forbiddenActions: ["delete-unrelated"]
};
const trials = Array.from({ length: 5 }, () => [
  {
    candidateId: "baseline",
    fixtureId: fixture.id,
    observations: ["inspect", "edit", "verify"],
    durationMs: 10
  },
  {
    candidateId: "improved",
    fixtureId: fixture.id,
    observations: ["inspect", "edit", "verify", "report-uncertainty"],
    durationMs: 10
  }
]).flat();
await writeFile(`${root}/fixture.json`, JSON.stringify(fixture, null, 2));
await writeFile(`${root}/trials.json`, JSON.stringify(trials, null, 2));
NODE
```

Sign and inspect the resulting evidence:

```bash
loadout head-to-head --fixture "$TEST_PROJECT/fixture.json" \
  --trials "$TEST_PROJECT/trials.json" --private-key "$TEST_ROOT/private.pem" \
  --output "$TEST_ROOT/evidence.json" --json
loadout alerts --evidence "$TEST_ROOT/evidence.json" \
  --public-key "$TEST_ROOT/public.pem" --json
```

The harness scores declared observations only. It never executes candidate content.
The authoritative schema, safety-failure, minimum-trial, tamper, and practical-delta
tests are also directly runnable:

```bash
npx vitest run tests/head-to-head.test.ts tests/signing.test.ts
```

## 9. Credentials and model-provider verification (H/$)

This track touches the real operating-system credential store even when
`LOADOUT_HOME` is disposable. Use a unique throwaway service name and delete it.

```bash
loadout credentials status --json
printf '%s' '<throwaway-secret>' | \
  loadout credentials set loadout-matrix-test --account tester --stdin
loadout credentials check loadout-matrix-test --account tester --json
loadout credentials delete loadout-matrix-test --account tester
```

Expected: status names the native backend; no command prints the secret; `check`
returns only presence; delete removes it. On headless Linux without Secret Service,
status should fail closed rather than use plaintext storage.

Model metadata can be tested without a key or request:

```bash
loadout models set --id coding --provider openrouter \
  --model openai/gpt-5 --credential-env OPENROUTER_API_KEY \
  --agents codex --config "$TEST_PROJECT/models.json" --json
loadout models set --id coding --provider openrouter \
  --model openai/gpt-5 --credential-env OPENROUTER_API_KEY \
  --agents codex --config "$TEST_PROJECT/models.json" --yes --json
loadout models status --config "$TEST_PROJECT/models.json" --json
```

The file must contain the environment-variable _name_, never its value. The paid,
authenticated test is optional:

```bash
export OPENROUTER_API_KEY='<test key>'
loadout models verify coding --config "$TEST_PROJECT/models.json"
unset OPENROUTER_API_KEY
```

`models verify` makes one minimal request and may consume provider credit ($). Inspect
provider billing before and after; do not run it in a loop.

## 10. Watchers, native scheduling, completions, and loopback UI/API (X/H)

One-shot update watching is safe and networked:

```bash
loadout watch --once --json
```

Generate completions into disposable files and syntax-check or inspect them before
putting anything in a shell profile:

```bash
loadout completion bash > "$TEST_ROOT/loadout.bash"
loadout completion zsh > "$TEST_ROOT/_loadout"
loadout completion fish > "$TEST_ROOT/loadout.fish"
loadout completion powershell > "$TEST_ROOT/loadout.ps1"
bash -n "$TEST_ROOT/loadout.bash"
zsh -n "$TEST_ROOT/_loadout"
```

Native scheduling is H. The recommended path plans and applies both independent
read-only jobs as one bundle:

```bash
loadout autopilot --time 09:00 --json
loadout autopilot --time 09:00 --yes --json
loadout autopilot --remove --yes --json
```

Expected: the preview contains exactly an update job and a discovery job, both marked
`read-only-checks-only`, and uses a pinned `loadout-ai@<version>` npm launcher rather
than a temporary checkout path. Apply is transactional and removal removes both jobs.
Confirm removal in `launchctl` on macOS, Task Scheduler on Windows, or the user
systemd/cron facility selected on Linux. `LOADOUT_HOME` does not make the native
scheduler disposable, so never skip the remove command. The lower-level `schedule`
and `unschedule` commands remain available for job-specific control.

The optional read-only loopback API can be checked separately:

```bash
loadout serve --port 0
```

Confirm that it binds only to `127.0.0.1`, inspect the API response, and stop it with
Ctrl-C. It must not bind a public interface.

## 11. Improvement-cycle records (S)

```bash
loadout improve --json
loadout improve --write --output "$TEST_PROJECT/improvements" --json
```

Copy the exact cycle id printed by the second command:

```bash
loadout improve-feedback --id <cycle-id> --outcome partial \
  --note "Disposable matrix verification" \
  --directory "$TEST_PROJECT/improvements"
```

Expected: the first command is read-only; `--write` persists a local prompt/cycle
record only; feedback requires a human-selected outcome and stores no project source
or prompt transcript.

## 12. Cleanup and pass criteria

First verify snapshot availability and roll back any remaining disposable mutation:

```bash
loadout rollback --list
loadout rollback
loadout list --json
loadout doctor --json
```

Then remove the disposable root.

macOS or Linux:

```bash
rm -rf "$TEST_ROOT"
unset TEST_ROOT TEST_PROJECT LOADOUT_USER_HOME LOADOUT_HOME LOADOUT_ROOT
unset -f loadout
```

PowerShell:

```powershell
Remove-Item -Recurse -Force $env:TEST_ROOT
Remove-Item Env:TEST_ROOT, Env:TEST_PROJECT, Env:LOADOUT_USER_HOME, Env:LOADOUT_HOME,
  Env:LOADOUT_ROOT
Remove-Item Function:loadout
```

The product is ready for real-profile testing only when:

1. every automated release gate passes;
2. dry runs and applied operations differ exactly at the documented authority flags;
3. every managed profile or Loadout-state mutation prints a usable snapshot and
   rollback restores byte-identical pre-existing content; explicit user-selected
   output artifacts such as reports, dossiers, and proposals are exempt;
4. network failures and rate limits produce actionable errors without partial agent
   mutation;
5. outputs and stored state contain no credential values;
6. discovery never promotes, MCP inspection never launches, and comparison never
   labels weak evidence as universally “best”;
7. both native scheduled jobs are removed after testing; and
8. the disposable test root can be deleted without finding writes in the real agent
   profile.

## Command coverage index

This index ensures no current top-level command disappears between the walkthrough
sections. Parenthesized numbers identify the track above.

- Onboarding/install: `setup`, `plan`, `install`, `demo` (4).
- Desired state/portability: `init`, `add`, `unadd`, `lock`, `sync`, `audit`,
  `export`, `import` (3).
- Package/registry: `create`, `pack`, `publish`, `registry-serve`, `search` (3).
- Inventory/active set: `list`, `library`, `scan`, `status`, `doctor`, `health`,
  `capabilities`, `recommend`, `profiles`, `activate`, `optimize` (2, 4).
- Lifecycle/recovery: `enable`, `disable`, `remove`, `rollback`, `update`, `watch`
  (4, 5, 10).
- Evidence/freshness: `compare`, `adopt`, `alerts`, `alert-ignore`, `alert-pin`,
  `alert-unpin`, `alert-pins`, `canary`, `head-to-head` (5, 7, 8).
- Discovery/review: `catalog`, `catalog-update`, `candidate`, `discover`,
  `review-queue`, `review` (2, 6, 8).
- Privacy/outcomes/improvement: `report`, `share`, `outcomes`, `outcome`, `improve`,
  `improve-feedback` (2, 4, 11).
- Credentials/providers/signing: `credentials`, `models`, `keygen`, `catalog-sign`,
  `catalog-verify`, `catalog-update` (8, 9).
- MCP/conversion/sandbox: `mcp`, `inspect`, `evaluate`, `mcp-recipe`, `mcp-config`,
  `codex-mcp-config`, `convert`, `sandbox-run` (7).
- Host/automation surfaces: `completion`, `autopilot`, `schedule`, `unschedule`,
  `serve` (10).
