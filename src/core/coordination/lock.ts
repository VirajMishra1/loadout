import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const LOCK_FILE = "coordination.lock";
const DEFAULT_TIMEOUT_MS = 10_000;
const MALFORMED_LOCK_STALE_MS = 30_000;

interface LockOwner {
  token: string;
  pid: number;
  createdAt: string;
}

export class CoordinationLockTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Timed out waiting ${timeoutMs}ms for the coordination lock`);
    this.name = "CoordinationLockTimeoutError";
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

async function lockCanBeRecovered(path: string): Promise<boolean> {
  try {
    const raw = await readFile(path, "utf8");
    const owner = JSON.parse(raw) as Partial<LockOwner>;
    if (typeof owner.pid === "number" && typeof owner.token === "string") {
      return !processIsAlive(owner.pid);
    }
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
  }

  try {
    const info = await stat(path);
    return Date.now() - info.mtimeMs > MALFORMED_LOCK_STALE_MS;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
    return false;
  }
}

async function releaseOwnedLock(path: string, token: string): Promise<void> {
  try {
    const raw = await readFile(path, "utf8");
    const owner = JSON.parse(raw) as Partial<LockOwner>;
    if (owner.token === token) {
      await rm(path, { force: true });
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** Serialize coordination mutations across Node processes sharing a project. */
export async function withCoordinationLock<T>(
  coordinationDir: string,
  operation: () => Promise<T>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const path = join(coordinationDir, LOCK_FILE);
  const deadline = Date.now() + timeoutMs;
  const token = randomUUID();
  const owner: LockOwner = {
    token,
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };
  let attempt = 0;

  while (true) {
    try {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(owner), "utf8");
      } finally {
        await handle.close();
      }
      // Verify we still own the lock — another recovery could have renamed
      // our lock file away between open and write in a tight race.
      const verification = await readFile(path, "utf8").catch(() => null);
      if (verification !== null) {
        try {
          const parsed = JSON.parse(verification) as Partial<LockOwner>;
          if (parsed.token === token) break;
        } catch {
          // Corrupted lock file — retry
        }
      }
      // Someone else owns the lock now — retry
      continue;
    } catch (error) {
      const code = errorCode(error);
      // EEXIST: lock file exists. EPERM: Windows holds the handle during
      // another process's rename recovery — treat as transient contention.
      if (code !== "EEXIST" && code !== "EPERM") throw error;

      if (await lockCanBeRecovered(path)) {
        // Atomic recovery: rename claims the stale file; only one recoverer
        // can win the rename since the source is a single path.
        const recoveryPath = `${path}.${token}.recovery`;
        try {
          await rename(path, recoveryPath);
          await rm(recoveryPath, { force: true });
        } catch (error) {
          const rc = errorCode(error);
          // ENOENT: another recoverer already renamed it away.
          // EPERM: Windows file-handle contention during rename.
          if (rc !== "ENOENT" && rc !== "EPERM") throw error;
        }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new CoordinationLockTimeoutError(timeoutMs);
      }

      const backoff = Math.min(5 * 2 ** attempt, 100);
      attempt += 1;
      await wait(backoff + Math.floor(Math.random() * 10));
    }
  }

  try {
    return await operation();
  } finally {
    await releaseOwnedLock(path, token);
  }
}
