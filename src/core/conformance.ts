import type {
  AdapterConformanceEvidence,
  AdapterPlatformEvidence,
  AgentId,
  DetectedAgent,
} from "../shared/types.js";
import { ADAPTER_CAPABILITIES, agentComponentDirectory } from "./adapters.js";
import { AGENT_DEFINITIONS, agentSkillsDirectory } from "./paths.js";

const PLATFORM_BY_RUNNER = {
  "ubuntu-latest": "linux",
  "macos-latest": "macos",
  "windows-latest": "windows",
} as const;

/** Derive bounded platform evidence from the manually triggered CI job. */
export function platformEvidenceFromCiWorkflow(
  workflow: string,
): AdapterPlatformEvidence[] {
  const jobStart = workflow.search(/^ {2}cross-platform:\s*$/m);
  const dispatchConfigured = /^ {2}workflow_dispatch:\s*$/m.test(workflow);
  if (jobStart < 0 || !dispatchConfigured)
    throw new Error(
      "The cross-platform CI job and workflow_dispatch trigger are required before platform evidence can be claimed.",
    );
  const afterStart = workflow.slice(jobStart + 1);
  const nextJob = afterStart.search(/^ {2}[a-zA-Z0-9_-]+:\s*$/m);
  const job = nextJob < 0 ? afterStart : afterStart.slice(0, nextJob);
  if (!/if:\s*github\.event_name\s*==\s*['"]workflow_dispatch['"]/.test(job))
    throw new Error(
      "The cross-platform CI job must remain explicitly bounded to workflow_dispatch.",
    );
  const match = job.match(/^\s+os:\s*\[([^\]]+)\]\s*$/m);
  if (!match)
    throw new Error("The cross-platform CI job has no explicit OS matrix.");
  const runners = match[1].split(",").map((value) => value.trim());
  return runners.map((runner) => {
    const platform =
      PLATFORM_BY_RUNNER[runner as keyof typeof PLATFORM_BY_RUNNER];
    if (!platform)
      throw new Error(
        `The cross-platform CI job uses an unrecognized runner '${runner}'.`,
      );
    return {
      platform,
      kind: "ci-configured" as const,
      source: ".github/workflows/ci.yml (cross-platform job)",
    };
  });
}

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
  platformEvidence: readonly AdapterPlatformEvidence[] = [],
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
      platformEvidence: platformEvidence.map((item) => ({
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
