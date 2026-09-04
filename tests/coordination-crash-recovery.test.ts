import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  writePidFile,
  readPidFile,
  removePidFile,
  isProcessRunning,
  getDaemonStatus,
  activateKillSwitch,
  deactivateKillSwitch,
  isKillSwitchActive,
} from "../src/core/coordination/crash-recovery.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loadout-crash-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("PID file management", () => {
  it("writes and reads PID file", async () => {
    await writePidFile(root, 4510);
    const info = await readPidFile(root);
    expect(info).not.toBeNull();
    expect(info!.pid).toBe(process.pid);
    expect(info!.port).toBe(4510);
    expect(info!.projectRoot).toBe(root);
  });

  it("removes PID file", async () => {
    await writePidFile(root, 4510);
    await removePidFile(root);
    const info = await readPidFile(root);
    expect(info).toBeNull();
  });

  it("returns null for missing PID file", async () => {
    const info = await readPidFile(root);
    expect(info).toBeNull();
  });
});

describe("isProcessRunning", () => {
  it("detects current process as running", () => {
    expect(isProcessRunning(process.pid)).toBe(true);
  });

  it("detects non-existent PID as not running", () => {
    // PID 99999999 almost certainly doesn't exist
    expect(isProcessRunning(99999999)).toBe(false);
  });
});

describe("getDaemonStatus", () => {
  it("reports no daemon when no PID file", async () => {
    const status = await getDaemonStatus(root);
    expect(status.running).toBe(false);
    expect(status.info).toBeNull();
    expect(status.stale).toBe(false);
  });

  it("reports running when PID matches current process", async () => {
    await writePidFile(root, 4510);
    const status = await getDaemonStatus(root);
    expect(status.running).toBe(true);
    expect(status.info!.pid).toBe(process.pid);
  });

  it("detects stale PID and cleans up", async () => {
    // Write a PID file with a non-existent PID
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(root, ".handoff"), { recursive: true });
    await writeFile(
      join(root, ".handoff", "daemon.pid"),
      JSON.stringify({
        pid: 99999999,
        port: 4510,
        startedAt: new Date().toISOString(),
        projectRoot: root,
      }),
    );

    const status = await getDaemonStatus(root);
    expect(status.running).toBe(false);
    expect(status.stale).toBe(true);
    expect(status.info!.pid).toBe(99999999);

    // PID file should be cleaned up
    const after = await readPidFile(root);
    expect(after).toBeNull();
  });
});

describe("kill switch", () => {
  it("activates and deactivates", async () => {
    await activateKillSwitch(root, "Testing halt");

    const status = await isKillSwitchActive(root);
    expect(status.active).toBe(true);
    expect(status.reason).toBe("Testing halt");
    expect(status.activatedAt).toBeDefined();

    const result = await deactivateKillSwitch(root);
    expect(result).toBe(true);

    const after = await isKillSwitchActive(root);
    expect(after.active).toBe(false);
  });

  it("deactivate returns false when not active", async () => {
    const result = await deactivateKillSwitch(root);
    expect(result).toBe(false);
  });

  it("reports inactive when no kill switch file", async () => {
    const status = await isKillSwitchActive(root);
    expect(status.active).toBe(false);
  });
});
