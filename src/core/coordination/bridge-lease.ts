import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

const COORD_DIR = ".handoff";
const BRIDGE_LOCK = "bridge.lock";

interface BridgeOwner {
  pid: number;
  token: string;
  startedAt: string;
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

export class BridgeAlreadyRunningError extends Error {
  constructor(pid?: number) {
    super(
      `A coordination provider bridge is already running${pid ? ` (pid ${pid})` : ""}`,
    );
    this.name = "BridgeAlreadyRunningError";
  }
}

export interface BridgeLease {
  release(): Promise<void>;
}

/** Hold a project-local singleton lease for the lifetime of a provider bridge. */
export async function acquireBridgeLease(
  projectRoot: string,
): Promise<BridgeLease> {
  const dir = join(projectRoot, COORD_DIR);
  const path = join(dir, BRIDGE_LOCK);
  await mkdir(dir, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const owner: BridgeOwner = {
      pid: process.pid,
      token: randomUUID(),
      startedAt: new Date().toISOString(),
    };
    try {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(owner), "utf8");
      } finally {
        await handle.close();
      }
      return {
        async release() {
          try {
            const current = JSON.parse(
              await readFile(path, "utf8"),
            ) as Partial<BridgeOwner>;
            if (current.token === owner.token) await rm(path, { force: true });
          } catch (error) {
            if (errorCode(error) !== "ENOENT") throw error;
          }
        },
      };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      let existing: Partial<BridgeOwner> = {};
      try {
        existing = JSON.parse(
          await readFile(path, "utf8"),
        ) as Partial<BridgeOwner>;
      } catch {
        throw new BridgeAlreadyRunningError();
      }
      if (typeof existing.pid === "number" && !processIsAlive(existing.pid)) {
        await rm(path, { force: true });
        continue;
      }
      throw new BridgeAlreadyRunningError(existing.pid);
    }
  }

  throw new BridgeAlreadyRunningError();
}
