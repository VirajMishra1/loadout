import { readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type {
  AgentId,
  CatalogPackage,
  PackageRecommendation,
  ProjectSignals,
} from "../shared/types.js";
import { POWER_SKILL_ALLOWLIST, STABLE_BOOST_PACKAGE_IDS } from "./profiles.js";
import {
  packageOutcomeAdjustment,
  projectTaskFamilies,
  type LocalOutcomeStore,
} from "./outcomes.js";

const SIGNAL_FILES = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  "mix.exs",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "next.config.js",
  "next.config.mjs",
  "vite.config.ts",
  "playwright.config.ts",
  "vercel.json",
  "SECURITY.md",
  ".git",
  ".obsidian",
]);

interface NodePackageMetadata {
  name?: string;
  private?: boolean;
  bin?: string | Record<string, string>;
  publishConfig?: Record<string, unknown>;
  keywords?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Additive machine-readable boundary for every rule-selected recommendation list. */
export const RECOMMENDATION_BOUNDARY = Object.freeze({
  selectionMethod: "deterministic-project-signal-rules",
  qualityEvidence: "not-established",
} as const);

const SIGNAL_LABELS: Record<string, string> = {
  "javascript/typescript": "TypeScript",
  playwright: "Playwright",
  "node-cli": "Node CLI",
  "npm-package": "npm package",
  release: "release automation",
  mcp: "MCP tooling",
  security: "security policy",
  "obsidian-vault": "Obsidian vault",
  commander: "Commander",
  zod: "Zod",
  vitest: "Vitest",
  jest: "Jest",
};

const SIGNAL_DISPLAY_ORDER = [
  "javascript/typescript",
  "playwright",
  "node-cli",
  "npm-package",
  "release",
  "mcp",
  "security",
  "obsidian-vault",
  "commander",
  "zod",
  "vitest",
  "jest",
];

export function formatDetectedSignals(signals: ProjectSignals): string {
  const values = new Set([
    ...signals.languages,
    ...signals.frameworks,
    ...signals.roles,
    ...signals.tools,
  ]);
  const ordered = [
    ...SIGNAL_DISPLAY_ORDER.filter((value) => values.delete(value)),
    ...values,
  ];
  return ordered.map((value) => SIGNAL_LABELS[value] ?? value).join(", ");
}

export async function scanProject(
  root = process.cwd(),
): Promise<ProjectSignals> {
  const absolute = resolve(root);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = entries
    .map((entry) => entry.name)
    .filter((name) => SIGNAL_FILES.has(name) || name.endsWith(".sln"))
    .sort();
  const languages = new Set<string>();
  const frameworks = new Set<string>();
  const roles = new Set<string>();
  const tools = new Set<string>();
  if (files.includes("package.json")) {
    languages.add("javascript/typescript");
    try {
      const pkg = JSON.parse(
        await readFile(resolve(absolute, "package.json"), "utf8"),
      ) as NodePackageMetadata;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next) frameworks.add("next.js");
      if (deps.react) frameworks.add("react");
      if (deps.vue) frameworks.add("vue");
      if (deps.svelte) frameworks.add("svelte");
      if (deps.playwright || deps["@playwright/test"]) {
        frameworks.add("playwright");
        tools.add("playwright");
      }
      if (deps.vitest) tools.add("vitest");
      if (deps.jest) tools.add("jest");
      if (deps.commander) tools.add("commander");
      if (deps.zod) tools.add("zod");
      if (
        deps.express ||
        deps.fastify ||
        deps.koa ||
        deps.hono ||
        deps["@nestjs/core"]
      )
        roles.add("backend");
      if (pkg.bin) roles.add("node-cli");
      if (pkg.publishConfig || pkg.private === false) roles.add("npm-package");
      const scripts = pkg.scripts ?? {};
      if (
        scripts.prepack ||
        Object.keys(scripts).some((name) => /(?:package|release)/.test(name))
      )
        roles.add("release");
      if (
        (pkg.keywords ?? []).some((keyword) =>
          /(?:^|-)mcp(?:-|$)/i.test(keyword),
        )
      )
        roles.add("mcp");
    } catch {
      /* malformed project metadata is reported through an empty framework set */
    }
  }
  if (files.includes("pyproject.toml") || files.includes("requirements.txt"))
    languages.add("python");
  if (files.includes("go.mod")) languages.add("go");
  if (files.includes("Cargo.toml")) languages.add("rust");
  if (files.includes("mix.exs")) languages.add("elixir");
  if (files.includes("Gemfile")) languages.add("ruby");
  if (files.includes("pom.xml") || files.includes("build.gradle"))
    languages.add("java");
  if (files.some((file) => file.endsWith(".sln"))) languages.add(".net");
  if (files.some((file) => file.startsWith("next.config")))
    frameworks.add("next.js");
  if (files.includes("playwright.config.ts")) {
    frameworks.add("playwright");
    tools.add("playwright");
  }
  if (files.includes("SECURITY.md")) roles.add("security");
  if (files.includes(".obsidian")) roles.add("obsidian-vault");
  return {
    root: absolute,
    languages: [...languages],
    frameworks: [...frameworks],
    roles: [...roles],
    tools: [...tools],
    files,
  };
}

export function recommendPackages(
  signals: ProjectSignals,
  catalog: CatalogPackage[],
): PackageRecommendation[] {
  const packages = new Map(catalog.map((pkg) => [pkg.id, pkg]));
  const result: PackageRecommendation[] = [];
  const add = (
    packageId: string,
    reason: string,
    confidence: PackageRecommendation["confidence"],
  ) => {
    const pkg = packages.get(packageId);
    if (pkg && !result.some((item) => item.packageId === packageId))
      result.push({
        packageId,
        reason,
        confidence,
        kind: pkg.components?.includes("skill")
          ? "skill-library"
          : pkg.components?.some(
                (component) => component === "mcp" || component === "plugin",
              )
            ? "mcp-runtime"
            : "unavailable",
      });
  };
  add(
    "superpowers",
    "Useful engineering planning, testing, and review workflows for most repositories.",
    "high",
  );
  add(
    "context7",
    "Current library documentation helps agents avoid outdated APIs.",
    signals.languages.length ? "high" : "medium",
  );
  if (
    signals.frameworks.some((item) =>
      ["react", "next.js", "vue", "svelte"].includes(item),
    )
  )
    add(
      "ui-ux-pro-max",
      `Frontend framework detected: ${signals.frameworks.join(", ")}.`,
      "high",
    );
  if (
    signals.frameworks.includes("playwright") ||
    signals.languages.includes("javascript/typescript")
  )
    add(
      "playwright-mcp",
      "Browser verification is useful for this web-capable project.",
      signals.frameworks.includes("playwright") ? "high" : "medium",
    );
  if (signals.files.includes(".git"))
    add(
      "github-mcp-server",
      "A Git repository was detected; GitHub tools may help with issues and pull requests.",
      "medium",
    );
  if (signals.roles.includes("obsidian-vault"))
    add(
      "obsidian-skills",
      "An Obsidian vault was detected; these reviewed skills cover its open Markdown, Bases, and JSON Canvas formats.",
      "high",
    );
  return result;
}

function confidenceRank(
  confidence: PackageRecommendation["confidence"],
): number {
  return { low: 0, medium: 1, high: 2 }[confidence];
}

function confidenceAt(rank: number): PackageRecommendation["confidence"] {
  return (["low", "medium", "high"] as const)[Math.max(0, Math.min(2, rank))];
}

/**
 * Personalize the explainable baseline with local outcomes only. A negative
 * outcome can lower or reorder a recommendation, but it cannot introduce an
 * unreviewed discovery candidate into the catalog.
 */
export function personalizeRecommendations(
  recommendations: PackageRecommendation[],
  signals: ProjectSignals,
  outcomes: LocalOutcomeStore,
  agent: AgentId,
): PackageRecommendation[] {
  const taskFamilies = projectTaskFamilies(signals);
  return recommendations
    .map((recommendation, originalIndex) => {
      const adjustment = packageOutcomeAdjustment(
        outcomes,
        recommendation.packageId,
        agent,
        taskFamilies,
      );
      const confidenceShift =
        adjustment.score >= 20 ? 1 : adjustment.score <= -20 ? -1 : 0;
      return {
        ...recommendation,
        confidence: confidenceAt(
          confidenceRank(recommendation.confidence) + confidenceShift,
        ),
        ...(adjustment.evidence.length
          ? {
              localOutcomeAdjustment: adjustment.score,
              evidence: adjustment.evidence,
              reason: `${recommendation.reason} Local outcomes adjusted confidence for ${agent}; they are not global quality evidence.`,
            }
          : {}),
        _order: originalIndex,
        _adjustment: adjustment.score,
      };
    })
    .sort(
      (left, right) =>
        right._adjustment - left._adjustment || left._order - right._order,
    )
    .map((item) => ({
      packageId: item.packageId,
      reason: item.reason,
      confidence: item.confidence,
      kind: item.kind,
      ...(item.localOutcomeAdjustment !== undefined
        ? { localOutcomeAdjustment: item.localOutcomeAdjustment }
        : {}),
      ...(item.evidence ? { evidence: item.evidence } : {}),
    }));
}

export const TESTED_PROFILES: Record<
  string,
  { description: string; packages: string[] }
> = {
  stable: {
    description:
      "30 active skills from four pinned sources: the bounded everyday starting point.",
    packages: [...STABLE_BOOST_PACKAGE_IDS],
  },
  power: {
    description:
      "A deliberately larger active toolkit selected from eight pinned skill collections; expect higher agent context use.",
    packages: Object.keys(POWER_SKILL_ALLOWLIST),
  },
  maximum: {
    description:
      "The broadest screened catalog: skills enter the disabled library and MCP/runtime integrations remain explicit.",
    packages: [],
  },
  custom: {
    description:
      "Only the package IDs you explicitly pass to setup or upgrade.",
    packages: [],
  },
};

export function profileManifestPackages(
  profile: string,
  catalog: CatalogPackage[],
): Array<{ id: string; repository: string }> {
  const selected = TESTED_PROFILES[profile];
  if (!selected)
    throw new Error(
      `Unknown profile '${profile}'. Choose: ${Object.keys(TESTED_PROFILES).join(", ")}`,
    );
  if (profile === "custom")
    throw new Error(
      "Custom profiles require explicit package IDs; use setup --mode custom --package <id>",
    );
  const byId = new Map(catalog.map((pkg) => [pkg.id, pkg]));
  const packageIds =
    profile === "maximum"
      ? catalog.filter((pkg) => !pkg.archived).map((pkg) => pkg.id)
      : selected.packages;
  return packageIds.map((id) => {
    const pkg = byId.get(id);
    if (!pkg)
      throw new Error(
        `Profile '${profile}' references missing catalog package '${id}'`,
      );
    return { id, repository: pkg.repository };
  });
}

export function formatRecommendations(
  signals: ProjectSignals,
  recommendations: PackageRecommendation[],
): string {
  const lines = [
    `Project: ${basename(signals.root)}`,
    `Detected: ${formatDetectedSignals(signals) || "no known project signals"}`,
    "",
    "Rule-based project suggestions:",
    "Rules use detected project signals and catalog membership; they do not prove package quality.",
  ];
  if (!recommendations.length)
    lines.push("  No matching catalog packages found.");
  const kindLabels: Record<PackageRecommendation["kind"], string> = {
    "skill-library": "skill library",
    "mcp-runtime": "MCP/runtime setup",
    unavailable: "unavailable",
  };
  for (const item of recommendations) {
    lines.push(
      `  ${item.packageId} [${item.confidence}, ${kindLabels[item.kind]}] — ${item.reason}`,
    );
    if (item.kind === "mcp-runtime")
      lines.push(
        "    Explicit setup only; preview credentials and permissions before enabling it.",
      );
  }
  return lines.join("\n");
}
