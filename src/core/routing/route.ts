import type { AgentId } from "../../shared/types.js";

// ---------------------------------------------------------------------------
// Model catalog — every model Loadout knows about, with real pricing
// ---------------------------------------------------------------------------

export interface ModelEntry {
  id: string;
  provider: "anthropic" | "openai";
  name: string;
  tier: "frontier" | "standard" | "fast";
  /** Input cost per million tokens (USD). */
  inputCostPer1M: number;
  /** Output cost per million tokens (USD). */
  outputCostPer1M: number;
  /** Which agents can run this model natively. */
  nativeAgents: AgentId[];
  /** True if still the current generation (not deprecated). */
  current: boolean;
  generation: string;
}

// Sources:
// Anthropic: https://allaboutclaude.com/models
// OpenAI:    https://benchlm.ai/openai/api-pricing
// Prices as of August 2026.
export const MODEL_CATALOG: ModelEntry[] = [
  // --- Anthropic (Claude Code) ---
  // Haiku and the 4.x line are deliberately absent: for real coding work the
  // choice is Opus or Sonnet, and offering a weaker tier invites picking it.
  {
    id: "claude-opus-5",
    provider: "anthropic",
    name: "Claude Opus 5",
    tier: "frontier",
    inputCostPer1M: 5,
    outputCostPer1M: 25,
    nativeAgents: ["claude-code"],
    current: true,
    generation: "5",
  },
  {
    id: "claude-sonnet-5",
    provider: "anthropic",
    name: "Claude Sonnet 5",
    tier: "standard",
    inputCostPer1M: 3,
    outputCostPer1M: 15,
    nativeAgents: ["claude-code"],
    current: true,
    generation: "5",
  },

  // --- OpenAI (Codex) — the current GPT-5.6 tiers only ---
  {
    id: "gpt-5.6-sol",
    provider: "openai",
    name: "GPT-5.6 Sol",
    tier: "frontier",
    inputCostPer1M: 5,
    outputCostPer1M: 30,
    nativeAgents: ["codex"],
    current: true,
    generation: "5.6",
  },
  {
    id: "gpt-5.6-terra",
    provider: "openai",
    name: "GPT-5.6 Terra",
    tier: "standard",
    inputCostPer1M: 2,
    outputCostPer1M: 12,
    nativeAgents: ["codex"],
    current: true,
    generation: "5.6",
  },
  {
    id: "gpt-5.6-luna",
    provider: "openai",
    name: "GPT-5.6 Luna",
    tier: "fast",
    inputCostPer1M: 0.2,
    outputCostPer1M: 1.2,
    nativeAgents: ["codex"],
    current: true,
    generation: "5.6",
  },
];

// ---------------------------------------------------------------------------
// Task phases and routing
// ---------------------------------------------------------------------------

export type TaskPhase =
  "plan" | "implement" | "review" | "test" | "debug" | "document";

export interface RouteRecommendation {
  phase: TaskPhase;
  tier: "frontier" | "standard" | "fast";
  tierLabel: string;
  models: ModelEntry[];
  reason: string;
  suggestedAgents: AgentId[];
  conserveAlternative?: {
    tier: "standard" | "fast";
    models: ModelEntry[];
    tradeoff: string;
  };
}

const TIER_LABELS: Record<string, string> = {
  frontier: "Frontier (deep reasoning)",
  standard: "Standard (balanced)",
  fast: "Fast (high throughput)",
};

interface PhaseConfig {
  tier: "frontier" | "standard" | "fast";
  reason: string;
  agents: AgentId[];
  /** When --conserve, drop to this tier instead. */
  conserveTier?: "standard" | "fast";
  conserveTradeoff?: string;
}

const PHASE_CONFIG: Record<TaskPhase, PhaseConfig> = {
  plan: {
    tier: "frontier",
    reason:
      "Architecture and decomposition need deep reasoning to avoid costly rework",
    agents: ["claude-code"],
    conserveTier: "standard",
    conserveTradeoff:
      "Slightly shallower architectural reasoning; review the plan more carefully",
  },
  implement: {
    tier: "standard",
    reason:
      "Implementation is high-volume; standard models score within 5% of frontier on SWE-bench",
    agents: ["claude-code", "codex"],
    conserveTier: "fast",
    conserveTradeoff:
      "May need more iterations on complex logic; fine for CRUD and boilerplate",
  },
  review: {
    tier: "frontier",
    reason:
      "Code review catches subtle bugs that cheaper models miss; worth the cost per-review",
    agents: ["claude-code", "codex"],
    conserveTier: "standard",
    conserveTradeoff: "May miss edge-case bugs; pair with a linter",
  },
  test: {
    tier: "fast",
    reason:
      "Test generation is pattern-heavy; fast models produce equivalent coverage",
    agents: ["claude-code", "codex"],
  },
  debug: {
    tier: "standard",
    reason:
      "Targeted debugging needs good reasoning but not frontier-level; standard balances cost and quality",
    agents: ["claude-code", "codex"],
    conserveTier: "fast",
    conserveTradeoff:
      "Works for simple bugs; complex root-cause analysis may suffer",
  },
  document: {
    tier: "fast",
    reason:
      "Documentation and comments are well-suited to fast models; any decent model writes docs",
    agents: ["claude-code", "codex"],
  },
};

const PHASE_KEYWORDS: Record<TaskPhase, readonly string[]> = {
  plan: [
    "plan",
    "design",
    "architect",
    "architecture",
    "rfc",
    "spec",
    "decompose",
    "strategy",
    "system design",
  ],
  implement: [
    "implement",
    "build",
    "code",
    "create",
    "add",
    "feature",
    "write",
    "develop",
    "make",
  ],
  review: [
    "review",
    "audit",
    "check",
    "inspect",
    "critique",
    "pr",
    "pull request",
    "diff",
  ],
  test: [
    "test",
    "spec",
    "coverage",
    "unit",
    "integration",
    "e2e",
    "assert",
    "vitest",
    "jest",
  ],
  debug: [
    "debug",
    "fix",
    "bug",
    "error",
    "crash",
    "broken",
    "investigate",
    "troubleshoot",
    "failing",
  ],
  document: [
    "document",
    "docs",
    "readme",
    "comment",
    "jsdoc",
    "changelog",
    "explain",
    "docstring",
  ],
};

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function classifyTask(description: string): TaskPhase {
  const lower = description.toLowerCase();
  let best: TaskPhase = "implement";
  let bestScore = 0;
  for (const [phase, keywords] of Object.entries(PHASE_KEYWORDS) as [
    TaskPhase,
    readonly string[],
  ][]) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = phase;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Model queries
// ---------------------------------------------------------------------------

export function modelsForTier(
  tier: "frontier" | "standard" | "fast",
  currentOnly = true,
): ModelEntry[] {
  return MODEL_CATALOG.filter(
    (m) => m.tier === tier && (!currentOnly || m.current),
  );
}

export function modelsByProvider(
  provider: ModelEntry["provider"],
): ModelEntry[] {
  return MODEL_CATALOG.filter((m) => m.provider === provider && m.current);
}

export function cheapestInTier(
  tier: "frontier" | "standard" | "fast",
): ModelEntry | undefined {
  const models = modelsForTier(tier);
  return models.sort((a, b) => a.inputCostPer1M - b.inputCostPer1M)[0];
}

/**
 * Narrow a recommendation to the agents actually present on this machine. A
 * recommendation that names an agent the user has not installed is noise, so
 * the resolved list drives both the printed advice and the handoff command.
 */
export function resolveAvailableAgents(
  suggested: AgentId[],
  installed: AgentId[],
): { available: AgentId[]; missing: AgentId[] } {
  const present = new Set(installed);
  return {
    available: suggested.filter((id) => present.has(id)),
    missing: suggested.filter((id) => !present.has(id)),
  };
}

/** Models in the recommended tier that the given agents can actually run. */
export function modelsRunnableBy(
  models: ModelEntry[],
  agents: AgentId[],
): ModelEntry[] {
  if (!agents.length) return models;
  const wanted = new Set(agents);
  return models.filter((m) => m.nativeAgents.some((id) => wanted.has(id)));
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export function routeTask(
  description: string,
  conserve = false,
): RouteRecommendation {
  return routePhase(classifyTask(description), conserve);
}

export function routePhase(
  phase: TaskPhase | string,
  conserve = false,
): RouteRecommendation {
  const config = PHASE_CONFIG[phase as TaskPhase];
  if (!config)
    throw new Error(
      `Unknown phase '${phase}'. Valid: ${Object.keys(PHASE_CONFIG).join(", ")}`,
    );

  const effectiveTier =
    conserve && config.conserveTier ? config.conserveTier : config.tier;
  const models = modelsForTier(effectiveTier);

  const rec: RouteRecommendation = {
    phase: phase as TaskPhase,
    tier: effectiveTier,
    tierLabel: TIER_LABELS[effectiveTier],
    models,
    reason:
      conserve && config.conserveTier
        ? `Conserve mode: ${config.conserveTradeoff}`
        : config.reason,
    suggestedAgents: config.agents,
  };

  if (!conserve && config.conserveTier) {
    rec.conserveAlternative = {
      tier: config.conserveTier,
      models: modelsForTier(config.conserveTier),
      tradeoff: config.conserveTradeoff!,
    };
  }

  return rec;
}

export function allPhaseRoutes(conserve = false): RouteRecommendation[] {
  return (Object.keys(PHASE_CONFIG) as TaskPhase[]).map((p) =>
    routePhase(p, conserve),
  );
}

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

export interface CostEstimate {
  phase: TaskPhase;
  tier: string;
  cheapestModel: string;
  inputCost: number;
  outputCost: number;
}

export function estimateCostSavings(): {
  estimates: CostEstimate[];
  normalTotal: number;
  conserveTotal: number;
} {
  const normal = allPhaseRoutes(false);
  const conserved = allPhaseRoutes(true);

  const estimates = normal.map((r) => {
    const cheapest = cheapestInTier(r.tier);
    return {
      phase: r.phase,
      tier: r.tier,
      cheapestModel: cheapest?.name ?? "—",
      inputCost: cheapest?.inputCostPer1M ?? 0,
      outputCost: cheapest?.outputCostPer1M ?? 0,
    };
  });

  const normalTotal = estimates.reduce((s, e) => s + e.inputCost, 0);
  const conserveEstimates = conserved.map(
    (r) => cheapestInTier(r.tier)?.inputCostPer1M ?? 0,
  );
  const conserveTotal = conserveEstimates.reduce((s, c) => s + c, 0);

  return { estimates, normalTotal, conserveTotal };
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export interface RouteContext {
  /** Agents detected on this machine; empty means "not checked". */
  installedAgents?: AgentId[];
  /** The original task text, used to build a copy-pasteable handoff command. */
  description?: string;
}

/** Shell-quote a task description for the suggested handoff command. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function formatRouteRecommendation(
  rec: RouteRecommendation,
  context: RouteContext = {},
): string {
  // `undefined` means detection never ran, so every suggested agent stands. An
  // empty array means detection ran and found nothing, which must not be
  // silently upgraded back to the full suggestion list.
  const checked = context.installedAgents !== undefined;
  const { available, missing } = checked
    ? resolveAvailableAgents(rec.suggestedAgents, context.installedAgents!)
    : { available: rec.suggestedAgents, missing: [] as AgentId[] };

  // Only recommend models an available agent can actually run. Not every
  // provider offers every tier — Claude Code has no fast tier — so when the
  // recommended tier holds nothing the user can reach, step up to the nearest
  // tier that does rather than naming a model they cannot run.
  const runnable = checked
    ? modelsRunnableBy(rec.models, available)
    : rec.models;
  const stepUp: Record<string, "standard" | "frontier"> = {
    fast: "standard",
    standard: "frontier",
  };
  let effective = runnable;
  let tier: string = rec.tier;
  let substituted: { from: string; to: string } | undefined;
  while (checked && available.length && !effective.length && stepUp[tier]) {
    const next = stepUp[tier];
    effective = modelsRunnableBy(modelsForTier(next), available);
    if (effective.length) substituted = { from: rec.tier, to: next };
    tier = next;
  }
  const shown = (effective.length ? effective : rec.models).slice(0, 4);
  const modelNames = shown.map(
    (m) => `${m.name} ($${m.inputCostPer1M}/$${m.outputCostPer1M})`,
  );

  const lines = [
    `Phase:    ${rec.phase}`,
    `Tier:     ${rec.tierLabel}`,
    `Models:   ${modelNames.join("\n          ")}`,
    `Agents:   ${available.length ? available.join(", ") : "none detected"}${
      missing.length ? `  (not installed: ${missing.join(", ")})` : ""
    }`,
    `Why:      ${rec.reason}`,
  ];

  if (substituted)
    lines.push(
      `Note:     your agents have no ${substituted.from}-tier model, so this shows`,
      `          the ${substituted.to} tier instead.`,
    );

  if (rec.conserveAlternative) {
    const alt = rec.conserveAlternative;
    const altCheapest = cheapestInTier(alt.tier);
    lines.push(
      ``,
      `Conserve: drop to ${alt.tier} tier (${altCheapest?.name ?? "—"} at $${altCheapest?.inputCostPer1M ?? "?"}/$${altCheapest?.outputCostPer1M ?? "?"})`,
      `          ${alt.tradeoff}`,
    );
  }

  // Actionable next step: hand this task to a detected agent.
  if (context.description && available.length) {
    const target = available[0];
    lines.push(
      ``,
      `Hand off:`,
      `  loadout handoff ${target} ${shellQuote(context.description)}`,
    );
  }

  return lines.join("\n");
}

export function formatRoutingTable(conserve = false): string {
  const routes = allPhaseRoutes(conserve);
  const header = `Phase        Tier        Cheapest model              $/M in   $/M out  Agents`;
  const divider = "─".repeat(header.length);
  const rows = routes.map((r) => {
    const cheapest = cheapestInTier(r.tier);
    const phase = r.phase.padEnd(12);
    const tier = r.tier.padEnd(11);
    const model = (cheapest?.name ?? "—").padEnd(27);
    const inCost = `$${(cheapest?.inputCostPer1M ?? 0).toFixed(2)}`.padEnd(8);
    const outCost = `$${(cheapest?.outputCostPer1M ?? 0).toFixed(2)}`.padEnd(8);
    const agents = r.suggestedAgents.slice(0, 3).join(", ");
    return `${phase} ${tier} ${model} ${inCost} ${outCost} ${agents}`;
  });
  return [
    conserve
      ? "ROUTING TABLE (conserve mode — usage-saving tier for each phase)"
      : "ROUTING TABLE",
    "",
    header,
    divider,
    ...rows,
  ].join("\n");
}

export function formatCostTable(): string {
  const { estimates, normalTotal, conserveTotal } = estimateCostSavings();
  const header =
    "Phase        Tier        Cheapest model              $/M input";
  const divider = "─".repeat(header.length);
  const rows = estimates.map((e) => {
    const phase = e.phase.padEnd(12);
    const tier = e.tier.padEnd(11);
    const model = e.cheapestModel.padEnd(27);
    return `${phase} ${tier} ${model} $${e.inputCost.toFixed(2)}`;
  });
  const savings = Math.round((1 - conserveTotal / normalTotal) * 100);
  return [
    header,
    divider,
    ...rows,
    divider,
    `Normal total: $${normalTotal.toFixed(2)}/M input across 6 phases`,
    `Conserve total: $${conserveTotal.toFixed(2)}/M input (${savings}% cheaper)`,
    "",
    "Prices are per-million-token list rates. Actual cost depends on prompt length.",
    "Use --conserve when you want to stretch remaining session quota.",
  ].join("\n");
}

export function formatModelCatalog(filter?: {
  provider?: string;
  tier?: string;
  current?: boolean;
}): string {
  let models = MODEL_CATALOG;
  if (filter?.provider)
    models = models.filter((m) => m.provider === filter.provider);
  if (filter?.tier) models = models.filter((m) => m.tier === filter.tier);
  if (filter?.current !== undefined)
    models = models.filter((m) => m.current === filter.current);

  const header =
    "Model                        Provider    Tier        $/M in   $/M out  Gen    Agents";
  const divider = "─".repeat(header.length);
  const rows = models.map((m) => {
    const name = m.name.padEnd(28);
    const provider = m.provider.padEnd(11);
    const tier = m.tier.padEnd(11);
    const inCost = `$${m.inputCostPer1M.toFixed(2)}`.padEnd(8);
    const outCost = `$${m.outputCostPer1M.toFixed(2)}`.padEnd(8);
    const gen = m.generation.padEnd(6);
    const agents = m.nativeAgents.slice(0, 3).join(", ");
    return `${name} ${provider} ${tier} ${inCost} ${outCost} ${gen} ${agents}`;
  });
  return [
    `${models.length} models${filter?.current === false ? " (including legacy)" : ""}`,
    "",
    header,
    divider,
    ...rows,
  ].join("\n");
}
