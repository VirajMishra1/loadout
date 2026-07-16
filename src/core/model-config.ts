import { z } from "zod";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  formatSchemaError,
  providerModelConfigurationSchema,
} from "../shared/schemas.js";
import type {
  ProviderModelConfiguration,
  ProviderModelSelection,
} from "../shared/types.js";
import { writeFileAtomically } from "./atomic-file.js";
import { ensureDirectory, loadoutHome } from "./paths.js";
import { runMutationTransaction } from "./transaction.js";

export const defaultModelConfigurationPath = (): string =>
  join(loadoutHome(), "models.json");

export interface ModelConfigurationPlan {
  path: string;
  selection: ProviderModelSelection;
  configuration: ProviderModelConfiguration;
  replacing: boolean;
}

export interface ProviderRequest {
  endpoint: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}

export type CredentialResolver = (
  reference: NonNullable<
    ProviderModelConfiguration["selections"][number]["credential"]
  >,
) => Promise<string | undefined>;

/**
 * Validate a portable, provider-neutral model configuration. This is not a
 * provider adapter: it never reads environment variables, queries a keychain,
 * sends a request, or writes an agent configuration file.
 */
export function parseProviderModelConfiguration(
  value: unknown,
): ProviderModelConfiguration {
  try {
    return providerModelConfigurationSchema.parse(
      value,
    ) as ProviderModelConfiguration;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Model configuration is invalid: ${formatSchemaError(error)}`,
      );
    }
    throw error;
  }
}

export async function readProviderModelConfiguration(
  path = defaultModelConfigurationPath(),
): Promise<ProviderModelConfiguration | undefined> {
  try {
    return parseProviderModelConfiguration(
      JSON.parse(await readFile(path, "utf8")),
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    )
      return undefined;
    throw error;
  }
}

export async function planProviderModelSelection(
  selection: ProviderModelSelection,
  path = defaultModelConfigurationPath(),
): Promise<ModelConfigurationPlan> {
  const current = await readProviderModelConfiguration(path);
  const replacing = Boolean(
    current?.selections.some((item) => item.id === selection.id),
  );
  const configuration = parseProviderModelConfiguration({
    schemaVersion: 1,
    selections: [
      ...(current?.selections.filter((item) => item.id !== selection.id) ?? []),
      selection,
    ],
  });
  return { path, selection, configuration, replacing };
}

export async function applyProviderModelSelection(
  plan: ModelConfigurationPlan,
): Promise<string> {
  const applied = await runMutationTransaction(
    async () => {
      const fresh = await planProviderModelSelection(plan.selection, plan.path);
      if (
        JSON.stringify(fresh.configuration) !==
        JSON.stringify(plan.configuration)
      )
        throw new Error(
          "Model configuration changed after preview; prepare the plan again.",
        );
      return { targets: [plan.path], value: fresh.configuration };
    },
    async (configuration) => {
      await ensureDirectory(dirname(plan.path));
      await writeFileAtomically(
        plan.path,
        `${JSON.stringify(configuration, null, 2)}\n`,
      );
    },
  );
  return applied.snapshotId;
}

export function formatProviderModelConfiguration(
  configuration: ProviderModelConfiguration | undefined,
): string {
  if (!configuration) return "No provider model selections are configured.";
  return [
    `Model selections: ${configuration.selections.length}`,
    ...configuration.selections.map(
      (selection) =>
        `${selection.id} — ${selection.provider}/${selection.model} — credential:${
          selection.credential
            ? selection.credential.kind === "environment"
              ? `environment:${selection.credential.name}`
              : `os-keychain:${selection.credential.service}`
            : "missing"
        } — agents:${selection.targetAgents?.join(",") ?? "any"}`,
    ),
  ].join("\n");
}

/**
 * OpenRouter adapter. Credentials are resolved just-in-time by the caller and
 * exist only in the outbound request; this module never persists or logs them.
 */
export async function requestOpenRouter(
  configuration: ProviderModelConfiguration,
  selectionId: string,
  messages: ProviderRequest["messages"],
  options: {
    resolveCredential: CredentialResolver;
    fetcher?: typeof fetch;
  },
): Promise<unknown> {
  const selection = configuration.selections.find(
    (item) => item.id === selectionId,
  );
  if (!selection) throw new Error(`Unknown model selection '${selectionId}'`);
  if (selection.provider !== "openrouter")
    throw new Error(
      `Provider '${selection.provider}' has no adapter in this build`,
    );
  if (!selection.credential)
    throw new Error("OpenRouter selection requires a credential reference");
  const token = await options.resolveCredential(selection.credential);
  if (!token)
    throw new Error("OpenRouter credential reference did not resolve");
  const response = await (options.fetcher ?? fetch)(
    `${selection.endpoint.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ model: selection.model, messages }),
    },
  );
  if (!response.ok)
    throw new Error(`OpenRouter request failed (${response.status})`);
  return response.json();
}
