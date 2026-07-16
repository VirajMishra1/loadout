import { readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type {
  AgentId,
  CatalogPackage,
  PackageRecommendation,
  ProjectSignals,
} from "../shared/types.js";
import { STABLE_BOOST_PACKAGE_IDS } from "./profiles.js";
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
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "next.config.js",
  "next.config.mjs",
  "vite.config.ts",
  "playwright.config.ts",
  ".git",
]);

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
  if (files.includes("package.json")) {
    languages.add("javascript/typescript");
    try {
      const pkg = JSON.parse(
        await readFile(resolve(absolute, "package.json"), "utf8"),
      ) as Record<string, Record<string, string>>;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next) frameworks.add("next.js");
      if (deps.react) frameworks.add("react");
      if (deps.vue) frameworks.add("vue");
      if (deps.svelte) frameworks.add("svelte");
      if (deps.playwright || deps["@playwright/test"])
        frameworks.add("playwright");
    } catch {
      /* malformed project metadata is reported through an empty framework set */
    }
  }
  if (files.includes("pyproject.toml") || files.includes("requirements.txt"))
    languages.add("python");
  if (files.includes("go.mod")) languages.add("go");
  if (files.includes("Cargo.toml")) languages.add("rust");
  if (files.includes("Gemfile")) languages.add("ruby");
  if (files.includes("pom.xml") || files.includes("build.gradle"))
    languages.add("java");
  if (files.some((file) => file.endsWith(".sln"))) languages.add(".net");
  if (files.some((file) => file.startsWith("next.config")))
    frameworks.add("next.js");
  if (files.includes("playwright.config.ts")) frameworks.add("playwright");
  return {
    root: absolute,
    languages: [...languages],
    frameworks: [...frameworks],
    files,
  };
}

export function recommendPackages(
  signals: ProjectSignals,
  catalog: CatalogPackage[],
): PackageRecommendation[] {
  const ids = new Set(catalog.map((pkg) => pkg.id));
  const result: PackageRecommendation[] = [];
  const add = (
    packageId: string,
    reason: string,
    confidence: PackageRecommendation["confidence"],
  ) => {
    if (
      ids.has(packageId) &&
      !result.some((item) => item.packageId === packageId)
    )
      result.push({ packageId, reason, confidence });
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
      "Recommended 17-skill daily driver from four pinned, SPDX-identified sources with no extra static-risk approvals.",
    packages: [...STABLE_BOOST_PACKAGE_IDS],
  },
  web: {
    description:
      "Planning, documentation, interface guidance, and browser verification for web projects.",
    packages: ["superpowers", "context7", "ui-ux-pro-max", "playwright-mcp"],
  },
  collaboration: {
    description: "Engineering workflow plus GitHub collaboration tools.",
    packages: ["superpowers", "context7", "github-mcp-server"],
  },
  maximum: {
    description:
      "Broad reviewed toolkit; always review MCP permissions before applying.",
    packages: [
      "superpowers",
      "context7",
      "playwright-mcp",
      "ui-ux-pro-max",
      "github-mcp-server",
    ],
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
  const byId = new Map(catalog.map((pkg) => [pkg.id, pkg]));
  return selected.packages.map((id) => {
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
    `Detected: ${[...signals.languages, ...signals.frameworks].join(", ") || "no known project signals"}`,
    "",
    "Recommendations:",
  ];
  if (!recommendations.length)
    lines.push("  No matching catalog packages found.");
  for (const item of recommendations)
    lines.push(`  ${item.packageId} [${item.confidence}] — ${item.reason}`);
  return lines.join("\n");
}
