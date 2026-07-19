import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  lstat,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import {
  createSnapshot,
  listSnapshotIds,
  readSnapshot,
  restoreSnapshot,
  validateSnapshot,
} from "../src/core/snapshot.js";

describe("rollback snapshots", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    delete process.env.LOADOUT_HOME;
  });

  it("restores binary bytes and existing empty directories exactly", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-snapshot-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const target = join(root, "target");
    const empty = join(target, "empty");
    const binary = join(target, "asset.bin");
    await mkdir(empty, { recursive: true });
    const original = Buffer.from([0, 255, 1, 128, 10]);
    await writeFile(binary, original);
    const snapshot = await createSnapshot([target]);
    expect(
      (await readSnapshot(snapshot.id)).files.some(
        (file) => file.encoding === "base64",
      ),
    ).toBe(true);
    await rm(empty, { recursive: true });
    await writeFile(binary, Buffer.from([9, 9]));
    await writeFile(join(target, "new.txt"), "new");
    await restoreSnapshot(snapshot);
    expect(await readFile(binary)).toEqual(original);
    expect(await readdir(empty)).toEqual([]);
    await expect(readFile(join(target, "new.txt"))).rejects.toThrow();
  });

  it("restores an explicit snapshot only when current roots match its recorded post-mutation state", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-explicit-snapshot-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const target = join(root, "target");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "file.txt"), "before");
    const snapshot = await createSnapshot([target], { persist: false });
    await writeFile(join(target, "file.txt"), "after");
    const postMutation = await createSnapshot([target], { persist: false });
    Object.assign(snapshot, { postMutationFiles: postMutation.files });

    await restoreSnapshot(snapshot, {
      requireUnchangedPostMutationState: true,
    });

    expect(await readFile(join(target, "file.txt"), "utf8")).toBe("before");
  });

  it.each([
    [
      "modified file",
      async (target: string) =>
        writeFile(join(target, "file.txt"), "user edit"),
    ],
    [
      "new file",
      async (target: string) =>
        writeFile(join(target, "new.txt"), "user content"),
    ],
    [
      "new directory",
      async (target: string) => mkdir(join(target, "new-directory")),
    ],
    ["missing file", async (target: string) => rm(join(target, "file.txt"))],
    [
      "changed type",
      async (target: string) => {
        await rm(join(target, "file.txt"));
        await mkdir(join(target, "file.txt"));
      },
    ],
  ])(
    "refuses explicit rollback on %s without changing any root",
    async (_label, drift) => {
      root = await mkdtemp(join(tmpdir(), "loadout-explicit-drift-"));
      process.env.LOADOUT_HOME = join(root, ".loadout");
      const first = join(root, "first");
      const second = join(root, "second");
      await mkdir(first, { recursive: true });
      await mkdir(second, { recursive: true });
      await writeFile(join(first, "file.txt"), "before-first");
      await writeFile(join(second, "file.txt"), "before-second");
      const snapshot = await createSnapshot([first, second], {
        persist: false,
      });
      await writeFile(join(first, "file.txt"), "after-first");
      await writeFile(join(second, "file.txt"), "after-second");
      const postMutation = await createSnapshot([first, second], {
        persist: false,
      });
      Object.assign(snapshot, { postMutationFiles: postMutation.files });
      await drift(second);

      await expect(
        restoreSnapshot(snapshot, { requireUnchangedPostMutationState: true }),
      ).rejects.toThrow(/rollback refused/i);
      expect(await readFile(join(first, "file.txt"), "utf8")).toBe(
        "after-first",
      );
    },
  );

  it("fails closed for explicit rollback of a legacy snapshot without post-mutation evidence", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-explicit-legacy-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const target = join(root, "target.txt");
    await writeFile(target, "current");
    const snapshot = await createSnapshot([target], { persist: false });

    await expect(
      restoreSnapshot(snapshot, { requireUnchangedPostMutationState: true }),
    ).rejects.toThrow(/post-mutation evidence/i);
    expect(await readFile(target, "utf8")).toBe("current");
  });

  it.skipIf(process.platform === "win32")(
    "refuses explicit rollback when an unsupported FIFO appears and preserves it",
    async () => {
      root = await mkdtemp(join(tmpdir(), "loadout-explicit-fifo-"));
      process.env.LOADOUT_HOME = join(root, ".loadout");
      const target = join(root, "target");
      await mkdir(target, { recursive: true });
      await writeFile(join(target, "file.txt"), "before");
      const snapshot = await createSnapshot([target], { persist: false });
      await writeFile(join(target, "file.txt"), "after");
      const postMutation = await createSnapshot([target], { persist: false });
      Object.assign(snapshot, { postMutationFiles: postMutation.files });
      const fifo = join(target, "user.pipe");
      await promisify(execFile)("mkfifo", [fifo]);

      await expect(
        restoreSnapshot(snapshot, { requireUnchangedPostMutationState: true }),
      ).rejects.toThrow(/unsupported snapshot target/i);
      await expect(lstat(fifo).then((info) => info.isFIFO())).resolves.toBe(
        true,
      );
    },
  );

  it("rejects path traversal and malformed rollback data before mutation", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-snapshot-guard-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const target = join(root, "target.txt");
    await writeFile(target, "keep me");

    await expect(readSnapshot("../../outside")).rejects.toThrow(
      /Invalid snapshot id/,
    );
    await expect(
      restoreSnapshot({
        id: `${Date.now()}-${"a".repeat(12)}`,
        createdAt: new Date().toISOString(),
        roots: [target],
        files: [
          {
            path: target,
            existed: true,
            content: "a2VlcCBtZQ==",
            encoding: "base64",
          },
          { path: join(root, "outside.txt"), existed: false },
        ],
      }),
    ).rejects.toThrow(/escapes its declared roots/);
    expect(await readFile(target, "utf8")).toBe("keep me");
  });

  it("rejects dangerously broad, overlapping, and inconsistent roots", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-snapshot-hostile-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const id = `${Date.now()}-${"b".repeat(12)}`;
    const base = { id, createdAt: new Date().toISOString() };
    const filesystemRoot = parse(root).root;
    await expect(
      restoreSnapshot({
        ...base,
        roots: [filesystemRoot],
        files: [{ path: filesystemRoot, existed: false }],
      }),
    ).rejects.toThrow(/filesystem root/);
    await expect(
      restoreSnapshot({
        ...base,
        roots: [root, join(root, "nested")],
        files: [
          { path: root, existed: false },
          { path: join(root, "nested"), existed: false },
        ],
      }),
    ).rejects.toThrow(/non-overlapping/);
    await expect(
      restoreSnapshot({
        ...base,
        roots: [join(root, "target")],
        files: [
          {
            path: join(root, "target"),
            existed: false,
            content: "dGFtcGVyZWQ=",
            encoding: "base64",
          },
        ],
      }),
    ).rejects.toThrow(/must not contain data/);
  });

  it("lists no snapshots cleanly on first run", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-snapshot-empty-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    expect(await listSnapshotIds()).toEqual([]);
  });

  it("validates large binary snapshots without overflowing the call stack", () => {
    const target = "/tmp/loadout-large-snapshot.bin";
    expect(() =>
      validateSnapshot({
        id: `${Date.now()}-${"c".repeat(12)}`,
        createdAt: new Date().toISOString(),
        roots: [target],
        files: [
          {
            path: target,
            existed: true,
            content: Buffer.alloc(4 * 1024 * 1024, 0x5a).toString("base64"),
            encoding: "base64",
          },
        ],
      }),
    ).not.toThrow();
  });

  it.each(["AAA", "AA=A", "AAAA====", "AAAA\n"])(
    "rejects malformed base64 snapshot bytes: %j",
    (content) => {
      const target = "/tmp/loadout-invalid-snapshot.bin";
      expect(() =>
        validateSnapshot({
          id: `${Date.now()}-${"d".repeat(12)}`,
          createdAt: new Date().toISOString(),
          roots: [target],
          files: [
            {
              path: target,
              existed: true,
              content,
              encoding: "base64",
            },
          ],
        }),
      ).toThrow(/bytes are invalid/);
    },
  );
});
