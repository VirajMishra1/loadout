/**
 * Crash recovery for the coordination daemon.
 *
 * - PID file management for singleton daemon
 * - Stale PID detection and cleanup
 * - State persistence and recovery
 * - Kill switch: immediately halt all coordination
 */

import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";

const COORD_DIR = ".handoff";
const PID_FILE = "daemon.pid";
const KILL_SWITCH_FILE = "KILL_SWITCH";

export interface PidInfo {
  pid: number;
  port: number;
  startedAt: string;
  projectRoot: string;
}

/**
 * Write the daemon PID file.
 */
export async function writePidFile(
  projectRoot: string,
  port: number,
): Promise<void> {
  const dir = join(projectRoot, COORD_DIR);
  await mkdir(dir, { recursive: true });

  const info: PidInfo = {
    pid: process.pid,
    port,
    startedAt: new Date().toISOString(),
    projectRoot,
  };

  await writeFile(
    join(dir, PID_FILE),
    JSON.stringify(info, null, 2) + "\n",
    "utf-8",
  );
}

/**
 * Read the daemon PID file.
 */
export async function readPidFile(
  projectRoot: string,
): Promise<PidInfo | null> {
  try {
    const raw = await readFile(join(projectRoot, COORD_DIR, PID_FILE), "utf-8");
    return JSON.parse(raw) as PidInfo;
  } catch {
    return null;
  }
}

/**
 * Remove the daemon PID file.
 */
export async function removePidFile(projectRoot: string): Promise<void> {
  try {
    await unlink(join(projectRoot, COORD_DIR, PID_FILE));
  } catch {
    // Already removed
  }
}

/**
 * Check if a daemon process is still running.
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a daemon is running for this project.
 * If the PID file exists but the process is dead, clean up.
 */
export async function getDaemonStatus(
  projectRoot: string,
): Promise<{ running: boolean; info: PidInfo | null; stale: boolean }> {
  const info = await readPidFile(projectRoot);

  if (!info) {
    return { running: false, info: null, stale: false };
  }

  if (isProcessRunning(info.pid)) {
    return { running: true, info, stale: false };
  }

  // Stale PID file — process died without cleanup
  await removePidFile(projectRoot);
  return { running: false, info, stale: true };
}

/**
 * Stop a running daemon by sending SIGTERM.
 */
export async function stopDaemon(
  projectRoot: string,
): Promise<{ stopped: boolean; pid?: number; stale?: boolean }> {
  const status = await getDaemonStatus(projectRoot);

  if (!status.running) {
    if (status.stale) {
      return { stopped: false, pid: status.info!.pid, stale: true };
    }
    return { stopped: false };
  }

  try {
    process.kill(status.info!.pid, "SIGTERM");
    await removePidFile(projectRoot);
    return { stopped: true, pid: status.info!.pid };
  } catch {
    return { stopped: false, pid: status.info!.pid };
  }
}

// ---------------------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------------------

/**
 * Activate the kill switch — immediately halts all coordination.
 *
 * Creates a KILL_SWITCH file that the daemon, watcher, and adapters
 * check before any operation. While active:
 * - Daemon refuses new events
 * - Watcher stops broadcasting
 * - Adapters refuse to inject
 * - CLI commands print a warning
 */
export async function activateKillSwitch(
  projectRoot: string,
  reason: string,
): Promise<void> {
  const dir = join(projectRoot, COORD_DIR);
  await mkdir(dir, { recursive: true });

  const data = {
    activatedAt: new Date().toISOString(),
    activatedBy: "user",
    reason,
  };

  await writeFile(
    join(dir, KILL_SWITCH_FILE),
    JSON.stringify(data, null, 2) + "\n",
    "utf-8",
  );

  // Also stop the daemon if running
  await stopDaemon(projectRoot);
}

/**
 * Deactivate the kill switch — resume coordination.
 */
export async function deactivateKillSwitch(
  projectRoot: string,
): Promise<boolean> {
  try {
    await unlink(join(projectRoot, COORD_DIR, KILL_SWITCH_FILE));
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the kill switch is active.
 */
export async function isKillSwitchActive(
  projectRoot: string,
): Promise<{ active: boolean; reason?: string; activatedAt?: string }> {
  try {
    const raw = await readFile(
      join(projectRoot, COORD_DIR, KILL_SWITCH_FILE),
      "utf-8",
    );
    const data = JSON.parse(raw) as {
      reason: string;
      activatedAt: string;
    };
    return { active: true, reason: data.reason, activatedAt: data.activatedAt };
  } catch {
    return { active: false };
  }
}
