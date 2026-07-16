import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireFileLock } from "../src/core/file-lock.js";

describe("cross-process file locks", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("never steals an old-looking lock from a live process", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-live-lock-"));
    const path = join(root, "state.lock");
    const first = await acquireFileLock(path, { staleMs: 10 });
    await expect(
      acquireFileLock(path, { timeoutMs: 100, staleMs: 10 }),
    ).rejects.toThrow(/Timed out waiting/);
    await first.release();
    const second = await acquireFileLock(path, { timeoutMs: 100 });
    await second.release();
  });

  it("reclaims abandoned malformed locks and releases only its own token", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-abandoned-lock-"));
    const path = join(root, "state.lock");
    await writeFile(path, "{incomplete");
    const old = new Date(Date.now() - 60_000);
    await utimes(path, old, old);
    const lock = await acquireFileLock(path, {
      timeoutMs: 500,
      staleMs: 10,
    });
    expect(JSON.parse(await readFile(path, "utf8")).token).toBe(lock.token);

    await writeFile(
      path,
      JSON.stringify({
        token: "replacement-owner",
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
      }),
    );
    await lock.release();
    expect(JSON.parse(await readFile(path, "utf8")).token).toBe(
      "replacement-owner",
    );
  });

  it("does not let a reused live PID own an unrefreshed lock forever", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-expired-lease-"));
    const path = join(root, "state.lock");
    await writeFile(
      path,
      JSON.stringify({
        token: "orphan-from-older-process",
        pid: process.pid,
        acquiredAt: "2020-01-01T00:00:00.000Z",
      }),
    );
    const old = new Date(Date.now() - 10_000);
    await utimes(path, old, old);
    const lock = await acquireFileLock(path, {
      timeoutMs: 500,
      staleMs: 10,
      maximumLeaseMs: 100,
    });
    expect(lock.token).not.toBe("orphan-from-older-process");
    await lock.release();
  });
});
