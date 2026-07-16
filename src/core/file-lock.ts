import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  utimes,
} from "node:fs/promises";
import { dirname } from "node:path";
import { ensureDirectory } from "./paths.js";

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

interface LockOwner {
  token: string;
  pid: number;
  acquiredAt: string;
}

export interface FileLockHandle {
  path: string;
  token: string;
  release(): Promise<void>;
}

function parseOwner(content: string): LockOwner | undefined {
  try {
    const value = JSON.parse(content) as Partial<LockOwner>;
    if (
      typeof value.token === "string" &&
      typeof value.pid === "number" &&
      Number.isInteger(value.pid) &&
      value.pid > 0 &&
      typeof value.acquiredAt === "string"
    )
      return value as LockOwner;
  } catch {
    /* an incomplete owner file is handled only after it becomes stale */
  }
  return undefined;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ESRCH"
    );
  }
}

async function reclaimIfAbandoned(
  path: string,
  staleMs: number,
  maximumLeaseMs: number,
): Promise<void> {
  const reclaim = `${path}.reclaim`;
  try {
    await mkdir(reclaim);
  } catch {
    return;
  }
  try {
    let info;
    let owner: LockOwner | undefined;
    try {
      [info, owner] = await Promise.all([
        stat(path),
        readFile(path, "utf8").then(parseOwner),
      ]);
    } catch {
      return;
    }
    const heartbeatAge = Date.now() - info.mtimeMs;
    // PID liveness protects a delayed event loop or short machine sleep. The
    // hard ceiling prevents a reused PID from owning an orphan forever;
    // healthy owners refresh mtime and never approach this ceiling.
    if (owner && processIsAlive(owner.pid) && heartbeatAge <= maximumLeaseMs)
      return;
    if (!owner && heartbeatAge <= staleMs) return;
    const quarantine = `${path}.abandoned-${randomUUID()}`;
    try {
      await rename(path, quarantine);
      await rm(quarantine, { force: true });
    } catch {
      /* another contender changed the lock; retry through normal acquisition */
    }
  } finally {
    await rm(reclaim, { recursive: true, force: true });
  }
}

/** Acquire a token-owned, heartbeating cross-process lock. */
export async function acquireFileLock(
  path: string,
  options: {
    timeoutMs?: number;
    staleMs?: number;
    maximumLeaseMs?: number;
  } = {},
): Promise<FileLockHandle> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const staleMs = options.staleMs ?? 60_000;
  const maximumLeaseMs =
    options.maximumLeaseMs ?? Math.max(24 * 60 * 60 * 1_000, staleMs * 10);
  const started = Date.now();
  await ensureDirectory(dirname(path));
  while (true) {
    const token = randomUUID();
    try {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(
          `${JSON.stringify({ token, pid: process.pid, acquiredAt: new Date().toISOString() })}\n`,
        );
      } catch (error) {
        await handle.close().catch(() => undefined);
        await rm(path, { force: true }).catch(() => undefined);
        throw error;
      }
      await handle.close();
      const heartbeat = setInterval(
        () => {
          const now = new Date();
          void utimes(path, now, now).catch(() => undefined);
        },
        Math.max(1_000, Math.floor(staleMs / 3)),
      );
      heartbeat.unref();
      let released = false;
      return {
        path,
        token,
        async release() {
          if (released) return;
          released = true;
          clearInterval(heartbeat);
          try {
            const owner = parseOwner(await readFile(path, "utf8"));
            if (owner?.token === token) await rm(path, { force: true });
          } catch {
            /* ownership changed or the lock was already removed */
          }
        },
      };
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        (error as { code?: string }).code !== "EEXIST"
      )
        throw error;
    }
    await reclaimIfAbandoned(path, staleMs, maximumLeaseMs);
    if (Date.now() - started >= timeoutMs)
      throw new Error(`Timed out waiting for Loadout state lock: ${path}`);
    await wait(50);
  }
}

export async function withFileLock<T>(
  path: string,
  operation: () => Promise<T>,
  options: {
    timeoutMs?: number;
    staleMs?: number;
    maximumLeaseMs?: number;
  } = {},
): Promise<T> {
  const lock = await acquireFileLock(path, options);
  try {
    return await operation();
  } finally {
    await lock.release();
  }
}
