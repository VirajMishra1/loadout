import type {
  AdapterConformanceEvidence,
  AdapterPlatformEvidence,
  AgentId,
  DetectedAgent,
} from "../shared/types.js";
import { ADAPTER_CAPABILITIES, agentComponentDirectory } from "./adapters.js";
import { AGENT_DEFINITIONS, agentSkillsDirectory } from "./paths.js";

const CONFIGURED_PLATFORM_EVIDENCE: AdapterPlatformEvidence[] = [
  {
    platform: "linux",
    kind: "ci-configured",
    source: ".github/workflows/ci.yml#cross-platform",
  },
  {
    platform: "macos",
    kind: "ci-configured",
    source: ".github/workflows/ci.yml#cross-platform",
  },
  {
    platform: "windows",
    kind: "ci-configured",
    source: ".github/workflows/ci.yml#cross-platform",
  },
];

function declaredAgents(): DetectedAgent[] {
  return AGENT_DEFINITIONS.map((definition) => ({
    id: definition.id,
    displayName: definition.displayName,
    installed: false,
    skillsDirectory: agentSkillsDirectory(definition.id),
  }));
}

/**
 * Build conservative adapter evidence. Merely constructing this matrix does
 * not prove a filesystem run or execution inside an agent application.
 */
export function buildAdapterConformanceMatrix(
  agents: readonly DetectedAgent[] = declaredAgents(),
): AdapterConformanceEvidence[] {
  const detected = new Map(agents.map((agent) => [agent.id, agent]));
  return ADAPTER_CAPABILITIES.map((adapter) => {
    const agent = detected.get(adapter.agent);
    return {
      agent: adapter.agent,
      displayName: adapter.displayName,
      pathKnown:
        Boolean(agent) &&
        Boolean(agentComponentDirectory(agent!, "skill")) &&
        adapter.components.skill === "native",
      filesystemVerified: false,
      nativeApplicationVerified: false,
      platformEvidence: CONFIGURED_PLATFORM_EVIDENCE.map((item) => ({
        ...item,
      })),
    };
  });
}

/**
 * Promote only the filesystem evidence after the caller has completed the
 * disposable plan/apply/inspect/disable/enable/rollback lifecycle.
 */
export function markFilesystemConformanceVerified(
  matrix: readonly AdapterConformanceEvidence[],
  agent: AgentId,
): AdapterConformanceEvidence[] {
  if (!matrix.some((entry) => entry.agent === agent && entry.pathKnown))
    throw new Error(
      `Cannot verify filesystem conformance for '${agent}' without a known native skill path.`,
    );
  return matrix.map((entry) =>
    entry.agent === agent
      ? { ...entry, filesystemVerified: true }
      : { ...entry },
  );
}
