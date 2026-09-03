import type { PackageInspection } from "../../shared/types.js";
import type { CandidateDossier } from "./candidate-intelligence-types.js";
import type { PackageEvaluation } from "./evaluate.js";
import {
  componentsFor,
  evidencePathsFor,
  installabilityFor,
} from "./candidate-intelligence-evidence.js";

export function isTextArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

export function finiteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function validDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function validPersistedEvaluation(
  value: unknown,
): value is Omit<PackageEvaluation, "root"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const evaluation = value as Omit<PackageEvaluation, "root">;
  const categories = evaluation.categories;
  return (
    evaluation.evaluatorVersion === 1 &&
    typeof evaluation.uncertainty === "string" &&
    Array.isArray(categories) &&
    categories.length === 2 &&
    new Set(categories.map((item) => item.category)).size === 2 &&
    categories.every(
      (item) =>
        (item.category === "skills" || item.category === "mcp") &&
        ["ready", "needs-review", "blocked", "not-applicable"].includes(
          item.status,
        ) &&
        isTextArray(item.findings),
    )
  );
}

function safeEvidencePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Boolean(value) &&
    !value.startsWith("/") &&
    !value.split(/[\\/]/).includes("..")
  );
}

export function validPersistedInspection(
  value: unknown,
): value is Omit<PackageInspection, "root"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const inspection = value as Omit<PackageInspection, "root">;
  const validCount = (count: unknown): count is number =>
    typeof count === "number" && Number.isSafeInteger(count) && count >= 0;
  const validNamedPath = (item: unknown, type: string): boolean =>
    Boolean(
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      (item as { type?: unknown }).type === type &&
      typeof (item as { name?: unknown }).name === "string" &&
      safeEvidencePath((item as { path?: unknown }).path),
    );
  if (
    !Array.isArray(inspection.skills) ||
    !inspection.skills.every(
      (item) =>
        validNamedPath(item, "skill") &&
        (item.description === undefined ||
          typeof item.description === "string"),
    ) ||
    !Array.isArray(inspection.resources) ||
    !inspection.resources.every(
      (item) =>
        ["rule", "command", "agent"].includes(item.type) &&
        validNamedPath(item, item.type),
    ) ||
    !Array.isArray(inspection.plugins) ||
    !inspection.plugins.every(
      (item) =>
        validNamedPath(item, "plugin") &&
        (item.description === undefined ||
          typeof item.description === "string") &&
        (item.version === undefined || typeof item.version === "string") &&
        (item.author === undefined || typeof item.author === "string") &&
        Array.isArray(item.components) &&
        item.components.every((component) =>
          [
            "skill",
            "rule",
            "command",
            "agent",
            "mcp",
            "plugin",
            "root",
          ].includes(component),
        ) &&
        isTextArray(item.hookEvents) &&
        isTextArray(item.mcpServers) &&
        isTextArray(item.warnings),
    ) ||
    !Array.isArray(inspection.mcpServers) ||
    !inspection.mcpServers.every(
      (item) =>
        validNamedPath(item, "mcp") &&
        ["command", "url", "unknown"].includes(item.transport) &&
        (item.command === undefined || typeof item.command === "string") &&
        (item.url === undefined || typeof item.url === "string") &&
        validCount(item.argumentCount) &&
        validCount(item.environmentVariableCount) &&
        isTextArray(item.warnings),
    ) ||
    !inspection.counts ||
    !validCount(inspection.counts.skills) ||
    !validCount(inspection.counts.rules) ||
    !validCount(inspection.counts.commands) ||
    !validCount(inspection.counts.agents) ||
    !validCount(inspection.counts.plugins) ||
    !validCount(inspection.counts.mcpServers) ||
    !validCount(inspection.counts.manifests) ||
    !isTextArray(inspection.warnings)
  )
    return false;
  return (
    inspection.counts.skills === inspection.skills.length &&
    inspection.counts.rules ===
      inspection.resources.filter((item) => item.type === "rule").length &&
    inspection.counts.commands ===
      inspection.resources.filter((item) => item.type === "command").length &&
    inspection.counts.agents ===
      inspection.resources.filter((item) => item.type === "agent").length &&
    inspection.counts.plugins === inspection.plugins.length &&
    inspection.counts.mcpServers === inspection.mcpServers.length
  );
}

export function assertDossierEvidence(dossier: CandidateDossier): void {
  if (!validPersistedInspection(dossier.inspection))
    throw new Error("Candidate dossier inspection evidence is invalid");
  const inspection: PackageInspection = { root: ".", ...dossier.inspection };
  const components = componentsFor(inspection);
  const evidencePaths = evidencePathsFor(inspection);
  if (JSON.stringify(dossier.components) !== JSON.stringify(components))
    throw new Error(
      "Candidate dossier components do not match inspection evidence",
    );
  if (dossier.installability !== installabilityFor(components))
    throw new Error(
      "Candidate dossier installability does not match inspection evidence",
    );
  if (JSON.stringify(dossier.evidencePaths) !== JSON.stringify(evidencePaths))
    throw new Error(
      "Candidate dossier evidencePaths do not match inspection evidence",
    );
}
