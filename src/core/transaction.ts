import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Snapshot } from "../shared/types.js";
import { ensureDirectory, loadoutHome } from "./paths.js";
import { createSnapshot, readSnapshot, restoreSnapshot } from "./snapshot.js";
import {
  acquireFileLock,
  withFileLock,
  type FileLockHandle,
} from "./file-lock.js";

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
  mutationLock: FileLockHandle;
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
const transactionPreparingRoot = (): string =>
  join(loadoutHome(), "staging-preparing");
export const mutationLockPath = (): string =>
  join(loadoutHome(), "mutation.lock");
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
  options: { mutationLock?: FileLockHandle } = {},
): Promise<TransactionHandle> {
  const mutationLock = options.mutationLock ?? (await acquireMutationLock());
  const root = transactionRoot();
  const preparingRoot = transactionPreparingRoot();
  let preparingDirectory: string | undefined;
  try {
    // Callers build a preview snapshot before this boundary. Refresh it while
    // holding the global mutation lock so a concurrent completed mutation can
    // never be rolled back by stale pre-lock bytes.
    const freshSnapshot = await createSnapshot(targets);
    Object.assign(snapshot, freshSnapshot);
    await Promise.all([ensureDirectory(root), ensureDirectory(preparingRoot)]);
    const directory = join(root, snapshot.id);
    preparingDirectory = join(preparingRoot, `${snapshot.id}-${randomUUID()}`);
    await mkdir(preparingDirectory, { recursive: false });
    const handle = {
      id: snapshot.id,
      directory,
      snapshotId: snapshot.id,
      mutationLock,
    };
    await writeJournal(preparingDirectory, {
      version: 1,
      id: handle.id,
      snapshotId: handle.snapshotId,
      targets: [...new Set(targets)],
      createdAt: new Date().toISOString(),
      status: "prepared",
    });
    await rename(preparingDirectory, directory);
    preparingDirectory = undefined;
    return handle;
  } catch (error) {
    if (preparingDirectory)
      await rm(preparingDirectory, { recursive: true, force: true });
    await mutationLock.release();
    throw error;
  }
}

/** Acquire the global mutation boundary and recover abandoned work before use. */
export async function acquireMutationLock(): Promise<FileLockHandle> {
  const mutationLock = await acquireFileLock(mutationLockPath(), {
    timeoutMs: 30_000,
  });
  try {
    // No live transaction can be preparing while this lock is held. Any
    // unpublished directory is crash debris and was never visible to recovery.
    await rm(transactionPreparingRoot(), { recursive: true, force: true });
    // Recovery and the next mutation share one acquisition. Otherwise a
    // process could die between a caller's recovery pass and its state checks.
    await recoverPendingTransactionsUnlocked();
    return mutationLock;
  } catch (error) {
    await mutationLock.release();
    throw error;
  }
}

/** Serialize a direct mutation or restore that does not need a new journal. */
export async function withMutationLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const mutationLock = await acquireMutationLock();
  try {
    return await operation();
  } finally {
    await mutationLock.release();
  }
}

/**
 * Prepare from current state, snapshot, journal, mutate, and commit under one
 * global lock. Network/source preparation should happen before this boundary;
 * every state-dependent precondition belongs in `prepare`.
 */
export async function runMutationTransaction<Prepared, Result>(
  prepare: () => Promise<{ targets: string[]; value: Prepared }>,
  mutate: (value: Prepared, snapshot: Snapshot) => Promise<Result>,
): Promise<{ snapshotId: string; result: Result }> {
  const mutationLock = await acquireMutationLock();
  let transaction: TransactionHandle | undefined;
  try {
    const prepared = await prepare();
    const snapshot = await createSnapshot(prepared.targets, {
      persist: false,
    });
    transaction = await beginTransaction(snapshot, prepared.targets, {
      mutationLock,
    });
    await markTransactionCommitting(transaction);
    const result = await mutate(prepared.value, snapshot);
    await completeTransaction(transaction);
    return { snapshotId: snapshot.id, result };
  } catch (error) {
    if (transaction) await rollbackTransaction(transaction);
    else await mutationLock.release();
    throw error;
  }
}

export async function markTransactionCommitting(
  handle: TransactionHandle,
): Promise<void> {
  const journal = await readJournal(handle.directory);
  await writeJournal(handle.directory, { ...journal, status: "committing" });
}

export async function completeTransaction(
  handle: TransactionHandle,
  options: { releaseLock?: boolean } = {},
): Promise<void> {
  try {
    await rm(handle.directory, { recursive: true, force: true });
  } finally {
    if (options.releaseLock !== false) await handle.mutationLock.release();
  }
}

export async function rollbackTransaction(
  handle: TransactionHandle,
): Promise<void> {
  try {
    await restoreSnapshot(await readSnapshot(handle.snapshotId));
  } catch (error) {
    // Preserve the journal for a later recovery attempt, but never strand the
    // process-global mutation lock when restoration itself fails.
    await handle.mutationLock.release();
    throw error;
  }
  await completeTransaction(handle);
}

/**
 * Restore every complete, readable pending transaction. Corrupt journals are
 * deliberately preserved for inspection and reported instead of guessing at
 * paths to delete or restore.
 */
export async function recoverPendingTransactions(): Promise<string[]> {
  return withFileLock(mutationLockPath(), recoverPendingTransactionsUnlocked, {
    timeoutMs: 30_000,
  });
}

async function recoverPendingTransactionsUnlocked(): Promise<string[]> {
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
