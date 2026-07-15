import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { Snapshot } from "../shared/types.js";
import { ensureDirectory, loadoutHome } from "./paths.js";
import { readSnapshot, restoreSnapshot } from "./snapshot.js";

/**
 * A small durable journal around filesystem mutations.  A directory rename is
 * atomic only for one filesystem entry; an install can touch many entries.
 * The journal lets the next Loadout invocation restore the pre-transaction
 * snapshot if a process dies between those individual commits.
 */
export interface TransactionHandle {
  id: string;
  directory: string;
  snapshotId: string;
}

interface TransactionJournal {
  version: 1;
  id: string;
  snapshotId: string;
  targets: string[];
  createdAt: string;
  status: "prepared" | "committing";
}

export const transactionRoot = (): string => join(loadoutHome(), "staging");
const journalPath = (directory: string): string =>
  join(directory, "transaction.json");
const validId = (id: string): boolean => /^\d+-[a-f0-9]{12}$/.test(id);

async function writeJournal(
  directory: string,
  journal: TransactionJournal,
): Promise<void> {
  const path = journalPath(directory);
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, path);
}

function parseJournal(value: unknown, directory: string): TransactionJournal {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Corrupt Loadout transaction journal in ${directory}`);
  const journal = value as Partial<TransactionJournal>;
  if (
    journal.version !== 1 ||
    typeof journal.id !== "string" ||
    !validId(journal.id) ||
    typeof journal.snapshotId !== "string" ||
    !validId(journal.snapshotId) ||
    !Array.isArray(journal.targets) ||
    !journal.targets.every((target) => typeof target === "string") ||
    typeof journal.createdAt !== "string" ||
    (journal.status !== "prepared" && journal.status !== "committing")
  ) {
    throw new Error(`Corrupt Loadout transaction journal in ${directory}`);
  }
  if (journal.id !== directory.split(/[\\/]/).at(-1))
    throw new Error(`Corrupt Loadout transaction journal in ${directory}`);
  return journal as TransactionJournal;
}

async function readJournal(directory: string): Promise<TransactionJournal> {
  try {
    return parseJournal(
      JSON.parse(await readFile(journalPath(directory), "utf8")),
      directory,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Corrupt Loadout transaction journal")
    )
      throw error;
    throw new Error(`Corrupt Loadout transaction journal in ${directory}`);
  }
}

export async function beginTransaction(
  snapshot: Snapshot,
  targets: string[],
): Promise<TransactionHandle> {
  const root = transactionRoot();
  await ensureDirectory(root);
  const directory = join(root, snapshot.id);
  await mkdir(directory, { recursive: false });
  const handle = { id: snapshot.id, directory, snapshotId: snapshot.id };
  await writeJournal(directory, {
    version: 1,
    id: handle.id,
    snapshotId: handle.snapshotId,
    targets: [...new Set(targets)],
    createdAt: new Date().toISOString(),
    status: "prepared",
  });
  return handle;
}

export async function markTransactionCommitting(
  handle: TransactionHandle,
): Promise<void> {
  const journal = await readJournal(handle.directory);
  await writeJournal(handle.directory, { ...journal, status: "committing" });
}

export async function completeTransaction(
  handle: TransactionHandle,
): Promise<void> {
  await rm(handle.directory, { recursive: true, force: true });
}

export async function rollbackTransaction(
  handle: TransactionHandle,
): Promise<void> {
  await restoreSnapshot(await readSnapshot(handle.snapshotId));
  await completeTransaction(handle);
}

/**
 * Restore every complete, readable pending transaction. Corrupt journals are
 * deliberately preserved for inspection and reported instead of guessing at
 * paths to delete or restore.
 */
export async function recoverPendingTransactions(): Promise<string[]> {
  const root = transactionRoot();
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    )
      return [];
    throw error;
  }
  const recovered: string[] = [];
  for (const entry of entries.sort()) {
    const directory = join(root, entry);
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(`Unsafe Loadout transaction staging entry: ${directory}`);
    const journal = await readJournal(directory);
    await restoreSnapshot(await readSnapshot(journal.snapshotId));
    await rm(directory, { recursive: true, force: true });
    recovered.push(journal.id);
  }
  return recovered;
}
