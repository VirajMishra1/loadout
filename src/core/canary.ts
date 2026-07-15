import { evaluatePackage, type PackageEvaluation } from "./evaluate.js";

export type CanaryStatus = "blocked" | "verified" | "promoted";

export interface CanaryCandidate {
  packageId: string;
  repository?: string;
  commit?: string;
  root: string;
}

export interface CanaryPolicy {
  /** Canary mode must be explicitly enabled by the caller. */
  enabled: boolean;
  /** Require every applicable static evaluation category to be ready. */
  requireStaticReady?: boolean;
  /** Require an explicit human approval before promotion. */
  requireApproval?: boolean;
}

export interface CanaryVerification {
  ok: boolean;
  findings?: string[];
}

export interface CanaryResult {
  status: CanaryStatus;
  candidate: CanaryCandidate;
  evaluation: PackageEvaluation;
  verification?: CanaryVerification;
  reason: string;
  snapshotId?: string;
}

export interface CanaryRuntime {
  evaluate?: (root: string) => Promise<PackageEvaluation>;
  verify?: (candidate: CanaryCandidate) => Promise<CanaryVerification>;
  promote?: (candidate: CanaryCandidate) => Promise<{ snapshotId: string }>;
}

/**
 * Run the policy gate for a candidate without mutating agent configuration.
 * Promotion is deliberately injected so callers can connect it to their
 * transaction layer; this function never executes candidate code itself.
 */
export async function runCanary(
  candidate: CanaryCandidate,
  policy: CanaryPolicy,
  options: { approve?: boolean } = {},
  runtime: CanaryRuntime = {},
): Promise<CanaryResult> {
  const evaluation = await (runtime.evaluate ?? evaluatePackage)(
    candidate.root,
  );
  const base = { candidate, evaluation };
  if (!policy.enabled)
    return {
      ...base,
      status: "blocked",
      reason: "Canary mode is disabled by policy.",
    };
  const applicable = evaluation.categories.filter(
    (category) => category.status !== "not-applicable",
  );
  if (applicable.length === 0)
    return {
      ...base,
      status: "blocked",
      reason: "Static evaluation found no supported component to verify.",
    };
  if (
    policy.requireStaticReady !== false &&
    applicable.some((category) => category.status !== "ready")
  )
    return {
      ...base,
      status: "blocked",
      reason:
        "Static evaluation is not ready for every applicable component category.",
    };
  const verification = runtime.verify
    ? await runtime.verify(candidate)
    : {
        ok: true,
        findings: ["No runtime verifier was supplied; static-only canary."],
      };
  if (!verification.ok)
    return {
      ...base,
      status: "blocked",
      verification,
      reason: "Canary verification failed; promotion was not attempted.",
    };
  if (policy.requireApproval !== false && !options.approve)
    return {
      ...base,
      status: "verified",
      verification,
      reason: "Canary verified; explicit approval is required for promotion.",
    };
  if (!runtime.promote)
    return {
      ...base,
      status: "verified",
      verification,
      reason: "Canary verified; no promotion callback was supplied.",
    };
  const promoted = await runtime.promote(candidate);
  return {
    ...base,
    status: "promoted",
    verification,
    reason:
      "Canary verified and promotion completed through the transaction callback.",
    snapshotId: promoted.snapshotId,
  };
}

export function formatCanaryResult(result: CanaryResult): string {
  const revision = result.candidate.commit ? `@${result.candidate.commit}` : "";
  const lines = [
    `Canary ${result.status.toUpperCase()}: ${result.candidate.packageId}${revision}`,
    result.reason,
  ];
  if (result.verification?.findings?.length)
    lines.push(`Verification: ${result.verification.findings.join("; ")}`);
  if (result.snapshotId) lines.push(`Snapshot: ${result.snapshotId}`);
  return lines.join("\n");
}
