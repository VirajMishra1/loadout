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
  routePhase,
  routeTask,
} from "../src/core/route.js";

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

  it("model catalog includes current-gen models from both providers", () => {
    const currentModels = MODEL_CATALOG.filter((m) => m.current);
    expect(currentModels.length).toBeGreaterThan(10);
    const names = currentModels.map((m) => m.name);
    expect(names).toContain("Claude Opus 5");
    expect(names).toContain("Claude Sonnet 5");
    expect(names).toContain("Claude Haiku 4.5");
    expect(names).toContain("GPT-5.6 Sol");
    expect(names).toContain("GPT-5.6 Terra");
    expect(names).toContain("GPT-5.6 Luna");
    expect(names).toContain("GPT-5.5");
    expect(names).toContain("GPT-5.4");
    expect(names).toContain("GPT-5.4 Mini");
    expect(names).toContain("o4-mini");
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
