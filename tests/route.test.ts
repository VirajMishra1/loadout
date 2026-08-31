import { describe, expect, it } from "vitest";
import {
  allPhaseRoutes,
  classifyTask,
  cheapestInTier,
  estimateCostSavings,
  formatCostTable,
  formatModelCatalog,
  formatRouteRecommendation,
  formatRoutingTable,
  MODEL_CATALOG,
  modelsByProvider,
  modelsForTier,
  modelsRunnableBy,
  resolveAvailableAgents,
  routePhase,
  routeTask,
} from "../src/core/routing/route.js";

describe("route", () => {
  it("classifies planning tasks as plan phase", () => {
    expect(classifyTask("design the auth system architecture")).toBe("plan");
    expect(classifyTask("plan the database schema")).toBe("plan");
  });

  it("classifies implementation tasks", () => {
    expect(classifyTask("implement the user login feature")).toBe("implement");
    expect(classifyTask("build the API endpoint")).toBe("implement");
  });

  it("classifies debug tasks", () => {
    expect(classifyTask("fix the null pointer bug")).toBe("debug");
    expect(classifyTask("debug the crash on startup")).toBe("debug");
  });

  it("classifies test tasks", () => {
    expect(classifyTask("write unit tests for auth")).toBe("test");
    expect(classifyTask("add integration test coverage")).toBe("test");
  });

  it("classifies review tasks", () => {
    expect(classifyTask("review the pull request changes")).toBe("review");
  });

  it("classifies documentation tasks", () => {
    expect(classifyTask("document the API endpoints")).toBe("document");
    expect(classifyTask("update the readme")).toBe("document");
  });

  it("defaults ambiguous tasks to implement", () => {
    expect(classifyTask("do the thing")).toBe("implement");
  });

  it("routes a task to the correct tier", () => {
    const rec = routeTask("design the authentication system");
    expect(rec.phase).toBe("plan");
    expect(rec.tier).toBe("frontier");
    expect(rec.suggestedAgents).toContain("claude-code");
    expect(rec.models.length).toBeGreaterThan(0);
  });

  it("routes test phase to fast tier", () => {
    const rec = routePhase("test");
    expect(rec.tier).toBe("fast");
  });

  it("conserve mode drops plan from frontier to standard", () => {
    const normal = routePhase("plan", false);
    const conserved = routePhase("plan", true);
    expect(normal.tier).toBe("frontier");
    expect(conserved.tier).toBe("standard");
  });

  it("conserve mode keeps already-fast phases at fast", () => {
    const normal = routePhase("test", false);
    const conserved = routePhase("test", true);
    expect(normal.tier).toBe("fast");
    expect(conserved.tier).toBe("fast");
  });

  it("includes conserve alternative for frontier phases", () => {
    const rec = routePhase("plan", false);
    expect(rec.conserveAlternative).toBeDefined();
    expect(rec.conserveAlternative!.tier).toBe("standard");
    expect(rec.conserveAlternative!.tradeoff).toBeTruthy();
  });

  it("returns all six phases", () => {
    const routes = allPhaseRoutes();
    expect(routes).toHaveLength(6);
    const phases = routes.map((r) => r.phase);
    expect(phases).toContain("plan");
    expect(phases).toContain("implement");
    expect(phases).toContain("review");
    expect(phases).toContain("test");
    expect(phases).toContain("debug");
    expect(phases).toContain("document");
  });

  it("model catalog covers anthropic and openai only", () => {
    const providers = new Set(MODEL_CATALOG.map((m) => m.provider));
    expect(providers).toEqual(new Set(["anthropic", "openai"]));
  });

  it("model catalog is the opinionated current set only", () => {
    const names = MODEL_CATALOG.map((m) => m.name);
    expect(names).toEqual([
      "Claude Opus 5",
      "Claude Sonnet 5",
      "GPT-5.6 Sol",
      "GPT-5.6 Terra",
      "GPT-5.6 Luna",
    ]);
    // Weaker and legacy lines are deliberately excluded.
    expect(names.join()).not.toMatch(/Haiku|Fable|o3|o4|4\.6|4\.8|5\.4|5\.5/);
    expect(MODEL_CATALOG.every((m) => m.current)).toBe(true);
  });

  it("gives Claude Code no fast tier and Codex all three", () => {
    const claude = MODEL_CATALOG.filter((m) =>
      m.nativeAgents.includes("claude-code"),
    ).map((m) => m.tier);
    expect(claude.sort()).toEqual(["frontier", "standard"]);
    const codex = MODEL_CATALOG.filter((m) =>
      m.nativeAgents.includes("codex"),
    ).map((m) => m.tier);
    expect(codex.sort()).toEqual(["fast", "frontier", "standard"]);
  });

  it("steps a Claude-only user up when the tier has nothing they can run", () => {
    const output = formatRouteRecommendation(routePhase("test"), {
      installedAgents: ["claude-code"],
    });
    expect(output).toContain("Claude Sonnet 5");
    expect(output).not.toContain("Luna");
    expect(output).toContain("no fast-tier model");
  });

  it("does not step up when the tier is reachable", () => {
    const output = formatRouteRecommendation(routePhase("test"), {
      installedAgents: ["codex"],
    });
    expect(output).toContain("GPT-5.6 Luna");
    expect(output).not.toContain("no fast-tier model");
  });

  it("modelsForTier returns only the requested tier", () => {
    const fast = modelsForTier("fast");
    expect(fast.every((m) => m.tier === "fast")).toBe(true);
    expect(fast.length).toBeGreaterThan(0);
  });

  it("modelsByProvider filters correctly", () => {
    const anthropic = modelsByProvider("anthropic");
    expect(anthropic.every((m) => m.provider === "anthropic")).toBe(true);
  });

  it("cheapestInTier returns the lowest input cost", () => {
    const cheapest = cheapestInTier("fast")!;
    const allFast = modelsForTier("fast");
    for (const m of allFast) {
      expect(cheapest.inputCostPer1M).toBeLessThanOrEqual(m.inputCostPer1M);
    }
  });

  it("cost savings conserve total is less than normal total", () => {
    const { normalTotal, conserveTotal } = estimateCostSavings();
    expect(conserveTotal).toBeLessThan(normalTotal);
  });

  it("formats a routing table without throwing", () => {
    expect(formatRoutingTable()).toContain("Phase");
    expect(formatRoutingTable()).toContain("frontier");
  });

  it("formats a cost table without throwing", () => {
    expect(formatCostTable()).toContain("Normal total");
    expect(formatCostTable()).toContain("Conserve total");
  });

  it("resolves available agents against installed set", () => {
    const { available, missing } = resolveAvailableAgents(
      ["claude-code", "codex"],
      ["claude-code"],
    );
    expect(available).toEqual(["claude-code"]);
    expect(missing).toEqual(["codex"]);
  });

  it("filters models to those the given agents can run", () => {
    const frontier = modelsForTier("frontier");
    const claudeOnly = modelsRunnableBy(frontier, ["claude-code"]);
    expect(claudeOnly.every((m) => m.provider === "anthropic")).toBe(true);
    const codexOnly = modelsRunnableBy(frontier, ["codex"]);
    expect(codexOnly.every((m) => m.provider === "openai")).toBe(true);
  });

  it("returns all models when no agents are supplied", () => {
    const frontier = modelsForTier("frontier");
    expect(modelsRunnableBy(frontier, [])).toHaveLength(frontier.length);
  });

  it("names uninstalled agents rather than silently recommending them", () => {
    const rec = routePhase("implement");
    const output = formatRouteRecommendation(rec, {
      installedAgents: ["claude-code"],
    });
    expect(output).toContain("not installed: codex");
  });

  it("emits a runnable handoff command for the detected agent", () => {
    const rec = routeTask("implement the login form");
    const output = formatRouteRecommendation(rec, {
      installedAgents: ["codex"],
      description: "implement the login form",
      handoffReady: true,
    });
    expect(output).toContain(
      "loadout handoff send codex 'implement the login form'",
    );
    expect(output).not.toContain("handoff init");
  });

  it("prompts for handoff init when the project has no .handoff directory", () => {
    const rec = routeTask("write tests");
    const output = formatRouteRecommendation(rec, {
      installedAgents: ["claude-code"],
      description: "write tests",
      handoffReady: false,
    });
    expect(output).toContain("loadout handoff init");
  });

  it("escapes single quotes in the handoff command", () => {
    const rec = routeTask("fix the user's session bug");
    const output = formatRouteRecommendation(rec, {
      installedAgents: ["codex"],
      description: "fix the user's session bug",
      handoffReady: true,
    });
    expect(output).toContain(`'fix the user'\\''s session bug'`);
  });

  it("omits the handoff line when no suggested agent is installed", () => {
    const rec = routePhase("plan");
    const output = formatRouteRecommendation(rec, {
      installedAgents: [],
      description: "design the schema",
    });
    expect(output).not.toContain("Hand off:");
    expect(output).toContain("none detected");
  });

  it("formats a recommendation with conserve alternative", () => {
    const rec = routeTask("design the auth system");
    const formatted = formatRouteRecommendation(rec);
    expect(formatted).toContain("Phase:");
    expect(formatted).toContain("Conserve:");
  });

  it("formats model catalog with provider filter", () => {
    const output = formatModelCatalog({ provider: "anthropic" });
    expect(output).toContain("Claude");
    expect(output).not.toContain("GPT-5.6");
  });

  it("formats model catalog with tier filter", () => {
    const output = formatModelCatalog({ tier: "fast" });
    expect(output).toContain("fast");
    expect(output).not.toMatch(/\bfrontier\b/);
  });
});
