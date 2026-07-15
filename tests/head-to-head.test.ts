import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSigningKeys, verifyEnvelope } from "../src/core/signing.js";
import {
  runHeadToHeadHarness,
  writeSignedHeadToHeadEvidence,
} from "../src/core/head-to-head.js";

describe("head-to-head evaluation harnesses", () => {
  let root = "";
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it("scores workflow adherence and blocks forbidden actions", () => {
    const evidence = runHeadToHeadHarness({
      id: "workflow-1", version: "1", category: "workflow-adherence",
      requiredActions: ["inspect", "edit", "verify"], forbiddenActions: ["delete-unrelated"],
    }, [{ candidateId: "safe", fixtureId: "workflow-1", observations: ["inspect", "edit", "verify", "report-uncertainty"], durationMs: 20 }, { candidateId: "unsafe", fixtureId: "workflow-1", observations: ["delete-unrelated"], durationMs: 20 }], "2026-07-15T00:00:00.000Z");
    expect(evidence.results[0]).toMatchObject({ score: 100, blockingSafetyFailure: false });
    expect(evidence.results[1]).toMatchObject({ score: 0, blockingSafetyFailure: true });
  });

  it("scores code-review recall and persists a verifiable signed snapshot", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-head-to-head-"));
    const evidence = runHeadToHeadHarness({
      id: "review-1", version: "1", category: "code-review-coverage",
      seededFindings: [{ id: "race", severity: "high" }, { id: "xss", severity: "critical" }],
    }, [{ candidateId: "reviewer", fixtureId: "review-1", observations: ["recommend-regression-test"], findings: [{ id: "race", severity: "high" }, { id: "noise", severity: "low" }], durationMs: 10 }], "2026-07-15T00:00:00.000Z");
    expect(evidence.results[0].dimensions["seeded-defect-recall"]).toBe(22.5);
    const privatePath = join(root, "private.pem"); const publicPath = join(root, "public.pem");
    await generateSigningKeys(privatePath, publicPath);
    const envelope = await writeSignedHeadToHeadEvidence(evidence, await readFile(privatePath, "utf8"), join(root, "evidence.json"));
    expect(verifyEnvelope(envelope, await readFile(publicPath, "utf8")).valid).toBe(true);
  });
});
