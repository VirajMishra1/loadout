export const MODEL_API_PROVIDERS = [
  "openai",
  "anthropic",
  "openrouter",
  "other",
] as const;

export type ModelApiProvider = (typeof MODEL_API_PROVIDERS)[number];

/**
 * A non-secret, per-run declaration. This never proves that a credential is
 * valid or funded, and it is deliberately not persisted by setup.
 */
export interface SetupAccessProfile {
  modelApis: ModelApiProvider[];
}

export function parseModelApiAccess(input?: string): SetupAccessProfile {
  if (!input || input.trim().toLowerCase() === "none") return { modelApis: [] };
  const values = [
    ...new Set(
      input
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (values.includes("none"))
    throw new Error("--api-access 'none' cannot be combined with providers");
  const supported = new Set<string>(MODEL_API_PROVIDERS);
  const unknown = values.filter((value) => !supported.has(value));
  if (unknown.length)
    throw new Error(
      `Unknown API provider selection. Supported values: none, ${MODEL_API_PROVIDERS.join(", ")}. Pass provider names only, never a key.`,
    );
  return { modelApis: values as ModelApiProvider[] };
}

export function interactiveModelApiAccess(answer: string): SetupAccessProfile {
  const value = answer.trim().toLowerCase();
  if (value === "1" || value === "openai") return { modelApis: ["openai"] };
  if (value === "2" || value === "anthropic")
    return { modelApis: ["anthropic"] };
  if (value === "3" || value === "both")
    return { modelApis: ["openai", "anthropic"] };
  if (value === "4" || value === "openrouter")
    return { modelApis: ["openrouter"] };
  if (value === "5" || value === "other") return { modelApis: ["other"] };
  return { modelApis: [] };
}

export function formatModelApiAccess(profile: SetupAccessProfile): string {
  return profile.modelApis.length
    ? profile.modelApis.join(", ")
    : "none declared";
}
