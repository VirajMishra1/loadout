import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingHttpHeaders } from "node:http";

const COORD_DIR = ".handoff";
export const DAEMON_TOKEN_FILE = "daemon.token";
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

async function readToken(path: string): Promise<string> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("Daemon token path must be a regular file");
  }

  await chmod(path, 0o600);
  const token = (await readFile(path, "utf-8")).trim();
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error("Daemon token file is invalid");
  }
  return token;
}

export async function ensureDaemonToken(projectRoot: string): Promise<string> {
  const directory = join(projectRoot, COORD_DIR);
  const path = join(directory, DAEMON_TOKEN_FILE);
  await mkdir(directory, { recursive: true });

  try {
    const handle = await open(path, "wx", 0o600);
    const token = randomBytes(32).toString("hex");
    try {
      await handle.writeFile(`${token}\n`, "utf-8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return token;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    return readToken(path);
  }
}

export function hasValidBearerToken(
  headers: IncomingHttpHeaders,
  expectedToken: string,
): boolean {
  const authorization = headers.authorization;
  if (typeof authorization !== "string") return false;

  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) return false;

  const expected = Buffer.from(expectedToken, "utf-8");
  const candidate = Buffer.from(match[1]!, "utf-8");
  const sameLength = candidate.length === expected.length;
  const comparable = sameLength ? candidate : Buffer.alloc(expected.length);
  return timingSafeEqual(expected, comparable) && sameLength;
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}
