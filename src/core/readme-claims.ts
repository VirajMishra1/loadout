import {
  formatSchemaError,
  readmeClaimManifestSchema,
} from "../shared/schemas.js";
import type { ReadmeClaimManifest } from "../shared/types.js";

export { readmeClaimManifestSchema };
export type { ReadmeClaim, ReadmeClaimManifest } from "../shared/types.js";

/** Parse the versioned index of evidence for material README statements. */
export function parseReadmeClaimManifest(value: unknown): ReadmeClaimManifest {
  const result = readmeClaimManifestSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `README claim manifest is invalid: ${formatSchemaError(result.error)}`,
    );
  }
  return result.data;
}
