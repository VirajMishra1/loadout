import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cli = resolve("dist/src/cli.js");
const project = await mkdtemp(join(tmpdir(), "loadout-coordination-flow-"));

async function loadout(...args) {
  return execFileAsync(process.execPath, [cli, ...args], {
    cwd: project,
    env: { ...process.env, NO_COLOR: "1" },
    maxBuffer: 4 * 1024 * 1024,
  });
}

await mkdir(join(project, "src/api"), { recursive: true });
await mkdir(join(project, "src/web"), { recursive: true });
await writeFile(
  join(project, "src/api/types.ts"),
  "export interface Checkout { id: string; }\n",
);
await writeFile(
  join(project, "src/web/page.ts"),
  'import { Checkout } from "../api/types.js";\n',
);

const preview = JSON.parse(
  (await loadout("coord", "start", "--agents", "claude-code,codex", "--json"))
    .stdout,
);
assert.equal(preview.ownershipClaimed, false);
assert.deepEqual(preview.assignments["claude-code"], ["src/api"]);
assert.deepEqual(preview.assignments.codex, ["src/web"]);

const applied = JSON.parse(
  (
    await loadout(
      "coord",
      "start",
      "--agents",
      "claude-code,codex",
      "--yes",
      "--json",
    )
  ).stdout,
);
assert.equal(applied.ownershipClaimed, true);

const detected = JSON.parse(
  (await loadout("coord", "detect", "--json")).stdout,
);
assert.equal(detected.candidates.length, 1);
assert.equal(detected.candidates[0].publishable, true);
assert.equal(detected.candidates[0].coverageState, "uncovered");

await loadout("coord", "detect", "--publish", "--yes", "--json");
const current = JSON.parse((await loadout("coord", "detect", "--json")).stdout);
assert.equal(current.candidates[0].coverageState, "current");

await loadout(
  "template",
  "create",
  "checkout-review",
  "--description",
  "Review checkout types",
  "--task",
  "Review {{files}}",
  "--bundle",
  "src/api/types.ts",
);
const sent = JSON.parse(
  (
    await loadout(
      "handoff",
      "codex",
      "src/api/types.ts",
      "--template",
      "checkout-review",
      "--json",
    )
  ).stdout,
).message;
assert.equal(sent.description, "Review src/api/types.ts");
assert.equal(sent.bundle.fileCount, 1);

const verified = JSON.parse(
  (
    await loadout(
      "handoff",
      "codex",
      "verify node",
      "--verify",
      "node exits successfully",
      "--verify-command",
      process.execPath,
      "--verify-args",
      '["-e","console.log(\\"verified\\")"]',
      "--json",
    )
  ).stdout,
).message;
const completion = JSON.parse(
  (
    await loadout(
      "handoff",
      "--done",
      verified.id,
      "--run-verification",
      "--json",
    )
  ).stdout,
);
assert.equal(completion.completed, true);
assert.match(completion.message.evidence.stdout, /verified/);

// ── Phase 5: Compaction preserves state ──────────────────────────────
// (Discussion start/vote/close require paid provider turns — tested in
// discussion-pipeline.test.ts, not here.)
// Add enough events to trigger compaction
for (let i = 0; i < 15; i++) {
  await loadout(
    "coord",
    "emit",
    "--from",
    "loadout",
    "--type",
    "status",
    "--description",
    `padding event ${i}`,
  );
}

const compactionResult = JSON.parse(
  (await loadout("coord", "compact", "--max-events", "5", "--json")).stdout,
);
assert.equal(compactionResult.compacted, true);

// Ownership must survive compaction
const postCompactDetect = JSON.parse(
  (await loadout("coord", "detect", "--json")).stdout,
);
assert.ok(
  postCompactDetect.candidates.length >= 1,
  "contract candidates should survive compaction",
);

console.log(
  "Coordination product flow passed: preview/apply ownership -> exact contract -> template bundle -> verified handoff -> compaction with state preservation.",
);
