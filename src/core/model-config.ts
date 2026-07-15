import { z } from "zod";
import {
  formatSchemaError,
  providerModelConfigurationSchema,
} from "../shared/schemas.js";
import type { ProviderModelConfiguration } from "../shared/types.js";

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
