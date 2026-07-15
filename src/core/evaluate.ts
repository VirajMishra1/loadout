import { inspectPackage } from "./package.js";
import { analyzeUpdateSafety, type SafetyFinding } from "./safety.js";

export type EvaluationStatus =
  "ready" | "needs-review" | "blocked" | "not-applicable";

export interface PackageEvaluation {
  evaluatorVersion: 1;
  root: string;
  categories: Array<{
    category: "skills" | "mcp";
    status: EvaluationStatus;
    findings: string[];
  }>;
  uncertainty: string;
}

function statusFor(findings: SafetyFinding[]): EvaluationStatus {
  if (
    findings.some(
      (finding) =>
        finding.category === "secret" || finding.category === "instruction",
    )
  )
    return "blocked";
  return findings.length ? "needs-review" : "ready";
}

/**
 * Deterministically assesses static package evidence. It never starts an MCP
 * server, executes a script, calls a model, or claims a performance benchmark.
 */
export async function evaluatePackage(
  root: string,
): Promise<PackageEvaluation> {
  const inspection = await inspectPackage(root);
  const safety = await analyzeUpdateSafety(undefined, root);
  const sharedSafety = safety.findings.map((finding) => finding.message);
  const names = inspection.skills.map((skill) => skill.name.toLowerCase());
  const duplicateNames = names.filter(
    (name, index) => names.indexOf(name) !== index,
  );
  const skillFindings = [
    ...(duplicateNames.length
      ? [`Duplicate skill names: ${[...new Set(duplicateNames)].join(", ")}`]
      : []),
    ...inspection.warnings,
    ...sharedSafety,
  ];
  const mcpWarnings = inspection.mcpServers.flatMap((server) =>
    server.warnings.map((warning) => `${server.name}: ${warning}`),
  );
  const invalidMcp = inspection.mcpServers.filter(
    (server) => server.transport === "unknown",
  );
  const mcpFindings = [
    ...mcpWarnings,
    ...invalidMcp.map((server) => `${server.name}: no usable transport`),
    ...sharedSafety,
  ];
  return {
    evaluatorVersion: 1,
    root: inspection.root,
    categories: [
      {
        category: "skills",
        status:
          inspection.skills.length === 0
            ? "not-applicable"
            : statusFor(safety.findings),
        findings: inspection.skills.length ? skillFindings : [],
      },
      {
        category: "mcp",
        status:
          inspection.counts.manifests === 0
            ? "not-applicable"
            : invalidMcp.length ||
                safety.findings.some((item) => item.category === "secret")
              ? "blocked"
              : mcpFindings.length
                ? "needs-review"
                : "ready",
        findings: inspection.counts.manifests ? mcpFindings : [],
      },
    ],
    uncertainty:
      "Static evidence only. This does not measure model quality, MCP uptime, permissions at runtime, or task performance.",
  };
}

export function formatPackageEvaluation(evaluation: PackageEvaluation): string {
  const lines = [`Evaluation: ${evaluation.root}`];
  for (const category of evaluation.categories) {
    lines.push(`${category.category}: ${category.status}`);
    for (const finding of category.findings) lines.push(`  - ${finding}`);
  }
  lines.push(`Uncertainty: ${evaluation.uncertainty}`);
  return lines.join("\n");
}
