import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireBridgeLease,
  BridgeAlreadyRunningError,
} from "../src/core/coordination/bridge-lease.js";

describe("provider bridge lease", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("allows only one bridge process per project", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-bridge-"));
    const first = await acquireBridgeLease(root);
    await expect(acquireBridgeLease(root)).rejects.toBeInstanceOf(
      BridgeAlreadyRunningError,
    );
    await first.release();
    const second = await acquireBridgeLease(root);
    await second.release();
  });

  it("recovers a lease whose owner process is gone", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-bridge-"));
    await mkdir(join(root, ".handoff"), { recursive: true });
    await writeFile(
      join(root, ".handoff", "bridge.lock"),
      JSON.stringify({ pid: 99_999_999, token: "stale" }),
      "utf8",
    );

    const lease = await acquireBridgeLease(root);
    await lease.release();
  });
});
