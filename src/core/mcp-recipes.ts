import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { McpConfigPlan, McpServer } from "../shared/types.js";
import { planMcpConfig } from "./mcp.js";

export interface McpSetupRecipe {
  id: string;
  displayName: string;
  source: string;
  serverName: string;
  command: string;
  args: string[];
  /** Names only. Values remain outside Loadout and are represented as references. */
  environment: string[];
  permissions: string[];
  connection: "stdio";
}

export interface McpRecipePlan {
  recipe: McpSetupRecipe;
  config: McpConfigPlan;
  authorization: string[];
  safety: string[];
}

export interface McpRecipeVerification {
  recipeId: string;
  configPath: string;
  configured: boolean;
  checks: string[];
  warnings: string[];
}

/**
 * Small, source-linked recipes. These configure a connection only; authorizing
 * a service remains an explicit user action outside Loadout.
 */
export const REVIEWED_MCP_RECIPES: McpSetupRecipe[] = [
  {
    id: "playwright",
    displayName: "Playwright MCP",
    source: "https://github.com/microsoft/playwright-mcp",
    serverName: "playwright",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    environment: [],
    permissions: [
      "browser automation",
      "local browser profile as configured by the user",
    ],
    connection: "stdio",
  },
  {
    id: "github-readonly",
    displayName: "GitHub MCP Server (read-only)",
    source: "https://github.com/github/github-mcp-server",
    serverName: "github",
    command: "docker",
    args: [
      "run",
      "-i",
      "--rm",
      "-e",
      "GITHUB_PERSONAL_ACCESS_TOKEN",
      "-e",
      "GITHUB_READ_ONLY=1",
      "ghcr.io/github/github-mcp-server",
    ],
    environment: ["GITHUB_PERSONAL_ACCESS_TOKEN", "GITHUB_READ_ONLY"],
    permissions: ["read GitHub repositories, issues, pull requests, and users"],
    connection: "stdio",
  },
];

export function findMcpRecipe(id: string): McpSetupRecipe {
  const recipe = REVIEWED_MCP_RECIPES.find((item) => item.id === id);
  if (!recipe) {
    throw new Error(
      `Unknown MCP recipe '${id}'. Available: ${REVIEWED_MCP_RECIPES.map((item) => item.id).join(", ")}`,
    );
  }
  return recipe;
}

function recipeServer(recipe: McpSetupRecipe, sourcePath: string): McpServer {
  return {
    name: recipe.serverName,
    command: recipe.command,
    args: recipe.args,
    // References retain variable names without storing or printing their values.
    env: Object.fromEntries(
      recipe.environment.map((name) => [name, `\${${name}}`]),
    ),
    sourcePath,
    warnings: [],
  };
}

export async function planMcpRecipe(
  recipeId: string,
  configPath: string,
): Promise<McpRecipePlan> {
  const recipe = findMcpRecipe(recipeId);
  const config = await planMcpConfig(
    configPath,
    recipeServer(recipe, recipe.source),
  );
  return {
    recipe,
    config,
    authorization: recipe.environment.length
      ? [
          `Set these environment variables outside Loadout before starting the host: ${recipe.environment.join(", ")}.`,
        ]
      : ["No credential reference is required by this recipe."],
    safety: [
      "Only the displayed server entry will be added or replaced; unrelated JSON keys are preserved.",
      "Loadout does not start the server, fetch packages, or authorize the service during recipe setup.",
    ],
  };
}

/** Verify the configured transport and references without launching a server. */
export async function verifyMcpRecipe(
  recipeId: string,
  configPath: string,
): Promise<McpRecipeVerification> {
  const recipe = findMcpRecipe(recipeId);
  const path = resolve(configPath);
  const checks: string[] = [];
  const warnings: string[] = [];
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    return {
      recipeId,
      configPath: path,
      configured: false,
      checks,
      warnings: [
        `Cannot read JSON MCP config: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  const server =
    value && typeof value === "object"
      ? (value as { mcpServers?: Record<string, unknown> }).mcpServers?.[
          recipe.serverName
        ]
      : undefined;
  if (!server || typeof server !== "object" || Array.isArray(server)) {
    warnings.push(`Server '${recipe.serverName}' is not configured.`);
  } else {
    const record = server as Record<string, unknown>;
    if (record.command === recipe.command)
      checks.push("command matches recipe");
    else warnings.push("configured command does not match recipe");
    if (
      Array.isArray(record.args) &&
      JSON.stringify(record.args) === JSON.stringify(recipe.args)
    )
      checks.push("arguments match recipe");
    else warnings.push("configured arguments do not match recipe");
    const env = record.env as Record<string, unknown> | undefined;
    for (const name of recipe.environment) {
      if (typeof env?.[name] === "string")
        checks.push(`environment reference present: ${name}`);
      else warnings.push(`missing environment reference: ${name}`);
    }
  }
  return {
    recipeId,
    configPath: path,
    configured: warnings.length === 0,
    checks,
    warnings: [
      ...warnings,
      "Configuration verification does not launch the MCP server. Start it from the target host after completing authorization.",
    ],
  };
}

export function formatMcpRecipePlan(plan: McpRecipePlan): string {
  return [
    `${plan.recipe.displayName} (${plan.recipe.id})`,
    `Source: ${plan.recipe.source}`,
    `Connection: ${plan.recipe.command} ${plan.recipe.args.join(" ")}`,
    `Permissions: ${plan.recipe.permissions.join("; ")}`,
    `Environment names: ${plan.recipe.environment.length ? plan.recipe.environment.join(", ") : "none"}`,
    `Target config: ${plan.config.path}`,
    ...plan.authorization,
    ...plan.safety,
  ].join("\n");
}
