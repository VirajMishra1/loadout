import { randomUUID } from "node:crypto";
import { open, readFile, rm, stat } from "node:fs/promises";
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
      break;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;

      if (await lockCanBeRecovered(path)) {
        await rm(path, { force: true });
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
