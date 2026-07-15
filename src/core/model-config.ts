import { z } from "zod";
import {
  formatSchemaError,
  providerModelConfigurationSchema,
} from "../shared/schemas.js";
import type { ProviderModelConfiguration } from "../shared/types.js";

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
