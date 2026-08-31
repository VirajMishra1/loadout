import type { AgentId } from "../shared/types.js";

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
  { id: "claude-fable-5", provider: "anthropic", name: "Claude Fable 5", tier: "frontier", inputCostPer1M: 10, outputCostPer1M: 50, nativeAgents: ["claude-code"], current: true, generation: "5" },
  { id: "claude-opus-5", provider: "anthropic", name: "Claude Opus 5", tier: "frontier", inputCostPer1M: 5, outputCostPer1M: 25, nativeAgents: ["claude-code"], current: true, generation: "5" },
  { id: "claude-sonnet-5", provider: "anthropic", name: "Claude Sonnet 5", tier: "standard", inputCostPer1M: 3, outputCostPer1M: 15, nativeAgents: ["claude-code"], current: true, generation: "5" },
  { id: "claude-opus-4-8", provider: "anthropic", name: "Claude Opus 4.8", tier: "frontier", inputCostPer1M: 5, outputCostPer1M: 25, nativeAgents: ["claude-code"], current: false, generation: "4" },
  { id: "claude-opus-4-6", provider: "anthropic", name: "Claude Opus 4.6", tier: "frontier", inputCostPer1M: 5, outputCostPer1M: 25, nativeAgents: ["claude-code"], current: false, generation: "4" },
  { id: "claude-sonnet-4-6", provider: "anthropic", name: "Claude Sonnet 4.6", tier: "standard", inputCostPer1M: 3, outputCostPer1M: 15, nativeAgents: ["claude-code"], current: false, generation: "4" },
  { id: "claude-haiku-4-5", provider: "anthropic", name: "Claude Haiku 4.5", tier: "fast", inputCostPer1M: 1, outputCostPer1M: 5, nativeAgents: ["claude-code"], current: true, generation: "4" },

  // --- OpenAI (Codex) — GPT-5.6 family ---
  { id: "gpt-5.6-sol", provider: "openai", name: "GPT-5.6 Sol", tier: "frontier", inputCostPer1M: 5, outputCostPer1M: 30, nativeAgents: ["codex"], current: true, generation: "5.6" },
  { id: "gpt-5.6-terra", provider: "openai", name: "GPT-5.6 Terra", tier: "standard", inputCostPer1M: 2, outputCostPer1M: 12, nativeAgents: ["codex"], current: true, generation: "5.6" },
  { id: "gpt-5.6-luna", provider: "openai", name: "GPT-5.6 Luna", tier: "fast", inputCostPer1M: 0.20, outputCostPer1M: 1.20, nativeAgents: ["codex"], current: true, generation: "5.6" },

  // --- OpenAI — GPT-5.5 ---
  { id: "gpt-5.5", provider: "openai", name: "GPT-5.5", tier: "frontier", inputCostPer1M: 5, outputCostPer1M: 30, nativeAgents: ["codex"], current: true, generation: "5.5" },

  // --- OpenAI — GPT-5.4 family ---
  { id: "gpt-5.4", provider: "openai", name: "GPT-5.4", tier: "standard", inputCostPer1M: 2.50, outputCostPer1M: 15, nativeAgents: ["codex"], current: true, generation: "5.4" },
  { id: "gpt-5.4-mini", provider: "openai", name: "GPT-5.4 Mini", tier: "fast", inputCostPer1M: 0.75, outputCostPer1M: 4.50, nativeAgents: ["codex"], current: true, generation: "5.4" },

  // --- OpenAI — Codex-specific ---
  { id: "gpt-5.1-codex", provider: "openai", name: "GPT-5.1 Codex", tier: "standard", inputCostPer1M: 1.25, outputCostPer1M: 10, nativeAgents: ["codex"], current: true, generation: "5.1" },

  // --- OpenAI — o-series reasoning ---
  { id: "o3-pro", provider: "openai", name: "o3-pro", tier: "frontier", inputCostPer1M: 20, outputCostPer1M: 80, nativeAgents: ["codex"], current: true, generation: "o3" },
  { id: "o3", provider: "openai", name: "o3", tier: "frontier", inputCostPer1M: 2, outputCostPer1M: 8, nativeAgents: ["codex"], current: true, generation: "o3" },
  { id: "o4-mini", provider: "openai", name: "o4-mini", tier: "standard", inputCostPer1M: 1.10, outputCostPer1M: 4.40, nativeAgents: ["codex"], current: true, generation: "o4" },
  { id: "o3-mini", provider: "openai", name: "o3-mini", tier: "standard", inputCostPer1M: 1.10, outputCostPer1M: 4.40, nativeAgents: ["codex"], current: true, generation: "o3" },
];

// ---------------------------------------------------------------------------
// Task phases and routing
// ---------------------------------------------------------------------------

export type TaskPhase = "plan" | "implement" | "review" | "test" | "debug" | "document";

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
    reason: "Architecture and decomposition need deep reasoning to avoid costly rework",
    agents: ["claude-code"],
    conserveTier: "standard",
    conserveTradeoff: "Slightly shallower architectural reasoning; review the plan more carefully",
  },
  implement: {
    tier: "standard",
    reason: "Implementation is high-volume; standard models score within 5% of frontier on SWE-bench",
    agents: ["claude-code", "codex"],
    conserveTier: "fast",
    conserveTradeoff: "May need more iterations on complex logic; fine for CRUD and boilerplate",
  },
  review: {
    tier: "frontier",
    reason: "Code review catches subtle bugs that cheaper models miss; worth the cost per-review",
    agents: ["claude-code", "codex"],
    conserveTier: "standard",
    conserveTradeoff: "May miss edge-case bugs; pair with a linter",
  },
  test: {
    tier: "fast",
    reason: "Test generation is pattern-heavy; fast models produce equivalent coverage",
    agents: ["claude-code", "codex"],
  },
  debug: {
    tier: "standard",
    reason: "Targeted debugging needs good reasoning but not frontier-level; standard balances cost and quality",
    agents: ["claude-code", "codex"],
    conserveTier: "fast",
    conserveTradeoff: "Works for simple bugs; complex root-cause analysis may suffer",
  },
  document: {
    tier: "fast",
    reason: "Documentation and comments are well-suited to fast models; any decent model writes docs",
    agents: ["claude-code", "codex"],
  },
};

const PHASE_KEYWORDS: Record<TaskPhase, readonly string[]> = {
  plan: ["plan", "design", "architect", "architecture", "rfc", "spec", "decompose", "strategy", "system design"],
  implement: ["implement", "build", "code", "create", "add", "feature", "write", "develop", "make"],
  review: ["review", "audit", "check", "inspect", "critique", "pr", "pull request", "diff"],
  test: ["test", "spec", "coverage", "unit", "integration", "e2e", "assert", "vitest", "jest"],
  debug: ["debug", "fix", "bug", "error", "crash", "broken", "investigate", "troubleshoot", "failing"],
  document: ["document", "docs", "readme", "comment", "jsdoc", "changelog", "explain", "docstring"],
};

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function classifyTask(description: string): TaskPhase {
  const lower = description.toLowerCase();
  let best: TaskPhase = "implement";
  let bestScore = 0;
  for (const [phase, keywords] of Object.entries(PHASE_KEYWORDS) as [TaskPhase, readonly string[]][]) {
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

export function modelsForTier(tier: "frontier" | "standard" | "fast", currentOnly = true): ModelEntry[] {
  return MODEL_CATALOG.filter((m) => m.tier === tier && (!currentOnly || m.current));
}

export function modelsByProvider(provider: ModelEntry["provider"]): ModelEntry[] {
  return MODEL_CATALOG.filter((m) => m.provider === provider && m.current);
}

export function cheapestInTier(tier: "frontier" | "standard" | "fast"): ModelEntry | undefined {
  const models = modelsForTier(tier);
  return models.sort((a, b) => a.inputCostPer1M - b.inputCostPer1M)[0];
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export function routeTask(description: string, conserve = false): RouteRecommendation {
  return routePhase(classifyTask(description), conserve);
}

export function routePhase(phase: TaskPhase | string, conserve = false): RouteRecommendation {
  const config = PHASE_CONFIG[phase as TaskPhase];
  if (!config) throw new Error(`Unknown phase '${phase}'. Valid: ${Object.keys(PHASE_CONFIG).join(", ")}`);

  const effectiveTier = conserve && config.conserveTier ? config.conserveTier : config.tier;
  const models = modelsForTier(effectiveTier);

  const rec: RouteRecommendation = {
    phase: phase as TaskPhase,
    tier: effectiveTier,
    tierLabel: TIER_LABELS[effectiveTier],
    models,
    reason: conserve && config.conserveTier
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
  return (Object.keys(PHASE_CONFIG) as TaskPhase[]).map((p) => routePhase(p, conserve));
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

export function estimateCostSavings(): { estimates: CostEstimate[]; normalTotal: number; conserveTotal: number } {
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
  const conserveEstimates = conserved.map((r) => cheapestInTier(r.tier)?.inputCostPer1M ?? 0);
  const conserveTotal = conserveEstimates.reduce((s, c) => s + c, 0);

  return { estimates, normalTotal, conserveTotal };
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export function formatRouteRecommendation(rec: RouteRecommendation): string {
  const modelNames = rec.models.slice(0, 4).map((m) => `${m.name} ($${m.inputCostPer1M}/$${m.outputCostPer1M})`);
  const lines = [
    `Phase:    ${rec.phase}`,
    `Tier:     ${rec.tierLabel}`,
    `Models:   ${modelNames.join("\n          ")}`,
    `Agents:   ${rec.suggestedAgents.join(", ")}`,
    `Why:      ${rec.reason}`,
  ];
  if (rec.conserveAlternative) {
    const alt = rec.conserveAlternative;
    const altCheapest = cheapestInTier(alt.tier);
    lines.push(
      ``,
      `Conserve: drop to ${alt.tier} tier (${altCheapest?.name ?? "—"} at $${altCheapest?.inputCostPer1M ?? "?"}/$${altCheapest?.outputCostPer1M ?? "?"})`,
      `          ${alt.tradeoff}`,
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
    conserve ? "ROUTING TABLE (conserve mode — usage-saving tier for each phase)" : "ROUTING TABLE",
    "", header, divider, ...rows,
  ].join("\n");
}

export function formatCostTable(): string {
  const { estimates, normalTotal, conserveTotal } = estimateCostSavings();
  const header = "Phase        Tier        Cheapest model              $/M input";
  const divider = "─".repeat(header.length);
  const rows = estimates.map((e) => {
    const phase = e.phase.padEnd(12);
    const tier = e.tier.padEnd(11);
    const model = e.cheapestModel.padEnd(27);
    return `${phase} ${tier} ${model} $${e.inputCost.toFixed(2)}`;
  });
  const savings = Math.round((1 - conserveTotal / normalTotal) * 100);
  return [
    header, divider, ...rows, divider,
    `Normal total: $${normalTotal.toFixed(2)}/M input across 6 phases`,
    `Conserve total: $${conserveTotal.toFixed(2)}/M input (${savings}% cheaper)`,
    "",
    "Prices are per-million-token list rates. Actual cost depends on prompt length.",
    "Use --conserve when you want to stretch remaining session quota.",
  ].join("\n");
}

export function formatModelCatalog(filter?: { provider?: string; tier?: string; current?: boolean }): string {
  let models = MODEL_CATALOG;
  if (filter?.provider) models = models.filter((m) => m.provider === filter.provider);
  if (filter?.tier) models = models.filter((m) => m.tier === filter.tier);
  if (filter?.current !== undefined) models = models.filter((m) => m.current === filter.current);

  const header = "Model                        Provider    Tier        $/M in   $/M out  Gen    Agents";
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
  return [`${models.length} models${filter?.current === false ? " (including legacy)" : ""}`, "", header, divider, ...rows].join("\n");
}
