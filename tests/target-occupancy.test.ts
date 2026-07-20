import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectTargetOccupancy } from "../src/core/target-occupancy.js";

describe("target occupancy", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("treats missing and recursively empty targets as unoccupied", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-target-"));
    const empty = join(root, "skill");
    await mkdir(join(empty, "empty", "nested"), { recursive: true });

    await expect(
      inspectTargetOccupancy(join(root, "missing")),
    ).resolves.toEqual({ occupied: false });
    await expect(inspectTargetOccupancy(empty)).resolves.toEqual({
      occupied: false,
    });
  });

  it("treats file content and symlinks as occupied", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-target-"));
    const content = join(root, "content");
    const linked = join(root, "linked");
    await mkdir(content);
    await writeFile(join(content, "SKILL.md"), "content");
    await symlink(content, linked);

    await expect(inspectTargetOccupancy(content)).resolves.toEqual({
      occupied: true,
      reason: "content",
    });
    await expect(inspectTargetOccupancy(linked)).resolves.toEqual({
      occupied: true,
      reason: "symlink",
    });
  });

  it("fails closed when recursive inspection exceeds its bound", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-target-"));
    const bounded = join(root, "bounded");
    await mkdir(join(bounded, "one"), { recursive: true });
    await mkdir(join(bounded, "two"), { recursive: true });

    await expect(inspectTargetOccupancy(bounded, 1)).resolves.toEqual({
      occupied: true,
      reason: "inspection-limit",
    });
  });
});
