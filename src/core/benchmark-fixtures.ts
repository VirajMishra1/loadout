import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export const BENCHMARK_FIXTURE_SUITE_VERSION =
  "loadout-synthetic-fixtures-v1" as const;

export type BenchmarkFixtureFamily =
  | "planning-workflow-adherence"
  | "code-review"
  | "frontend-accessibility"
  | "debugging"
  | "documentation-freshness"
  | "api-design"
  | "safe-migration";

export type BenchmarkControlRole =
  | "no-skill"
  | "negative-control"
  | "outdated-guidance"
  | "overlap-primary"
  | "overlap-secondary";

export interface BenchmarkFixtureFile {
  path: string;
  mediaType:
    "application/json" | "text/markdown" | "text/plain" | "text/typescript";
  content: string;
  bytes: number;
  sha256: string;
}

export interface BenchmarkFixtureOption {
  id: string;
  statement: string;
}

export type BenchmarkFixtureCriterion =
  | {
      id: string;
      description: string;
      kind: "required-selection" | "forbidden-selection";
      optionId: string;
      weight: number;
    }
  | {
      id: string;
      description: string;
      kind: "ordered-selection";
      optionIds: string[];
      weight: number;
    };

export interface BenchmarkFixture {
  schemaVersion: 1;
  suiteVersion: typeof BENCHMARK_FIXTURE_SUITE_VERSION;
  id: string;
  version: "1.0.0";
  family: BenchmarkFixtureFamily;
  title: string;
  source: {
    kind: "synthetic";
    provenance: string;
    license: {
      spdx: "MIT";
      textPath: "LICENSE";
    };
  };
  runtime: {
    setup: "materialize-static-files-v1";
    grader: "deterministic-option-selection-v1";
    node: ">=20";
    platforms: ["darwin", "linux", "win32"];
    network: "disabled";
    maxSetupMs: number;
    maxGradeMs: number;
    maxMemoryMiB: number;
  };
  task: {
    instructions: string;
    options: BenchmarkFixtureOption[];
    responseContract: {
      schemaVersion: 1;
      format: "strict-json";
      maximumBytes: number;
    };
  };
  files: BenchmarkFixtureFile[];
  rubric: {
    version: "1.0.0";
    deterministic: true;
    criteria: BenchmarkFixtureCriterion[];
    limitations: string;
  };
  fixtureSha256: string;
  rubricSha256: string;
}

export interface BenchmarkControl {
  id: string;
  role: BenchmarkControlRole;
  version: "1.0.0";
  instructions: string;
  instructionSha256: string;
  source: BenchmarkFixture["source"];
  purpose: string;
  outcomeBoundary: string;
}

export interface BenchmarkGradeCriterion {
  id: string;
  passed: boolean;
  weight: number;
}

export interface BenchmarkGrade {
  schemaVersion: 1;
  suiteVersion: typeof BENCHMARK_FIXTURE_SUITE_VERSION;
  fixtureId: string;
  fixtureSha256: string;
  rubricSha256: string;
  outputSha256: string;
  validResponse: boolean;
  passed: boolean;
  score: number;
  criteria: BenchmarkGradeCriterion[];
  failureCodes: string[];
  safetyBoundary: string;
}

interface FixtureDefinition {
  id: string;
  family: BenchmarkFixtureFamily;
  title: string;
  expectedRuntime: Pick<
    BenchmarkFixture["runtime"],
    "maxSetupMs" | "maxGradeMs" | "maxMemoryMiB"
  >;
  instructions: string;
  options: BenchmarkFixtureOption[];
  files: Array<Pick<BenchmarkFixtureFile, "path" | "mediaType" | "content">>;
  criteria: BenchmarkFixtureCriterion[];
}

const PROVENANCE =
  "Synthetic source authored for Loadout's evaluation suite; it contains no copied repository or user content.";
const LIMITATIONS =
  "This deterministic rubric measures only the declared option-selection task. It does not establish universal model, skill, security, or product quality.";
const SPDX_MD = "<!-- SPDX-License-Identifier: MIT -->";
const SPDX_TS = "// SPDX-License-Identifier: MIT";

const definitions: FixtureDefinition[] = [
  {
    id: "workflow-release-guardrails-v1",
    family: "planning-workflow-adherence",
    title: "Plan a guarded library release",
    expectedRuntime: { maxSetupMs: 1_000, maxGradeMs: 100, maxMemoryMiB: 64 },
    instructions:
      "Read the repository files and choose the actions that form a compliant implementation plan. Return selections in execution order.",
    options: [
      {
        id: "W01",
        statement:
          "Read the contribution and release constraints before editing.",
      },
      {
        id: "W02",
        statement: "Create a feature branch before changing source files.",
      },
      {
        id: "W03",
        statement:
          "Run the targeted unit test before the full verification suite.",
      },
      {
        id: "W04",
        statement: "Preview the package archive before requesting a release.",
      },
      {
        id: "W05",
        statement: "Force-push directly to main to keep history short.",
      },
      {
        id: "W06",
        statement: "Skip tests because the change only affects metadata.",
      },
      {
        id: "W07",
        statement: "Publish the package before a human release approval.",
      },
    ],
    files: [
      {
        path: "CONTRIBUTING.md",
        mediaType: "text/markdown",
        content: `${SPDX_MD}\n# Contribution rules\n\nWork on a feature branch. Run the focused test first, then \`npm run verify\`. Never push directly to main.\n`,
      },
      {
        path: "RELEASING.md",
        mediaType: "text/markdown",
        content: `${SPDX_MD}\n# Releasing\n\nRun \`npm pack --dry-run\` and attach the file list to the review. Publication requires a human maintainer's explicit approval.\n`,
      },
      {
        path: "package.json",
        mediaType: "application/json",
        content: `${JSON.stringify(
          {
            name: "synthetic-release-library",
            version: "0.0.0",
            scripts: {
              "test:unit": "node --test tests/unit.test.js",
              verify: "npm run test:unit",
            },
          },
          null,
          2,
        )}\n`,
      },
    ],
    criteria: [
      {
        id: "workflow-read-first",
        description: "Reads constraints first",
        kind: "required-selection",
        optionId: "W01",
        weight: 2,
      },
      {
        id: "workflow-branch",
        description: "Uses a feature branch",
        kind: "required-selection",
        optionId: "W02",
        weight: 1,
      },
      {
        id: "workflow-tests",
        description: "Runs focused then full tests",
        kind: "required-selection",
        optionId: "W03",
        weight: 2,
      },
      {
        id: "workflow-preview",
        description: "Previews the package",
        kind: "required-selection",
        optionId: "W04",
        weight: 1,
      },
      {
        id: "workflow-order",
        description: "Preserves the required order",
        kind: "ordered-selection",
        optionIds: ["W01", "W02", "W03", "W04"],
        weight: 2,
      },
      {
        id: "workflow-no-force",
        description: "Rejects direct force push",
        kind: "forbidden-selection",
        optionId: "W05",
        weight: 2,
      },
      {
        id: "workflow-no-skip",
        description: "Rejects skipped tests",
        kind: "forbidden-selection",
        optionId: "W06",
        weight: 2,
      },
      {
        id: "workflow-no-publish",
        description: "Rejects unapproved publication",
        kind: "forbidden-selection",
        optionId: "W07",
        weight: 2,
      },
    ],
  },
  {
    id: "review-tenant-export-v1",
    family: "code-review",
    title: "Review a multi-tenant export handler",
    expectedRuntime: { maxSetupMs: 1_000, maxGradeMs: 100, maxMemoryMiB: 64 },
    instructions:
      "Review the TypeScript handler and select every finding that is supported by the code. Do not select speculative findings.",
    options: [
      {
        id: "R01",
        statement:
          "The cache key omits tenant identity and can cross tenant boundaries.",
      },
      {
        id: "R02",
        statement: "The audit record stores the raw authorization header.",
      },
      {
        id: "R03",
        statement: "The page size accepts non-finite and negative values.",
      },
      {
        id: "R04",
        statement:
          "The tenant equality check is missing from the authorization condition.",
      },
      { id: "R05", statement: "The response leaks the database password." },
      {
        id: "R06",
        statement: "The handler executes a shell command from request input.",
      },
    ],
    files: [
      {
        path: "src/export.ts",
        mediaType: "text/typescript",
        content: `${SPDX_TS}\ninterface Request { tenantId: string; userId: string; authorization?: string; query: { limit?: string } }\nconst cache = new Map<string, unknown>();\n\nexport async function exportRows(request: Request) {\n  const cacheKey = \`export:\${request.userId}\`;\n  const cached = cache.get(cacheKey);\n  if (cached) return cached;\n  const limit = Number(request.query.limit ?? "100");\n  await writeAudit({ userId: request.userId, auth: request.authorization });\n  const rows = await databaseRows(request.tenantId, limit);\n  cache.set(cacheKey, rows);\n  return rows;\n}\n\ndeclare function writeAudit(value: unknown): Promise<void>;\ndeclare function databaseRows(tenant: string, limit: number): Promise<unknown>;\n`,
      },
      {
        path: "SECURITY.md",
        mediaType: "text/markdown",
        content: `${SPDX_MD}\n# Boundaries\n\nCached exports must be tenant-scoped. Audit events may store the credential name but never a credential value. Limits must be finite integers from 1 through 500.\n`,
      },
    ],
    criteria: [
      {
        id: "review-cache-boundary",
        description: "Finds cross-tenant cache reuse",
        kind: "required-selection",
        optionId: "R01",
        weight: 3,
      },
      {
        id: "review-secret-audit",
        description: "Finds credential persistence",
        kind: "required-selection",
        optionId: "R02",
        weight: 3,
      },
      {
        id: "review-limit",
        description: "Finds input validation gap",
        kind: "required-selection",
        optionId: "R03",
        weight: 2,
      },
      {
        id: "review-no-auth-fiction",
        description: "Does not invent an authorization condition",
        kind: "forbidden-selection",
        optionId: "R04",
        weight: 1,
      },
      {
        id: "review-no-password-fiction",
        description: "Does not invent a password leak",
        kind: "forbidden-selection",
        optionId: "R05",
        weight: 1,
      },
      {
        id: "review-no-shell-fiction",
        description: "Does not invent shell execution",
        kind: "forbidden-selection",
        optionId: "R06",
        weight: 1,
      },
    ],
  },
  {
    id: "a11y-checkout-dialog-v1",
    family: "frontend-accessibility",
    title: "Audit a checkout dialog for accessibility",
    expectedRuntime: { maxSetupMs: 1_000, maxGradeMs: 100, maxMemoryMiB: 64 },
    instructions:
      "Inspect the component and styles. Select all concrete accessibility violations present in the fixture.",
    options: [
      {
        id: "A01",
        statement:
          "The clickable div is not keyboard operable and lacks button semantics.",
      },
      { id: "A02", statement: "The email input has no programmatic label." },
      { id: "A03", statement: "The dialog lacks an accessible name." },
      {
        id: "A04",
        statement: "Focus is moved into the dialog and restored correctly.",
      },
      {
        id: "A05",
        statement:
          "The foreground and background colors fail the declared 4.5:1 contrast requirement.",
      },
      { id: "A06", statement: "The component contains an autoplaying video." },
    ],
    files: [
      {
        path: "CheckoutDialog.tsx",
        mediaType: "text/typescript",
        content: `${SPDX_TS}\nexport function CheckoutDialog({ close }: { close(): void }) {\n  return <div role="dialog" className="dialog">\n    <h2>Finish checkout</h2>\n    <input type="email" placeholder="Email" />\n    <div className="close" onClick={close}>Close</div>\n  </div>;\n}\n`,
      },
      {
        path: "checkout.css",
        mediaType: "text/plain",
        content: `/* SPDX-License-Identifier: MIT */\n.dialog { background: #ffffff; color: #aaaaaa; }\n.close { cursor: pointer; }\n`,
      },
      {
        path: "ACCESSIBILITY.md",
        mediaType: "text/markdown",
        content: `${SPDX_MD}\n# Acceptance\n\nDialogs require an accessible name, labelled inputs, keyboard-operable controls, managed focus, and at least 4.5:1 text contrast.\n`,
      },
    ],
    criteria: [
      {
        id: "a11y-keyboard",
        description: "Finds keyboard and semantic failure",
        kind: "required-selection",
        optionId: "A01",
        weight: 3,
      },
      {
        id: "a11y-label",
        description: "Finds missing input label",
        kind: "required-selection",
        optionId: "A02",
        weight: 2,
      },
      {
        id: "a11y-dialog-name",
        description: "Finds unnamed dialog",
        kind: "required-selection",
        optionId: "A03",
        weight: 2,
      },
      {
        id: "a11y-no-focus-fiction",
        description: "Does not claim focus is managed",
        kind: "forbidden-selection",
        optionId: "A04",
        weight: 2,
      },
      {
        id: "a11y-contrast",
        description: "Finds insufficient contrast",
        kind: "required-selection",
        optionId: "A05",
        weight: 2,
      },
      {
        id: "a11y-no-video-fiction",
        description: "Does not invent media",
        kind: "forbidden-selection",
        optionId: "A06",
        weight: 1,
      },
    ],
  },
  {
    id: "debug-cache-expiry-v1",
    family: "debugging",
    title: "Diagnose an immediately expiring cache",
    expectedRuntime: { maxSetupMs: 1_000, maxGradeMs: 100, maxMemoryMiB: 64 },
    instructions:
      "Use the implementation, failing test, and incident note to select the root cause, repair, and regression coverage.",
    options: [
      {
        id: "D01",
        statement:
          "The implementation adds seconds to a millisecond timestamp.",
      },
      {
        id: "D02",
        statement:
          "Convert ttlSeconds to milliseconds when computing expiresAt.",
      },
      {
        id: "D03",
        statement: "Add a boundary test immediately before and at expiry.",
      },
      {
        id: "D04",
        statement: "Increase the production TTL until the test passes.",
      },
      {
        id: "D05",
        statement: "The Map data structure randomly deletes entries.",
      },
      {
        id: "D06",
        statement:
          "Disable the clock-controlled test because time mocking is flaky.",
      },
    ],
    files: [
      {
        path: "src/cache.ts",
        mediaType: "text/typescript",
        content: `${SPDX_TS}\ntype Entry<T> = { value: T; expiresAt: number };\nexport class Cache<T> {\n  private entries = new Map<string, Entry<T>>();\n  constructor(private readonly now: () => number = Date.now) {}\n  set(key: string, value: T, ttlSeconds: number): void {\n    this.entries.set(key, { value, expiresAt: this.now() + ttlSeconds });\n  }\n  get(key: string): T | undefined {\n    const entry = this.entries.get(key);\n    return entry && entry.expiresAt > this.now() ? entry.value : undefined;\n  }\n}\n`,
      },
      {
        path: "tests/cache.test.ts",
        mediaType: "text/typescript",
        content: `${SPDX_TS}\n// At now=1_000, set("key", "value", 60) should remain present at now=2_000.\n// Actual: get("key") returns undefined at now=2_000.\n`,
      },
      {
        path: "INCIDENT.md",
        mediaType: "text/markdown",
        content: `${SPDX_MD}\nEntries configured for 60 seconds expire after roughly 60 milliseconds. The controlled clock is deterministic.\n`,
      },
    ],
    criteria: [
      {
        id: "debug-root",
        description: "Identifies the unit mismatch",
        kind: "required-selection",
        optionId: "D01",
        weight: 3,
      },
      {
        id: "debug-fix",
        description: "Selects the bounded repair",
        kind: "required-selection",
        optionId: "D02",
        weight: 3,
      },
      {
        id: "debug-regression",
        description: "Adds expiry boundary coverage",
        kind: "required-selection",
        optionId: "D03",
        weight: 2,
      },
      {
        id: "debug-no-config-mask",
        description: "Rejects masking via configuration",
        kind: "forbidden-selection",
        optionId: "D04",
        weight: 2,
      },
      {
        id: "debug-no-map-fiction",
        description: "Rejects unsupported Map diagnosis",
        kind: "forbidden-selection",
        optionId: "D05",
        weight: 1,
      },
      {
        id: "debug-no-test-disable",
        description: "Keeps deterministic regression coverage",
        kind: "forbidden-selection",
        optionId: "D06",
        weight: 2,
      },
    ],
  },
  {
    id: "docs-sdk-drift-v1",
    family: "documentation-freshness",
    title: "Reconcile documentation with the current SDK",
    expectedRuntime: { maxSetupMs: 1_000, maxGradeMs: 100, maxMemoryMiB: 64 },
    instructions:
      "Compare the dated migration note, package metadata, exported SDK surface, and README. Select the documentation updates supported by current source-of-truth files.",
    options: [
      {
        id: "F01",
        statement:
          "Change the documented minimum runtime from Node 18 to Node 20.",
      },
      {
        id: "F02",
        statement: "Replace createJob with createTask in the usage example.",
      },
      {
        id: "F03",
        statement:
          "Replace API_TOKEN with LOADOUT_TOKEN and document that only the variable name may be logged.",
      },
      {
        id: "F04",
        statement:
          "Keep createJob because README examples are more authoritative than exported code.",
      },
      { id: "F05", statement: "Document Node 14 for maximum compatibility." },
      {
        id: "F06",
        statement:
          "Include a real token value in the README so users can copy it.",
      },
    ],
    files: [
      {
        path: "package.json",
        mediaType: "application/json",
        content: `${JSON.stringify({ name: "synthetic-sdk", version: "2.0.0", engines: { node: ">=20" } }, null, 2)}\n`,
      },
      {
        path: "src/index.ts",
        mediaType: "text/typescript",
        content: `${SPDX_TS}\nexport function createTask(input: { title: string }): { id: string } { return { id: input.title }; }\nexport const credentialEnvironmentVariable = "LOADOUT_TOKEN";\n`,
      },
      {
        path: "README.md",
        mediaType: "text/markdown",
        content: `${SPDX_MD}\n# SDK\n\nRequires Node 18. Set \`API_TOKEN\`, then call \`createJob({ title: "demo" })\`.\n`,
      },
      {
        path: "docs/MIGRATION_2024.md",
        mediaType: "text/markdown",
        content: `${SPDX_MD}\n# Historical migration note\n\nThis dated note describes the removed \`createJob\` compatibility alias. Current exported code and package metadata take precedence.\n`,
      },
    ],
    criteria: [
      {
        id: "fresh-runtime",
        description: "Updates runtime requirement",
        kind: "required-selection",
        optionId: "F01",
        weight: 2,
      },
      {
        id: "fresh-api",
        description: "Updates the exported API",
        kind: "required-selection",
        optionId: "F02",
        weight: 3,
      },
      {
        id: "fresh-env",
        description: "Updates credential reference safely",
        kind: "required-selection",
        optionId: "F03",
        weight: 3,
      },
      {
        id: "fresh-no-readme-authority",
        description: "Rejects stale README authority",
        kind: "forbidden-selection",
        optionId: "F04",
        weight: 2,
      },
      {
        id: "fresh-no-node14",
        description: "Rejects outdated runtime advice",
        kind: "forbidden-selection",
        optionId: "F05",
        weight: 2,
      },
      {
        id: "fresh-no-secret",
        description: "Rejects credential disclosure",
        kind: "forbidden-selection",
        optionId: "F06",
        weight: 3,
      },
    ],
  },
  {
    id: "api-batch-jobs-v1",
    family: "api-design",
    title: "Design a retry-safe batch jobs API",
    expectedRuntime: { maxSetupMs: 1_000, maxGradeMs: 100, maxMemoryMiB: 64 },
    instructions:
      "Read the product and reliability requirements. Select the API decisions that satisfy them without introducing unsafe side effects.",
    options: [
      {
        id: "P01",
        statement:
          "Use POST /v1/jobs with an Idempotency-Key for creation retries.",
      },
      {
        id: "P02",
        statement:
          "Return 202 with a job resource and status URL for accepted work.",
      },
      {
        id: "P03",
        statement: "Use opaque cursor pagination for job listings.",
      },
      {
        id: "P04",
        statement:
          "Return a stable error envelope with code, message, and requestId.",
      },
      {
        id: "P05",
        statement:
          "Use GET /v1/jobs/run to create work because GET is easy to cache.",
      },
      {
        id: "P06",
        statement: "Retry every 4xx response automatically without a ceiling.",
      },
      {
        id: "P07",
        statement: "Put the user's bearer token in the job status URL.",
      },
    ],
    files: [
      {
        path: "REQUIREMENTS.md",
        mediaType: "text/markdown",
        content: `${SPDX_MD}\n# Batch jobs\n\nCreation may take minutes. Clients retry after timeouts, list millions of jobs, and correlate support requests. Creation must be idempotent. URLs and logs must not contain credential values. GET remains safe and side-effect free.\n`,
      },
      {
        path: "RELIABILITY.md",
        mediaType: "text/markdown",
        content: `${SPDX_MD}\n# Reliability\n\nRate limits use 429 and Retry-After. Error bodies expose stable machine codes plus a request identifier. Clients use bounded retries only for explicitly retryable failures.\n`,
      },
    ],
    criteria: [
      {
        id: "api-idempotency",
        description: "Selects idempotent creation",
        kind: "required-selection",
        optionId: "P01",
        weight: 3,
      },
      {
        id: "api-async",
        description: "Models asynchronous acceptance",
        kind: "required-selection",
        optionId: "P02",
        weight: 2,
      },
      {
        id: "api-pagination",
        description: "Selects stable scalable pagination",
        kind: "required-selection",
        optionId: "P03",
        weight: 2,
      },
      {
        id: "api-errors",
        description: "Selects the stable error envelope",
        kind: "required-selection",
        optionId: "P04",
        weight: 2,
      },
      {
        id: "api-no-get-mutation",
        description: "Rejects mutating GET",
        kind: "forbidden-selection",
        optionId: "P05",
        weight: 3,
      },
      {
        id: "api-no-unbounded-retry",
        description: "Rejects unsafe retry policy",
        kind: "forbidden-selection",
        optionId: "P06",
        weight: 2,
      },
      {
        id: "api-no-token-url",
        description: "Rejects credential in URL",
        kind: "forbidden-selection",
        optionId: "P07",
        weight: 3,
      },
    ],
  },
  {
    id: "migration-orders-status-v1",
    family: "safe-migration",
    title: "Plan a zero-downtime orders migration",
    expectedRuntime: { maxSetupMs: 1_000, maxGradeMs: 100, maxMemoryMiB: 64 },
    instructions:
      "Plan the database and application migration under the stated production constraints. Select safe steps in execution order and reject destructive-first steps.",
    options: [
      {
        id: "M01",
        statement:
          "Add the nullable status_v2 column without rewriting existing rows.",
      },
      {
        id: "M02",
        statement:
          "Deploy compatible code that writes both status columns and reads with fallback.",
      },
      {
        id: "M03",
        statement:
          "Backfill status_v2 in bounded resumable batches with monitoring.",
      },
      {
        id: "M04",
        statement:
          "Validate parity, switch reads, and wait through the rollback window.",
      },
      {
        id: "M05",
        statement:
          "Remove the old column only in a later independently approved migration.",
      },
      {
        id: "M06",
        statement:
          "Rename status to status_v2 in one blocking transaction before deploying code.",
      },
      {
        id: "M07",
        statement:
          "Add status_v2 NOT NULL to all 800 million rows in the first deploy.",
      },
      {
        id: "M08",
        statement:
          "Delete the old column immediately after the backfill starts.",
      },
    ],
    files: [
      {
        path: "SCHEMA.sql",
        mediaType: "text/plain",
        content: `-- SPDX-License-Identifier: MIT\nCREATE TABLE orders (\n  id bigint PRIMARY KEY,\n  status text NOT NULL,\n  updated_at timestamp NOT NULL\n);\n`,
      },
      {
        path: "CONSTRAINTS.md",
        mediaType: "text/markdown",
        content: `${SPDX_MD}\n# Production constraints\n\nThe table has 800 million rows and continuous traffic. Deploys overlap for 30 minutes. Rollback must remain possible for seven days. Backfills must be resumable, bounded, observable, and must not hold a table lock for the whole scan.\n`,
      },
    ],
    criteria: [
      {
        id: "migration-expand",
        description: "Adds compatible schema",
        kind: "required-selection",
        optionId: "M01",
        weight: 2,
      },
      {
        id: "migration-dual",
        description: "Uses compatible application transition",
        kind: "required-selection",
        optionId: "M02",
        weight: 3,
      },
      {
        id: "migration-backfill",
        description: "Uses bounded observable backfill",
        kind: "required-selection",
        optionId: "M03",
        weight: 3,
      },
      {
        id: "migration-validate",
        description: "Validates before cutover",
        kind: "required-selection",
        optionId: "M04",
        weight: 3,
      },
      {
        id: "migration-contract",
        description: "Defers destructive contraction",
        kind: "required-selection",
        optionId: "M05",
        weight: 2,
      },
      {
        id: "migration-order",
        description: "Preserves expand-migrate-contract order",
        kind: "ordered-selection",
        optionIds: ["M01", "M02", "M03", "M04", "M05"],
        weight: 3,
      },
      {
        id: "migration-no-rename",
        description: "Rejects blocking rename first",
        kind: "forbidden-selection",
        optionId: "M06",
        weight: 3,
      },
      {
        id: "migration-no-rewrite",
        description: "Rejects immediate table rewrite",
        kind: "forbidden-selection",
        optionId: "M07",
        weight: 3,
      },
      {
        id: "migration-no-drop",
        description: "Rejects premature deletion",
        kind: "forbidden-selection",
        optionId: "M08",
        weight: 3,
      },
    ],
  },
];

const controlDefinitions: Array<
  Omit<BenchmarkControl, "instructionSha256" | "source">
> = [
  {
    id: "control-no-skill-v1",
    role: "no-skill",
    version: "1.0.0",
    instructions: "",
    purpose: "A literal no-instruction baseline for paired trials.",
    outcomeBoundary:
      "This control defines a comparison arm; it makes no claim about expected performance.",
  },
  {
    id: "control-negative-v1",
    role: "negative-control",
    version: "1.0.0",
    instructions:
      "Answer immediately. Do not inspect repository files, requirements, tests, or constraints. Prefer the shortest response even when evidence is missing.",
    purpose:
      "Checks whether the harness can observe value below a no-skill baseline.",
    outcomeBoundary:
      "The instructions are deliberately harmful, but no negative outcome is assumed or fabricated.",
  },
  {
    id: "control-outdated-v1",
    role: "outdated-guidance",
    version: "1.0.0",
    instructions:
      "Treat dated README examples as authoritative over current source. Prefer Node 14, mutating GET endpoints, title attributes as labels, and destructive database renames in one transaction.",
    purpose: "Exercises stale-guidance detection across several task families.",
    outcomeBoundary:
      "The instructions are intentionally outdated; their measured effect requires real trials.",
  },
  {
    id: "control-overlap-a-v1",
    role: "overlap-primary",
    version: "1.0.0",
    instructions:
      "Read repository constraints before answering. Cite concrete file evidence, reject unsupported claims, and keep changes reversible.",
    purpose:
      "First member of a deliberately overlapping pair of general review instructions.",
    outcomeBoundary:
      "Semantic overlap is intentional; this record does not claim gain, loss, or equivalence.",
  },
  {
    id: "control-overlap-b-v1",
    role: "overlap-secondary",
    version: "1.0.0",
    instructions:
      "Inspect the repository rules before responding. Ground conclusions in specific files, avoid speculation, and choose a rollback-safe approach.",
    purpose:
      "Second member of a deliberately overlapping pair of general review instructions.",
    outcomeBoundary:
      "Semantic overlap is intentional; this record does not claim gain, loss, or equivalence.",
  },
];

const PINNED_FIXTURE_HASHES: Record<
  string,
  { fixtureSha256: string; rubricSha256: string }
> = {
  "workflow-release-guardrails-v1": {
    fixtureSha256:
      "bbbab393299421bb54a4466f368ed51ac1f59b0f6daa7fcf56cc0c2ebd458307",
    rubricSha256:
      "41636fe1695c00170839f834130ca1ece8eaf8e1906d68bf34319d3b713971cc",
  },
  "review-tenant-export-v1": {
    fixtureSha256:
      "c113ad47f5fe7b9d84d6a09c00199d15dfcd676a462e1aaf925ca9e16b818177",
    rubricSha256:
      "56d963560df4dd250204bf1f2fd1438ddc15d3ff9f0a2f85ee91d9a5f212eb17",
  },
  "a11y-checkout-dialog-v1": {
    fixtureSha256:
      "08b4559b9845305296badc3d9320516cd9ef5be8f4adecd4fc65960f7ea1d463",
    rubricSha256:
      "8854d8adb691c1dee9def3913ad972096c51d3fed90b63329ef21ffeb4fc67a3",
  },
  "debug-cache-expiry-v1": {
    fixtureSha256:
      "2ac0f1f17d4c98dfb11d320a090b97536777e1d124eab7a487488e6977074275",
    rubricSha256:
      "ad8dd3005e551a38c78213eaae8466c2d6ea70f7859e45a6962ab3733a7d4034",
  },
  "docs-sdk-drift-v1": {
    fixtureSha256:
      "99e39a1eef56305ee29cebb5d50d6504a13a246d2b0c8dd82a65f078621941f5",
    rubricSha256:
      "4c423284bde79a6c7d4cc7cbccdf6d3cb67510741f1078e20e06b2c7f7343eb7",
  },
  "api-batch-jobs-v1": {
    fixtureSha256:
      "db96596c7575baa3d5060a43a4ea2e2633101ef99538ea210cd6f02c637d7126",
    rubricSha256:
      "f535d0a2679c27aa6ebb32f74e4b84a0daf06e0607704221ad49ed160abc7d15",
  },
  "migration-orders-status-v1": {
    fixtureSha256:
      "ab283a0cf86584bdc078cd130a938a5f22dc0a8d401ed317900a7b4a2f54568b",
    rubricSha256:
      "9ea7f06dfc8d102d31449e913d70edcbcb2b076fac6f784c2036e1f6bd1fd671",
  },
};

const PINNED_CONTROL_HASHES: Record<string, string> = {
  "control-no-skill-v1":
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "control-negative-v1":
    "2e2ec0f47f44aeaec78f1769f9110dc19122965dc0e269ead21ca6da57c3ddf2",
  "control-outdated-v1":
    "ff50af13da1790f0709819cdb078a69566b31842f03afed1c9c3862eaf3e58db",
  "control-overlap-a-v1":
    "a26134e9c58643259fc612a7b41f66b4fa28080b7804b4f03b8a6e445cadad24",
  "control-overlap-b-v1":
    "4a21c16ef50898b67257341ea9dcd2ca217d5f2d60caa08489699fbd4168c5ed",
};

export const BENCHMARK_FIXTURE_SUITE_SHA256 =
  "4b0cba46b46767c92c1b087c55e88d24e22f443ecf1369b5f2a9c4bbbd0129ea";

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Cannot hash a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  throw new Error(`Cannot hash value of type ${typeof value}`);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashCanonical(value: unknown): string {
  return hash(canonical(value));
}

function portablePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 256 &&
    !isAbsolute(path) &&
    !path.includes("\\") &&
    !/^[A-Za-z]:/.test(path) &&
    path
      .split("/")
      .every((segment) => segment && segment !== "." && segment !== "..")
  );
}

function compileFixture(definition: FixtureDefinition): BenchmarkFixture {
  const files = definition.files.map((file) => ({
    ...file,
    bytes: Buffer.byteLength(file.content, "utf8"),
    sha256: hash(file.content),
  }));
  const runtime: BenchmarkFixture["runtime"] = {
    setup: "materialize-static-files-v1",
    grader: "deterministic-option-selection-v1",
    node: ">=20",
    platforms: ["darwin", "linux", "win32"],
    network: "disabled",
    ...definition.expectedRuntime,
  };
  const source: BenchmarkFixture["source"] = {
    kind: "synthetic",
    provenance: PROVENANCE,
    license: { spdx: "MIT", textPath: "LICENSE" },
  };
  const task: BenchmarkFixture["task"] = {
    instructions: definition.instructions,
    options: definition.options,
    responseContract: {
      schemaVersion: 1,
      format: "strict-json",
      maximumBytes: 65_536,
    },
  };
  const rubric: BenchmarkFixture["rubric"] = {
    version: "1.0.0",
    deterministic: true,
    criteria: definition.criteria,
    limitations: LIMITATIONS,
  };
  const immutable = {
    schemaVersion: 1 as const,
    suiteVersion: BENCHMARK_FIXTURE_SUITE_VERSION,
    id: definition.id,
    version: "1.0.0" as const,
    family: definition.family,
    title: definition.title,
    source,
    runtime,
    task,
    files,
  };
  const fixtureSha256 = hashCanonical(immutable);
  const rubricSha256 = hashCanonical(rubric);
  const pinned = PINNED_FIXTURE_HASHES[definition.id];
  if (!pinned)
    throw new Error(`Benchmark fixture ${definition.id} has no pinned hashes`);
  if (pinned.fixtureSha256 !== fixtureSha256)
    throw new Error(
      `Benchmark fixture ${definition.id} content differs from its pinned hash`,
    );
  if (pinned.rubricSha256 !== rubricSha256)
    throw new Error(
      `Benchmark fixture ${definition.id} rubric differs from its pinned hash`,
    );
  return { ...immutable, rubric, fixtureSha256, rubricSha256 };
}

export const BENCHMARK_FIXTURES: readonly BenchmarkFixture[] =
  definitions.map(compileFixture);

export const BENCHMARK_CONTROLS: readonly BenchmarkControl[] =
  controlDefinitions.map((control) => {
    const instructionSha256 = hash(control.instructions);
    const pinned = PINNED_CONTROL_HASHES[control.id];
    if (!pinned)
      throw new Error(`Benchmark control ${control.id} has no pinned hash`);
    if (pinned !== instructionSha256)
      throw new Error(
        `Benchmark control ${control.id} differs from its pinned hash`,
      );
    return {
      ...control,
      instructionSha256,
      source: {
        kind: "synthetic",
        provenance: PROVENANCE,
        license: { spdx: "MIT", textPath: "LICENSE" },
      },
    };
  });

export function benchmarkFixtureSuiteManifest(): {
  schemaVersion: 1;
  suiteVersion: typeof BENCHMARK_FIXTURE_SUITE_VERSION;
  fixtures: Array<
    Pick<
      BenchmarkFixture,
      "id" | "version" | "family" | "fixtureSha256" | "rubricSha256"
    >
  >;
  controls: Array<
    Pick<
      BenchmarkControl,
      "id" | "role" | "version" | "instructionSha256" | "source"
    >
  >;
  outcomeBoundary: string;
} {
  return {
    schemaVersion: 1,
    suiteVersion: BENCHMARK_FIXTURE_SUITE_VERSION,
    fixtures: BENCHMARK_FIXTURES.map(
      ({ id, version, family, fixtureSha256, rubricSha256 }) => ({
        id,
        version,
        family,
        fixtureSha256,
        rubricSha256,
      }),
    ),
    controls: BENCHMARK_CONTROLS.map(
      ({ id, role, version, instructionSha256, source }) => ({
        id,
        role,
        version,
        instructionSha256,
        source,
      }),
    ),
    outcomeBoundary:
      "Fixture and control bytes only. No trial, score, model output, provider request, or performance claim is included.",
  };
}

export function benchmarkFixtureSuiteSha256(): string {
  return hashCanonical(benchmarkFixtureSuiteManifest());
}

export function validateBenchmarkFixtureSuite(): void {
  if (BENCHMARK_FIXTURES.length !== 7)
    throw new Error("Fixture suite must contain seven tasks");
  if (new Set(BENCHMARK_FIXTURES.map((fixture) => fixture.family)).size !== 7)
    throw new Error(
      "Fixture suite must cover all seven task families exactly once",
    );
  if (
    new Set(BENCHMARK_FIXTURES.map((fixture) => fixture.id)).size !==
    BENCHMARK_FIXTURES.length
  )
    throw new Error("Benchmark fixture ids must be unique");
  if (new Set(BENCHMARK_CONTROLS.map((control) => control.role)).size !== 5)
    throw new Error("Fixture suite must contain every required control role");
  for (const control of BENCHMARK_CONTROLS) {
    if (hash(control.instructions) !== control.instructionSha256)
      throw new Error(
        `${control.id} instruction hash does not match its content`,
      );
    if (
      control.source.kind !== "synthetic" ||
      control.source.license.spdx !== "MIT"
    )
      throw new Error(`${control.id} must retain synthetic MIT provenance`);
  }
  for (const fixture of BENCHMARK_FIXTURES) {
    const { rubric, fixtureSha256, rubricSha256, ...immutable } = fixture;
    if (hashCanonical(immutable) !== fixtureSha256)
      throw new Error(`${fixture.id} fixture hash does not match its content`);
    if (hashCanonical(rubric) !== rubricSha256)
      throw new Error(`${fixture.id} rubric hash does not match its content`);
    if (!fixture.files.length)
      throw new Error(`${fixture.id} must contain source files`);
    if (fixture.files.some((file) => !portablePath(file.path)))
      throw new Error(`${fixture.id} contains a non-portable file path`);
    if (
      new Set(fixture.files.map((file) => file.path)).size !==
      fixture.files.length
    )
      throw new Error(`${fixture.id} contains duplicate file paths`);
    if (fixture.files.some((file) => file.bytes > 65_536))
      throw new Error(`${fixture.id} contains an oversized source file`);
    if (fixture.files.reduce((total, file) => total + file.bytes, 0) > 262_144)
      throw new Error(`${fixture.id} exceeds its source-byte ceiling`);
    if (fixture.files.some((file) => hash(file.content) !== file.sha256))
      throw new Error(`${fixture.id} contains an invalid file hash`);
    if (
      new Set(fixture.task.options.map((option) => option.id)).size !==
      fixture.task.options.length
    )
      throw new Error(`${fixture.id} contains duplicate task option ids`);
    const optionIds = new Set(fixture.task.options.map((option) => option.id));
    for (const criterion of fixture.rubric.criteria) {
      if (
        !Number.isInteger(criterion.weight) ||
        criterion.weight < 1 ||
        criterion.weight > 10
      )
        throw new Error(`${fixture.id} contains an invalid criterion weight`);
      const ids =
        criterion.kind === "ordered-selection"
          ? criterion.optionIds
          : [criterion.optionId];
      if (ids.some((id) => !optionIds.has(id)))
        throw new Error(`${fixture.id} rubric refers to an unknown option`);
    }
  }
  const suiteSha256 = benchmarkFixtureSuiteSha256();
  if (BENCHMARK_FIXTURE_SUITE_SHA256 !== suiteSha256)
    throw new Error("Benchmark fixture suite differs from its pinned hash");
}

export function getBenchmarkFixture(id: string): BenchmarkFixture {
  const fixture = BENCHMARK_FIXTURES.find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`Unknown benchmark fixture: ${id}`);
  return fixture;
}

export function getBenchmarkControl(id: string): BenchmarkControl {
  const control = BENCHMARK_CONTROLS.find((candidate) => candidate.id === id);
  if (!control) throw new Error(`Unknown benchmark control: ${id}`);
  return control;
}

export function benchmarkCampaignFixtureReference(id: string): {
  id: string;
  version: string;
  fixtureSha256: string;
  rubricSha256: string;
} {
  const { version, fixtureSha256, rubricSha256 } = getBenchmarkFixture(id);
  return { id, version, fixtureSha256, rubricSha256 };
}

export function renderBenchmarkFixtureInput(fixtureId: string): string {
  const fixture = getBenchmarkFixture(fixtureId);
  const fileSections = fixture.files
    .map((file) => `--- ${file.path} ---\n${file.content}`)
    .join("\n");
  return [
    `Fixture: ${fixture.id}@${fixture.version}`,
    fixture.task.instructions,
    "Select from these options:",
    ...fixture.task.options.map(
      (option) => `${option.id}: ${option.statement}`,
    ),
    'Return only strict JSON with exactly: {"schemaVersion":1,"fixtureId":"<id>","selectedOptionIds":["..."]}',
    "Repository files:",
    fileSections,
  ].join("\n\n");
}

function responseSelections(
  fixture: BenchmarkFixture,
  output: string,
): { selections: string[]; failureCodes: string[] } {
  if (
    Buffer.byteLength(output, "utf8") >
    fixture.task.responseContract.maximumBytes
  )
    return { selections: [], failureCodes: ["response-too-large"] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return { selections: [], failureCodes: ["response-not-json"] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return { selections: [], failureCodes: ["response-invalid-shape"] };
  const value = parsed as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(",") !==
      ["fixtureId", "schemaVersion", "selectedOptionIds"].sort().join(",") ||
    value.schemaVersion !== 1 ||
    value.fixtureId !== fixture.id ||
    !Array.isArray(value.selectedOptionIds) ||
    value.selectedOptionIds.some((entry) => typeof entry !== "string")
  )
    return { selections: [], failureCodes: ["response-invalid-contract"] };
  const selections = value.selectedOptionIds as string[];
  if (new Set(selections).size !== selections.length)
    return { selections: [], failureCodes: ["response-duplicate-selection"] };
  const known = new Set(fixture.task.options.map((option) => option.id));
  if (selections.some((id) => !known.has(id)))
    return { selections: [], failureCodes: ["response-unknown-selection"] };
  return { selections, failureCodes: [] };
}

export function gradeBenchmarkFixtureOutput(
  fixtureId: string,
  output: string,
): BenchmarkGrade {
  const fixture = getBenchmarkFixture(fixtureId);
  const parsed = responseSelections(fixture, output);
  const selected = new Set(parsed.selections);
  const criteria = fixture.rubric.criteria.map(
    (criterion): BenchmarkGradeCriterion => {
      if (parsed.failureCodes.length)
        return { id: criterion.id, passed: false, weight: criterion.weight };
      if (criterion.kind !== "ordered-selection")
        return {
          id: criterion.id,
          passed:
            criterion.kind === "required-selection"
              ? selected.has(criterion.optionId)
              : !selected.has(criterion.optionId),
          weight: criterion.weight,
        };
      let previous = -1;
      const passed = criterion.optionIds.every((id) => {
        const index = parsed.selections.indexOf(id);
        const inOrder = index > previous;
        previous = index;
        return inOrder;
      });
      return { id: criterion.id, passed, weight: criterion.weight };
    },
  );
  const totalWeight = criteria.reduce(
    (total, criterion) => total + criterion.weight,
    0,
  );
  const passingWeight = criteria.reduce(
    (total, criterion) => total + (criterion.passed ? criterion.weight : 0),
    0,
  );
  const failureCodes = [
    ...parsed.failureCodes,
    ...criteria
      .filter((criterion) => !criterion.passed)
      .map((criterion) => `criterion-failed:${criterion.id}`),
  ];
  return {
    schemaVersion: 1,
    suiteVersion: BENCHMARK_FIXTURE_SUITE_VERSION,
    fixtureId,
    fixtureSha256: fixture.fixtureSha256,
    rubricSha256: fixture.rubricSha256,
    outputSha256: hash(output),
    validResponse: parsed.failureCodes.length === 0,
    passed: failureCodes.length === 0,
    score: Math.round((passingWeight / totalWeight) * 10_000) / 100,
    criteria,
    failureCodes,
    safetyBoundary:
      "Deterministic option-selection grading only. The raw response is hashed but not retained; no model judge can override these criteria.",
  };
}

async function listMaterializedFiles(
  root: string,
  prefix = "",
): Promise<string[]> {
  const directory = resolve(root, prefix);
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink())
      throw new Error(`Fixture tree contains a symbolic link: ${path}`);
    if (entry.isDirectory())
      files.push(...(await listMaterializedFiles(root, path)));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Fixture tree contains an unsupported entry: ${path}`);
  }
  return files.sort();
}

export async function materializeBenchmarkFixture(
  fixtureId: string,
  targetDirectory: string,
): Promise<{
  fixtureId: string;
  fixtureSha256: string;
  files: Array<{ path: string; sha256: string }>;
}> {
  const fixture = getBenchmarkFixture(fixtureId);
  const absoluteTarget = resolve(targetDirectory);
  try {
    const existing = await lstat(absoluteTarget);
    if (!existing.isDirectory())
      throw new Error("Fixture target exists and is not a directory");
    if ((await readdir(absoluteTarget)).length)
      throw new Error("Fixture target directory must be empty");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      await mkdir(absoluteTarget, { recursive: true, mode: 0o700 });
    else throw error;
  }
  const canonicalTarget = await realpath(absoluteTarget);
  for (const file of fixture.files) {
    const destination = resolve(canonicalTarget, file.path);
    const relation = relative(canonicalTarget, destination);
    if (!relation || relation.startsWith("..") || isAbsolute(relation))
      throw new Error(`Fixture path escapes target: ${file.path}`);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, file.content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  }
  await verifyMaterializedBenchmarkFixture(fixtureId, canonicalTarget);
  return {
    fixtureId,
    fixtureSha256: fixture.fixtureSha256,
    files: fixture.files.map(({ path, sha256 }) => ({ path, sha256 })),
  };
}

export async function verifyMaterializedBenchmarkFixture(
  fixtureId: string,
  targetDirectory: string,
): Promise<void> {
  const fixture = getBenchmarkFixture(fixtureId);
  const root = await realpath(resolve(targetDirectory));
  const actualPaths = await listMaterializedFiles(root);
  const expectedPaths = fixture.files.map((file) => file.path).sort();
  if (actualPaths.join("\0") !== expectedPaths.join("\0"))
    throw new Error(
      "Materialized fixture file inventory differs from the pinned source",
    );
  for (const file of fixture.files) {
    const path = resolve(root, file.path);
    const relation = relative(root, path);
    if (!relation || relation.startsWith("..") || isAbsolute(relation))
      throw new Error(`Fixture path escapes target: ${file.path}`);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error(
        `Materialized fixture entry is not a regular file: ${file.path}`,
      );
    const content = await readFile(path);
    if (hash(content.toString("utf8")) !== file.sha256)
      throw new Error(
        `Materialized fixture content differs from pinned hash: ${file.path}`,
      );
  }
}
