import { join } from "node:path";
import type {
  CatalogPackage,
  ComponentType,
  PackageInspection,
} from "../../shared/types.js";
import type {
  CandidateDossier,
  DiscoveryRepository,
} from "./candidate-intelligence-types.js";

export function installabilityFor(
  components: ComponentType[],
): CandidateDossier["installability"] {
  if (
    components.some((component) =>
      ["skill", "rule", "command", "agent"].includes(component),
    )
  )
    return "portable-components";
  if (
    components.some(
      (component) => component === "mcp" || component === "plugin",
    )
  )
    return "explicit-runtime-setup";
  return "unsupported-source-shape";
}

export function componentsFor(inspection: PackageInspection): ComponentType[] {
  const result: ComponentType[] = [];
  if (inspection.counts.skills) result.push("skill");
  if (inspection.counts.rules) result.push("rule");
  if (inspection.counts.commands) result.push("command");
  if (inspection.counts.agents) result.push("agent");
  if (
    inspection.plugins.some(
      (plugin) =>
        !plugin.warnings.some((warning) =>
          warning.startsWith("invalid plugin manifest"),
        ),
    )
  )
    result.push("plugin");
  if (inspection.mcpServers.length) result.push("mcp");
  return result;
}

export function evidencePathsFor(inspection: PackageInspection): string[] {
  return [
    ...inspection.skills.map((item) => join(item.path, "SKILL.md")),
    ...inspection.resources.map((item) => item.path),
    ...inspection.plugins
      .filter(
        (item) =>
          !item.warnings.some((warning) =>
            warning.startsWith("invalid plugin manifest"),
          ),
      )
      .map((item) => item.path),
    ...inspection.mcpServers.map((item) => item.path),
  ]
    .map((path) => path.split(/[\\/]/).join("/"))
    .filter((path) => path !== "." && !path.startsWith("../"))
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .sort();
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "your",
  "into",
  "agent",
  "agents",
  "skill",
  "skills",
  "mcp",
  "server",
  "servers",
  "workflow",
  "workflows",
  "code",
  "coding",
  "developer",
  "development",
  "platform",
  "context",
  "open",
  "source",
  "using",
  "across",
  "tool",
  "tools",
  "github",
]);

function tokens(...values: Array<string | undefined>): Set<string> {
  return new Set(
    values
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
  );
}

export function overlapFor(
  discovery: DiscoveryRepository,
  inspection: PackageInspection,
  catalog: CatalogPackage[],
): CandidateDossier["overlap"] {
  const candidateTokens = tokens(
    discovery.repository,
    discovery.description,
    discovery.topics.join(" "),
    ...inspection.skills.flatMap((item) => [item.name, item.description]),
    ...inspection.resources.map((item) => item.name),
    ...inspection.plugins.flatMap((item) => [item.name, item.description]),
    ...inspection.mcpServers.map((item) => item.name),
  );
  const candidateComponents = new Set(componentsFor(inspection));
  return catalog
    .map((pkg) => {
      const packageTokens = tokens(
        pkg.id,
        pkg.displayName,
        pkg.description,
        pkg.category,
        pkg.topics?.join(" "),
      );
      const common = [...candidateTokens]
        .filter((word) => packageTokens.has(word))
        .sort();
      // Containment is more useful than union similarity here: a large skill
      // collection can overlap a focused package even when most collection
      // tokens describe unrelated capabilities.
      const smallerVocabulary = Math.min(
        candidateTokens.size,
        packageTokens.size,
      );
      const score = smallerVocabulary ? common.length / smallerVocabulary : 0;
      const componentMatch =
        pkg.components?.some((component) =>
          candidateComponents.has(component),
        ) ?? false;
      return {
        packageId: pkg.id,
        repository: pkg.repository,
        score: Math.round(score * 1000) / 1000,
        relationship:
          componentMatch && common.length >= 2 && score >= 0.2
            ? ("possible-overlap" as const)
            : ("same-tooling-area" as const),
        evidence: common.slice(0, 8).map((word) => `shared term: ${word}`),
      };
    })
    .filter((item) => item.evidence.length >= 1 && item.score >= 0.1)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.packageId.localeCompare(right.packageId),
    )
    .slice(0, 5);
}
