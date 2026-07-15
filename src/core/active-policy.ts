import type {
  AgentId,
  ManagedActivationRecord,
  ProjectSignals,
} from "../shared/types.js";
import {
  applyActivationChange,
  formatActivationPlan,
  planActivationChange,
  type ActivationPlan,
} from "./active-set.js";
import { scanProject } from "./recommend.js";
import { readInstallState } from "./state.js";
import {
  outcomeAdjustment,
  projectTaskFamilies,
  readLocalOutcomes,
  type LocalOutcomeStore,
  type OutcomeTaskFamily,
} from "./outcomes.js";

export interface ActiveSetCandidate {
  selector: string;
  packageId: string;
  unitId: string;
  score: number;
  reasons: string[];
}

export interface ProjectActiveSetPlan {
  project: ProjectSignals;
  limit: number;
  agents?: AgentId[];
  activeBefore: number;
  capacity: number;
  selected: ActiveSetCandidate[];
  alternatives: Array<{
    unitId: string;
    selected: string;
    deferred: string[];
  }>;
  activation?: ActivationPlan;
  warnings: string[];
}

const FOUNDATION = new Set([
  "brainstorming",
  "systematic-debugging",
  "test-driven-development",
  "verification-before-completion",
  "writing-plans",
  "requesting-code-review",
  "receiving-code-review",
  "find-docs",
  "context7-docs",
  "security-best-practices",
  "security-threat-model",
  "code-review-excellence",
  "api-design-principles",
  "architecture-patterns",
  "accessibility-compliance",
  "deployment-pipeline-design",
  "documentation-writer",
  "openai-docs",
  "web-design-guidelines",
]);

const SPECIALIZED_WITHOUT_SIGNAL =
  /(?:appstore|backtesting|bats-|oracle|salesforce|power-bi|dataverse|qdrant|azure-|aws-|mcp-server-generator|sandbox-npm|migration)/;

const SOURCE_PRIORITY: Record<string, number> = {
  superpowers: 80,
  context7: 75,
  "openai-skills": 70,
  "anthropic-skills": 70,
  "vercel-agent-skills": 60,
  "ui-ux-pro-max": 55,
  "wshobson-agents": 45,
  "openai-codex-skills": 40,
  "awesome-copilot": 20,
};

const GENERAL: Array<[RegExp, string]> = [
  [/(?:security|threat|secrets|owasp)/, "security"],
  [/(?:review|refactor)/, "code review"],
  [/(?:debug|diagnos)/, "debugging"],
  [/(?:test|playwright|coverage)/, "testing"],
  [/(?:architect|api-design|openapi)/, "architecture"],
  [/(?:docs|documentation|readme)/, "documentation"],
  [/(?:github-actions|deployment-pipeline)/, "delivery"],
];

const SIGNAL_RULES: Array<{
  signal: (project: ProjectSignals) => boolean;
  pattern: RegExp;
  label: string;
}> = [
  {
    signal: (project) => project.languages.includes("javascript/typescript"),
    pattern: /(?:javascript|typescript|nodejs|npm|webapp)/,
    label: "JavaScript/TypeScript project",
  },
  {
    signal: (project) => project.languages.includes("python"),
    pattern: /(?:python|pytest|fastapi|jupyter)/,
    label: "Python project",
  },
  {
    signal: (project) => project.languages.includes("go"),
    pattern: /(?:^|-)go(?:-|$)|golang/,
    label: "Go project",
  },
  {
    signal: (project) => project.languages.includes("rust"),
    pattern: /rust|cargo/,
    label: "Rust project",
  },
  {
    signal: (project) => project.languages.includes("java"),
    pattern: /java|spring/,
    label: "Java project",
  },
  {
    signal: (project) => project.languages.includes(".net"),
    pattern: /dotnet|csharp|aspnet/,
    label: ".NET project",
  },
  {
    signal: (project) =>
      project.frameworks.some((item) =>
        ["react", "next.js", "vue", "svelte"].includes(item),
      ),
    pattern:
      /react|nextjs|frontend|web-design|ui-|design-system|responsive|accessibility|figma/,
    label: "frontend framework",
  },
  {
    signal: (project) => project.frameworks.includes("playwright"),
    pattern: /playwright|e2e|webapp-testing/,
    label: "Playwright project",
  },
];

function selector(record: ManagedActivationRecord): string | undefined {
  if (!record.unitId) return undefined;
  return `${record.packageId}/${record.unitId}`;
}

function scoreCandidate(
  record: ManagedActivationRecord,
  project: ProjectSignals,
  pinned: Set<string>,
  outcomes: LocalOutcomeStore,
  taskFamilies: OutcomeTaskFamily[],
): ActiveSetCandidate | undefined {
  const id = selector(record);
  if (!id || !record.unitId) return undefined;
  const name = record.unitId.toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  if (pinned.has(id) || pinned.has(record.unitId)) {
    score += 1000;
    reasons.push("explicitly pinned");
  }
  const explicitlyPinned = score >= 1000;
  if (!explicitlyPinned && SPECIALIZED_WITHOUT_SIGNAL.test(name))
    return undefined;
  if (FOUNDATION.has(name)) {
    score += 100;
    reasons.push("cross-project foundation");
  }
  for (const [pattern, label] of GENERAL)
    if (pattern.test(name)) {
      score += 18;
      reasons.push(label);
    }
  for (const rule of SIGNAL_RULES)
    if (rule.signal(project) && rule.pattern.test(name)) {
      score += 55;
      reasons.push(rule.label);
    }
  const local = outcomeAdjustment(outcomes, id, record.agent, taskFamilies);
  if (!explicitlyPinned && local.score <= -35) return undefined;
  score += local.score;
  reasons.push(...local.evidence);
  // Capacity is a ceiling, never a quota. A generic word such as "test" or
  // "review" is supporting evidence, but cannot activate a niche skill alone.
  if (score < 50) return undefined;
  return {
    selector: id,
    packageId: record.packageId,
    unitId: record.unitId,
    score,
    reasons: [...new Set(reasons)],
  };
}

/** Deterministic, local-only active-set selection over the reviewed library. */
export async function planProjectActivation(
  projectPath: string,
  options: {
    agents?: AgentId[];
    limit?: number;
    pins?: string[];
  } = {},
): Promise<ProjectActiveSetPlan> {
  const limit = options.limit ?? 40;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new Error("--limit must be an integer from 1 to 200");
  const project = await scanProject(projectPath);
  const state = await readInstallState();
  const outcomes = await readLocalOutcomes();
  const taskFamilies = projectTaskFamilies(project);
  const relevant = (state.activations ?? []).filter(
    (record) =>
      record.installationState === "installed" &&
      (!options.agents || options.agents.includes(record.agent)),
  );
  const byAgent = new Map<AgentId, number>();
  for (const record of relevant)
    if (record.activationState === "active")
      byAgent.set(record.agent, (byAgent.get(record.agent) ?? 0) + 1);
  const activeBefore = Math.max(0, ...byAgent.values());
  const capacity = Math.max(0, limit - activeBefore);
  const pins = new Set(options.pins ?? []);
  const scored = relevant
    .filter(
      (record) =>
        record.activationState === "disabled" &&
        record.cacheState === "downloaded" &&
        record.reviewState === "reviewed",
    )
    .map((record) =>
      scoreCandidate(record, project, pins, outcomes, taskFamilies),
    )
    .filter((item): item is ActiveSetCandidate => Boolean(item))
    .sort(
      (left, right) =>
        right.score - left.score ||
        (SOURCE_PRIORITY[right.packageId] ?? 0) -
          (SOURCE_PRIORITY[left.packageId] ?? 0) ||
        left.unitId.localeCompare(right.unitId) ||
        left.packageId.localeCompare(right.packageId),
    );
  // One capability name wins by evidence order; overlapping collections remain
  // in the library and can still be explicitly pinned by full selector.
  const unique: ActiveSetCandidate[] = [];
  const claimedUnits = new Set<string>();
  for (const item of scored) {
    const fullPin = pins.has(item.selector);
    if (!fullPin && claimedUnits.has(item.unitId)) continue;
    claimedUnits.add(item.unitId);
    unique.push(item);
  }
  const selected = unique.slice(0, capacity);
  const alternatives = selected.flatMap((chosen) => {
    const deferred = scored
      .filter(
        (candidate) =>
          candidate.unitId === chosen.unitId &&
          candidate.selector !== chosen.selector,
      )
      .map((candidate) => candidate.selector);
    return deferred.length
      ? [{ unitId: chosen.unitId, selected: chosen.selector, deferred }]
      : [];
  });
  const warnings: string[] = [];
  const known = new Set(
    relevant.flatMap((record) => {
      const id = selector(record);
      return id ? [id, record.unitId!] : [];
    }),
  );
  const unknownPins = [...pins].filter((pin) => !known.has(pin));
  if (unknownPins.length)
    warnings.push(
      `Pinned skill(s) are not in the managed library: ${unknownPins.join(", ")}`,
    );
  if (!capacity)
    warnings.push(
      `Active-set limit ${limit} is already reached; disable skills or raise --limit.`,
    );
  const activation = selected.length
    ? await planActivationChange(
        "enable",
        selected.map((item) => item.selector),
        { ...(options.agents ? { agents: options.agents } : {}) },
      )
    : undefined;
  return {
    project,
    limit,
    ...(options.agents ? { agents: options.agents } : {}),
    activeBefore,
    capacity,
    selected,
    alternatives,
    ...(activation ? { activation } : {}),
    warnings,
  };
}

export async function applyProjectActivation(
  plan: ProjectActiveSetPlan,
): Promise<string> {
  if (!plan.activation || !plan.selected.length)
    throw new Error("No reviewed library skills were selected for activation");
  return applyActivationChange(plan.activation);
}

export function formatProjectActivation(plan: ProjectActiveSetPlan): string {
  const detected = [...plan.project.languages, ...plan.project.frameworks];
  return [
    `Project: ${plan.project.root}`,
    `Detected: ${detected.join(", ") || "no known project signals"}`,
    `Active-set budget: ${plan.activeBefore}/${plan.limit} active; ${plan.capacity} slot(s) available`,
    `Proposed additions: ${plan.selected.length}`,
    ...plan.selected.map(
      (item) =>
        `  + ${item.selector} [${item.score}] — ${item.reasons.join(", ")}`,
    ),
    ...plan.alternatives.map(
      (item) =>
        `  = ${item.unitId}: selected ${item.selected}; deferred equivalent source(s): ${item.deferred.join(", ")}`,
    ),
    ...(plan.activation
      ? ["", "Exact activation delta:", formatActivationPlan(plan.activation)]
      : []),
    ...plan.warnings.map((warning) => `Warning: ${warning}`),
  ].join("\n");
}
