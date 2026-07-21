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
import { detectAgents } from "./paths.js";
import { formatDetectedSignals, scanProject } from "./recommend.js";
import { scanInstalledSkills } from "./skill-inventory.js";
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
  agentPlans: AgentActiveSetPlan[];
  /** @deprecated Read agentPlans for truthful per-agent budgets. */
  activeBefore: number;
  /** @deprecated Read agentPlans for truthful per-agent budgets. */
  capacity: number;
  /** @deprecated Union of per-agent selections for older JSON consumers. */
  selected: ActiveSetCandidate[];
  alternatives: Array<{
    unitId: string;
    selected: string;
    deferred: string[];
  }>;
  activation?: ActivationPlan;
  warnings: string[];
}

export interface AgentActiveSetPlan {
  agent: AgentId;
  displayName: string;
  activeBefore: number;
  managedBefore: number;
  unmanagedBefore: number;
  capacity: number;
  selected: ActiveSetCandidate[];
  alternatives: ProjectActiveSetPlan["alternatives"];
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
  "deployment-pipeline-design",
  "documentation-writer",
  "openai-docs",
]);

const SPECIALIZED_WITHOUT_SIGNAL =
  /(?:appstore|msstore|backtesting|bats-|oracle|salesforce|power-bi|dataverse|qdrant|azure-|aws-|mcp-server-generator|sandbox-npm|migration|social-(?:publish|media)|marketing|copywriting)/;

/**
 * A matching word such as `mcp`, `cli`, or `publish` is not enough to make a
 * skill compatible with the detected project. These gates run before scoring
 * so a strong generic signal cannot pull in tooling for another ecosystem.
 * Explicit pins remain an intentional user override.
 */
function hasProjectCompatibility(
  name: string,
  project: ProjectSignals,
): boolean {
  const hasLanguage = (language: string) =>
    project.languages.includes(language);
  const languageRequirements: Array<[RegExp, string]> = [
    [/(?:dotnet|csharp|aspnet|nuget|maui)/, ".net"],
    [
      /(?:python|pytest|fastapi|django|flask|pydantic|poetry|uv-package)/,
      "python",
    ],
    [/(?:^|-)go(?:-|$)|golang/, "go"],
    [/(?:rust|cargo)/, "rust"],
    [/(?:^|-)java(?:-|$)|spring-boot/, "java"],
    [/(?:ruby|rails|bundler)/, "ruby"],
    [/(?:elixir|phoenix)/, "elixir"],
  ];
  for (const [pattern, language] of languageRequirements)
    if (pattern.test(name) && !hasLanguage(language)) return false;

  if (
    /(?:nodejs-)?backend|api-server/.test(name) &&
    !project.roles.includes("backend")
  )
    return false;

  if (
    /(?:^|-)vercel(?:-|$)/.test(name) &&
    !project.frameworks.includes("next.js") &&
    !project.files.includes("vercel.json")
  )
    return false;
  if (
    /(?:publish-to-pages|github-pages|cloudflare-pages)/.test(name) &&
    !project.frameworks.some((framework) =>
      ["react", "next.js", "vue", "svelte"].includes(framework),
    )
  )
    return false;
  return true;
}

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
    pattern: /(?:javascript|typescript|nodejs|webapp)|(?:^|-)npm(?:-|$)/,
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
  {
    signal: (project) => project.roles.includes("node-cli"),
    pattern:
      /^(?:cli|cli-design|cli-mastery|node-cli|command-line|command-line-tools?|building-cli(?:-apps?)?)$/,
    label: "Node CLI",
  },
  {
    signal: (project) => project.roles.includes("npm-package"),
    pattern: /(?:^|-)npm(?:-|$)|package|publish/,
    label: "npm package",
  },
  {
    signal: (project) => project.roles.includes("release"),
    pattern: /release|publish|package/,
    label: "release automation",
  },
  {
    signal: (project) => project.roles.includes("mcp"),
    pattern: /mcp|model-context-protocol/,
    label: "MCP tooling",
  },
  {
    signal: (project) => project.roles.includes("security"),
    pattern: /security|threat|secrets|owasp/,
    label: "security policy",
  },
  {
    signal: (project) => project.tools.includes("vitest"),
    pattern: /vitest/,
    label: "Vitest",
  },
  {
    signal: (project) => project.tools.includes("commander"),
    pattern:
      /^(?:cli|cli-design|cli-mastery|node-cli|commander|command-line|command-line-tools?|building-cli(?:-apps?)?)$/,
    label: "Commander CLI",
  },
  {
    signal: (project) => project.tools.includes("zod"),
    pattern: /zod|schema-validation|(?:^|-)validation(?:-|$)/,
    label: "Zod schemas",
  },
];

const FAMILY_CAPS: Record<string, number> = {
  "browser-testing": 3,
  documentation: 2,
  "code-review": 2,
  architecture: 2,
  planning: 3,
  security: 3,
  "language-tooling": 5,
  testing: 3,
  uncategorized: 3,
};

function candidateFamily(unitId: string): string {
  if (/playwright|e2e|webapp-testing|browser-testing/.test(unitId))
    return "browser-testing";
  if (/docs|documentation|readme/.test(unitId)) return "documentation";
  if (/review|refactor/.test(unitId)) return "code-review";
  if (/architect|api-design|openapi/.test(unitId)) return "architecture";
  if (/brainstorm|planning|writing-plans/.test(unitId)) return "planning";
  if (/security|threat|secrets|owasp/.test(unitId)) return "security";
  if (/test|coverage|vitest|jest/.test(unitId)) return "testing";
  if (/javascript|typescript|nodejs|npm|package|cli|zod|schema/.test(unitId))
    return "language-tooling";
  return "uncategorized";
}

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
  if (
    /(?:^|-)jest(?:-|$)/.test(name) &&
    project.tools.includes("vitest") &&
    !project.tools.includes("jest")
  )
    return undefined;
  let score = 0;
  const reasons: string[] = [];
  if (pinned.has(id) || pinned.has(record.unitId)) {
    score += 1000;
    reasons.push("explicitly pinned");
  }
  const explicitlyPinned = score >= 1000;
  if (!explicitlyPinned && !hasProjectCompatibility(name, project))
    return undefined;
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

function rankedCandidates(
  records: ManagedActivationRecord[],
  project: ProjectSignals,
  pins: Set<string>,
  outcomes: LocalOutcomeStore,
  taskFamilies: OutcomeTaskFamily[],
): ActiveSetCandidate[] {
  const scored = records
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
  const unique: ActiveSetCandidate[] = [];
  const claimedUnits = new Set<string>();
  const familyCounts = new Map<string, number>();
  for (const item of scored) {
    const fullPin = pins.has(item.selector);
    if (!fullPin && claimedUnits.has(item.unitId)) continue;
    const family = candidateFamily(item.unitId);
    if (!fullPin && (familyCounts.get(family) ?? 0) >= FAMILY_CAPS[family])
      continue;
    claimedUnits.add(item.unitId);
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    unique.push(item);
  }
  return unique;
}

function alternativesFor(
  selected: ActiveSetCandidate[],
  scored: ActiveSetCandidate[],
): ProjectActiveSetPlan["alternatives"] {
  return selected.flatMap((chosen) => {
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
  const requestedAgents = options.agents ?? [
    ...new Set(relevant.map((record) => record.agent)),
  ];
  const detected = (await detectAgents()).filter((agent) =>
    requestedAgents.includes(agent.id),
  );
  const inventory = await scanInstalledSkills(detected);
  const pins = new Set(options.pins ?? []);
  const warnings: string[] = [];
  const agentPlans = requestedAgents.map((agent): AgentActiveSetPlan => {
    const summary = inventory.agents.find((item) => item.agent === agent);
    if (!summary)
      throw new Error(
        `Could not scan active skills for requested agent '${agent}'`,
      );
    const capacity = Math.max(0, limit - summary.total);
    const ranked = rankedCandidates(
      relevant.filter((record) => record.agent === agent),
      project,
      pins,
      outcomes,
      taskFamilies,
    );
    const selected = ranked.slice(0, capacity);
    if (!capacity)
      warnings.push(
        `${summary.displayName} has reached the active-set limit ${limit}; disable skills or raise --limit.`,
      );
    return {
      agent,
      displayName: summary.displayName,
      activeBefore: summary.total,
      managedBefore: summary.managed,
      unmanagedBefore: summary.unmanaged,
      capacity,
      selected,
      alternatives: alternativesFor(selected, ranked),
    };
  });
  const activationPlans = await Promise.all(
    agentPlans
      .filter((agentPlan) => agentPlan.selected.length)
      .map((agentPlan) =>
        planActivationChange(
          "enable",
          agentPlan.selected.map((item) => item.selector),
          { agents: [agentPlan.agent] },
        ),
      ),
  );
  const activation = activationPlans.length
    ? {
        action: "enable" as const,
        packages: [
          ...new Set(activationPlans.flatMap((plan) => plan.packages)),
        ],
        requestedAgents,
        changes: activationPlans.flatMap((plan) => plan.changes),
        skipped: activationPlans.flatMap((plan) => plan.skipped),
        blocked: activationPlans.some((plan) => plan.blocked),
        warnings: activationPlans.flatMap((plan) => plan.warnings),
      }
    : undefined;
  const selected = [
    ...new Map(
      agentPlans
        .flatMap((agentPlan) => agentPlan.selected)
        .map((item) => [item.selector, item]),
    ).values(),
  ];
  const alternatives = agentPlans.flatMap((item) => item.alternatives);
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
  return {
    project,
    limit,
    ...(options.agents ? { agents: options.agents } : {}),
    agentPlans,
    activeBefore: Math.max(0, ...agentPlans.map((item) => item.activeBefore)),
    capacity: Math.min(limit, ...agentPlans.map((item) => item.capacity)),
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
  return applyActivationChange(plan.activation, {
    preflight: async () => {
      const requested = plan.agentPlans.map((item) => item.agent);
      const detected = (await detectAgents()).filter((agent) =>
        requested.includes(agent.id),
      );
      const inventory = await scanInstalledSkills(detected);
      for (const agentPlan of plan.agentPlans) {
        const current = inventory.agents.find(
          (item) => item.agent === agentPlan.agent,
        );
        if (!current)
          throw new Error(
            `Could not re-scan active skills for requested agent '${agentPlan.agent}'`,
          );
        if (current.total + agentPlan.selected.length > plan.limit)
          throw new Error(
            `${agentPlan.displayName} active skill capacity changed after preview: ${current.total} active plus ${agentPlan.selected.length} proposed exceeds limit ${plan.limit}`,
          );
      }
    },
  });
}

export function formatProjectActivation(plan: ProjectActiveSetPlan): string {
  return [
    `Project: ${plan.project.root}`,
    `Detected: ${formatDetectedSignals(plan.project) || "no known project signals"}`,
    ...plan.agentPlans.flatMap((agentPlan) => [
      `${agentPlan.displayName}: ${agentPlan.activeBefore} active (${agentPlan.managedBefore} managed, ${agentPlan.unmanagedBefore} unmanaged); ${agentPlan.capacity}/${plan.limit} slots available`,
      `Proposed additions for ${agentPlan.displayName}: ${agentPlan.selected.length}`,
      ...agentPlan.selected.map(
        (item) =>
          `  + ${item.selector} [${item.score}] — ${item.reasons.join(", ")}`,
      ),
      ...agentPlan.alternatives.map(
        (item) =>
          `  = ${item.unitId}: selected ${item.selected}; deferred equivalent source(s): ${item.deferred.join(", ")}`,
      ),
    ]),
    ...(plan.activation
      ? ["", "Exact activation delta:", formatActivationPlan(plan.activation)]
      : []),
    ...plan.warnings.map((warning) => `Warning: ${warning}`),
  ].join("\n");
}
