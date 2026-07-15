import { basename } from "node:path";
import type { AgentId, CatalogPackage } from "../shared/types.js";
import { explainCatalogScore } from "./ranking.js";
import type {
  CatalogSkillEvidence,
  ProvenanceInventoryEntry,
  ProvenanceInventoryReport,
  SkillProvenance,
} from "./provenance.js";

export type SkillRelationship =
  | "exact-copy"
  | "divergent-same-name"
  | "overlapping-capability"
  | "same-category-candidate";

export interface SkillCompareSubject {
  source: "installed" | "catalog";
  name: string;
  description?: string;
  fingerprint: string;
  agent?: AgentId;
  path?: string;
  provenance?: SkillProvenance;
  catalog?: CatalogSkillEvidence;
}

export interface SkillComparisonAlternative {
  relationship: SkillRelationship;
  similarity: number;
  packageId: string;
  packageDisplayName: string;
  repository: string;
  commit: string;
  tier: CatalogPackage["tier"];
  category: string;
  license?: string;
  skillName: string;
  description?: string;
  skillPath: string;
  fingerprint: string;
  evidenceScore: number;
  evidence: string[];
  evidenceDimensions: {
    adoption: string;
    momentum: string;
    maintenance: string;
    compatibility: string;
    permissions: string;
    evaluation: string;
  };
}

export interface SkillComparisonReport {
  query: string;
  subject: SkillCompareSubject;
  mirroredInstallations: Array<{ agent: AgentId; path: string }>;
  alternatives: SkillComparisonAlternative[];
  recommendation: string;
  uncertainty: string;
  catalogIndexGeneratedAt?: string;
  catalogIndexFailures: Array<{
    packageId: string;
    repository: string;
    error: string;
  }>;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "this",
  "to",
  "tool",
  "use",
  "using",
  "with",
  "workflow",
]);

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function terms(name: string, description?: string): Set<string> {
  return new Set(
    `${name} ${description ?? ""}`
      .toLowerCase()
      .replace(/[^a-z0-9+#.-]+/g, " ")
      .split(/\s+/)
      .map((value) => value.replace(/^[.-]+|[.-]+$/g, ""))
      .filter((value) => value.length > 1 && !STOP_WORDS.has(value)),
  );
}

function jaccard(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right]);
  if (!union.size) return 0;
  const intersection = [...left].filter((value) => right.has(value)).length;
  return intersection / union.size;
}

function relationship(
  subject: SkillCompareSubject,
  candidate: CatalogSkillEvidence,
): { relationship?: SkillRelationship; similarity: number } {
  if (subject.fingerprint === candidate.fingerprint)
    return { relationship: "exact-copy", similarity: 1 };
  if (normalized(subject.name) === normalized(candidate.skillName))
    return { relationship: "divergent-same-name", similarity: 1 };
  const similarity = jaccard(
    terms(subject.name, subject.description),
    terms(candidate.skillName, candidate.description),
  );
  if (similarity >= 0.3)
    return { relationship: "overlapping-capability", similarity };
  const subjectCategory = subject.catalog?.category;
  if (subjectCategory && subjectCategory === candidate.category)
    return { relationship: "same-category-candidate", similarity };
  return { similarity };
}

function installedMatches(
  query: string,
  report: ProvenanceInventoryReport,
  agent?: AgentId,
): ProvenanceInventoryEntry[] {
  const value = normalized(query);
  const scoped = agent
    ? report.skills.filter((skill) => skill.agent === agent)
    : report.skills;
  const exact = scoped.filter(
    (skill) =>
      normalized(skill.name) === value ||
      normalized(basename(skill.path)) === value ||
      skill.provenance.candidates.some(
        (candidate) => candidate.packageId === value,
      ),
  );
  if (exact.length) return exact;
  return scoped.filter(
    (skill) =>
      normalized(skill.name).includes(value) ||
      normalized(basename(skill.path)).includes(value),
  );
}

function selectInstalledSubject(
  query: string,
  matches: ProvenanceInventoryEntry[],
): {
  subject?: SkillCompareSubject;
  mirrors: Array<{ agent: AgentId; path: string }>;
} {
  if (!matches.length) return { mirrors: [] };
  const fingerprints = new Set(matches.map((skill) => skill.fingerprint));
  if (fingerprints.size > 1)
    throw new Error(
      `Several divergent installed skills match '${query}'. Re-run with --agent <id> or use an exact skill directory name: ${matches.map((skill) => `${skill.agent}:${basename(skill.path)}`).join(", ")}`,
    );
  const selected = matches[0];
  return {
    subject: {
      source: "installed",
      name: selected.name,
      ...(selected.description ? { description: selected.description } : {}),
      fingerprint: selected.fingerprint,
      agent: selected.agent,
      path: selected.path,
      provenance: selected.provenance,
      ...(selected.provenance.candidates[0]
        ? { catalog: selected.provenance.candidates[0] }
        : {}),
    },
    mirrors: matches
      .filter((skill) => skill !== selected)
      .map((skill) => ({ agent: skill.agent, path: skill.path })),
  };
}

function selectCatalogSubject(
  query: string,
  records: CatalogSkillEvidence[],
): SkillCompareSubject | undefined {
  const value = normalized(query);
  const matches = records.filter(
    (record) =>
      record.packageId === value || normalized(record.skillName) === value,
  );
  if (!matches.length) return undefined;
  if (matches.length > 1 && matches.every((item) => item.packageId === value))
    throw new Error(
      `Catalog package '${query}' contains ${matches.length} skills. Compare one by skill name: ${matches
        .slice(0, 20)
        .map((item) => item.skillName)
        .join(", ")}`,
    );
  if (matches.length > 1)
    throw new Error(
      `Several reviewed catalog skills are named '${query}'. Use a package id or inspect JSON output to disambiguate: ${[...new Set(matches.map((item) => item.packageId))].join(", ")}`,
    );
  const selected = matches[0];
  return {
    source: "catalog",
    name: selected.skillName,
    ...(selected.description ? { description: selected.description } : {}),
    fingerprint: selected.fingerprint,
    catalog: selected,
  };
}

function evidenceFor(
  relationshipValue: SkillRelationship,
  similarity: number,
  candidate: CatalogSkillEvidence,
  pkg: CatalogPackage | undefined,
): string[] {
  const relationshipEvidence: Record<SkillRelationship, string> = {
    "exact-copy": "The SKILL.md instruction fingerprint is identical.",
    "divergent-same-name":
      "The normalized name matches but the instructions differ; this is not proof of equivalence or improvement.",
    "overlapping-capability": `Name/description token overlap is ${(similarity * 100).toFixed(0)}%; task evaluation is still required.`,
    "same-category-candidate":
      "The catalog category matches, but textual overlap is weak; treat this as exploration rather than a replacement.",
  };
  return [
    relationshipEvidence[relationshipValue],
    `${candidate.tier} catalog tier; reviewed commit ${candidate.commit.slice(0, 12)}; license ${candidate.license ?? "unverified"}.`,
    pkg
      ? `Evidence score ${explainCatalogScore(pkg).score}/100 orders catalog evidence only; it is not a universal quality score.`
      : "No current catalog metadata was available for an evidence score.",
  ];
}

function evidenceDimensionsFor(
  pkg: CatalogPackage | undefined,
): SkillComparisonAlternative["evidenceDimensions"] {
  const explanation = pkg ? explainCatalogScore(pkg) : undefined;
  const contribution = (
    factor: "adoption" | "momentum" | "maintenance" | "compatibility",
  ): string =>
    explanation?.contributions.find((item) => item.factor === factor)
      ?.evidence ?? "No current catalog evidence is available.";
  return {
    adoption: contribution("adoption"),
    momentum: contribution("momentum"),
    maintenance: contribution("maintenance"),
    compatibility: contribution("compatibility"),
    permissions:
      "No declarative permission manifest exists for this skill; preview and safety inspection are required before install.",
    evaluation:
      "No skill-specific model-output benchmark is stored yet; relationship evidence is not an outcome evaluation.",
  };
}

function recommendationFor(
  subject: SkillCompareSubject,
  alternatives: SkillComparisonAlternative[],
): string {
  if (subject.source === "catalog")
    return alternatives.length
      ? "This is a reviewed catalog skill, not an installed replacement decision. Compare the related candidates on your task before choosing what to install."
      : "This is a reviewed catalog skill with no related candidate strong enough to show. Inspect its evidence and preview its files before deciding whether to install it.";
  if (
    subject.provenance?.kind === "catalog-exact" ||
    subject.provenance?.kind === "loadout-managed"
  )
    return "Keep the installed skill for now: its source is strongly attributable. Review alternatives only if a task-specific evaluation or maintenance signal demonstrates an advantage.";
  const sameName = alternatives.find(
    (item) => item.relationship === "divergent-same-name",
  );
  if (sameName)
    return `Review ${sameName.packageDisplayName}/${sameName.skillName} head-to-head before replacing anything. It has the same name but different instructions, so Loadout cannot honestly call it better yet.`;
  const overlapping = alternatives.find(
    (item) => item.relationship === "overlapping-capability",
  );
  if (overlapping)
    return `Explore ${overlapping.packageDisplayName}/${overlapping.skillName} as a possible alternative. Keep the current skill until category-specific evaluation or your explicit outcome supports a change.`;
  return "No reviewed replacement has enough relationship evidence. Keep the current skill, record its source if known, and leave it marked unknown rather than guessing.";
}

export function compareSkill(
  query: string,
  inventory: ProvenanceInventoryReport,
  records: CatalogSkillEvidence[],
  catalog: CatalogPackage[],
  options: {
    agent?: AgentId;
    limit?: number;
    indexGeneratedAt?: string;
    failures?: SkillComparisonReport["catalogIndexFailures"];
  } = {},
): SkillComparisonReport {
  if (!query.trim()) throw new Error("Comparison query cannot be empty");
  const installed = selectInstalledSubject(
    query,
    installedMatches(query, inventory, options.agent),
  );
  const subject = installed.subject ?? selectCatalogSubject(query, records);
  if (!subject)
    throw new Error(
      `No installed or reviewed catalog skill matches '${query}'. Run loadout scan --refresh-provenance or loadout search first.`,
    );
  const packages = new Map(catalog.map((pkg) => [pkg.id, pkg]));
  const priority: Record<SkillRelationship, number> = {
    "exact-copy": 4,
    "divergent-same-name": 3,
    "overlapping-capability": 2,
    "same-category-candidate": 1,
  };
  const alternatives = records
    .filter(
      (candidate) =>
        !(
          subject.catalog &&
          candidate.packageId === subject.catalog.packageId &&
          candidate.skillPath === subject.catalog.skillPath
        ),
    )
    .map((candidate): SkillComparisonAlternative | undefined => {
      const relation = relationship(subject, candidate);
      if (!relation.relationship) return undefined;
      const pkg = packages.get(candidate.packageId);
      const explanation = pkg ? explainCatalogScore(pkg) : undefined;
      return {
        relationship: relation.relationship,
        similarity: Number(relation.similarity.toFixed(4)),
        ...candidate,
        evidenceScore: explanation?.score ?? 0,
        evidence: evidenceFor(
          relation.relationship,
          relation.similarity,
          candidate,
          pkg,
        ),
        evidenceDimensions: evidenceDimensionsFor(pkg),
      };
    })
    .filter(
      (candidate): candidate is SkillComparisonAlternative =>
        candidate !== undefined,
    )
    .sort(
      (left, right) =>
        priority[right.relationship] - priority[left.relationship] ||
        right.similarity - left.similarity ||
        right.evidenceScore - left.evidenceScore ||
        left.packageId.localeCompare(right.packageId),
    )
    .slice(0, Math.max(1, Math.min(options.limit ?? 10, 50)));
  return {
    query,
    subject,
    mirroredInstallations: installed.mirrors,
    alternatives,
    recommendation: recommendationFor(subject, alternatives),
    uncertainty:
      "This comparison uses provenance, reviewed static evidence, maintenance/adoption metadata, and deterministic text relationships. It does not prove that one skill produces better model output on every task.",
    ...(options.indexGeneratedAt
      ? { catalogIndexGeneratedAt: options.indexGeneratedAt }
      : {}),
    catalogIndexFailures: options.failures ?? [],
  };
}

export function formatSkillComparison(report: SkillComparisonReport): string {
  const subject = report.subject;
  const lines = [
    `Compare: ${subject.name}`,
    `Subject: ${subject.source}${subject.agent ? ` on ${subject.agent}` : ""}${subject.path ? ` — ${subject.path}` : ""}`,
  ];
  if (subject.catalog)
    lines.push(
      `Reviewed source: ${subject.catalog.packageDisplayName} · ${subject.catalog.repository}@${subject.catalog.commit.slice(0, 12)} · ${subject.catalog.tier} · license ${subject.catalog.license ?? "unverified"}`,
    );
  if (subject.provenance)
    lines.push(
      `Provenance: ${subject.provenance.kind} (${subject.provenance.confidence})`,
      ...subject.provenance.evidence.map((item) => `  ${item}`),
    );
  if (report.mirroredInstallations.length)
    lines.push(
      `Mirrors: ${report.mirroredInstallations.map((item) => `${item.agent}:${item.path}`).join(", ")}`,
    );
  lines.push("", "Reviewed alternatives:");
  if (!report.alternatives.length)
    lines.push("  No related reviewed candidate found.");
  for (const alternative of report.alternatives) {
    lines.push(
      `  ${alternative.packageDisplayName}/${alternative.skillName} [${alternative.relationship}]`,
      `    ${alternative.repository}@${alternative.commit.slice(0, 12)} · ${alternative.tier} · evidence ${alternative.evidenceScore}/100`,
    );
    for (const evidence of alternative.evidence)
      lines.push(`    - ${evidence}`);
    lines.push(
      `    Adoption: ${alternative.evidenceDimensions.adoption}`,
      `    Momentum: ${alternative.evidenceDimensions.momentum}`,
      `    Maintenance: ${alternative.evidenceDimensions.maintenance}`,
      `    Compatibility: ${alternative.evidenceDimensions.compatibility}`,
      `    Permissions: ${alternative.evidenceDimensions.permissions}`,
      `    Evaluation: ${alternative.evidenceDimensions.evaluation}`,
    );
  }
  lines.push(
    "",
    `Recommendation: ${report.recommendation}`,
    `Uncertainty: ${report.uncertainty}`,
  );
  if (report.catalogIndexFailures.length)
    lines.push(
      `Index warning: ${report.catalogIndexFailures.length} reviewed repository/repositories could not be indexed.`,
    );
  return lines.join("\n");
}
