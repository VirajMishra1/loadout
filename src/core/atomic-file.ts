import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Replace one file using a temporary sibling and rename. Keeping the temporary
 * file in the destination directory makes the replacement a single filesystem
 * operation on supported local filesystems, instead of exposing a truncated
 * JSON file while it is being written.
 */
export async function writeFileAtomically(path: string, content: string | Uint8Array, mode = 0o600): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${basename(path)}.loadout-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { mode });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
