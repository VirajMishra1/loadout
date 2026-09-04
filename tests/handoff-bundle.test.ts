import { describe, expect, it, beforeEach } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createHandoffBundle,
  HANDOFF_BUNDLE_MAX_FILES,
  HANDOFF_BUNDLE_MAX_FILE_BYTES,
  HANDOFF_BUNDLE_MAX_TOTAL_BYTES,
  readHandoffBundle,
} from "../src/core/delegation/handoff-bundle.js";

describe("handoff context bundles", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "loadout-handoff-bundle-test-"));
  });

  it("persists a versioned, redacted snapshot with provenance and owner-only permissions", async () => {
    const auth = 'export const token = "sk-ant-supersecretvalue123456789";\n';
    const types = "export interface Session { id: string }\n";
    await writeFile(join(projectRoot, "auth.ts"), auth, "utf8");
    await writeFile(join(projectRoot, "types.ts"), types, "utf8");

    const reference = await createHandoffBundle(projectRoot, [
      "./auth.ts",
      "types.ts",
    ]);
    const bundle = await readHandoffBundle(projectRoot, reference);

    expect(reference).toMatchObject({
      schemaVersion: 1,
      fileCount: 2,
      isTruncated: false,
    });
    expect(reference.path).toMatch(/^\.handoff\/bundles\/[a-f0-9-]+\.json$/);
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.files.map((file) => file.path)).toEqual([
      "auth.ts",
      "types.ts",
    ]);
    expect(bundle.files[0].sourceSha256).toBe(
      createHash("sha256").update(auth).digest("hex"),
    );
    expect(bundle.files[0].content).toContain("[REDACTED]");
    expect(bundle.files[0].content).not.toContain("supersecretvalue");
    expect(bundle.files[1].content).toBe(types);
    expect(reference.storedBytes).toBe(
      bundle.files.reduce((total, file) => total + file.storedBytes, 0),
    );

    const raw = await readFile(join(projectRoot, reference.path), "utf8");
    expect(raw).not.toContain("supersecretvalue");
    // Windows doesn't enforce Unix file permissions — skip on win32
    if (process.platform !== "win32") {
      expect((await stat(join(projectRoot, reference.path))).mode & 0o777).toBe(
        0o600,
      );
    }
  });

  it("rejects paths outside source territory and never follows symlinks", async () => {
    const outside = await mkdtemp(join(tmpdir(), "loadout-handoff-outside-"));
    await writeFile(join(outside, "secret.txt"), "do not read", "utf8");
    await mkdir(join(projectRoot, ".git"));
    await mkdir(join(projectRoot, ".handoff"));
    await writeFile(join(projectRoot, ".git", "config"), "private", "utf8");
    await writeFile(
      join(projectRoot, ".handoff", "messages.jsonl"),
      "private",
      "utf8",
    );
    await symlink(outside, join(projectRoot, "linked"));

    for (const unsafePath of [
      join(outside, "secret.txt"),
      "../outside.txt",
      ".git/config",
      ".handoff/messages.jsonl",
      "linked/secret.txt",
    ]) {
      await expect(
        createHandoffBundle(projectRoot, [unsafePath]),
      ).rejects.toThrow(/bundle path|symlink|internal/i);
    }
  });

  it("rejects binary files instead of embedding lossy decoded content", async () => {
    await writeFile(
      join(projectRoot, "fixture.bin"),
      Buffer.from([0x61, 0x00, 0xff, 0x62]),
    );

    await expect(
      createHandoffBundle(projectRoot, ["fixture.bin"]),
    ).rejects.toThrow(/binary/i);
  });

  it("enforces per-file and total byte limits on valid UTF-8 boundaries", async () => {
    const first = `${"a".repeat(HANDOFF_BUNDLE_MAX_FILE_BYTES - 1)}💚${"b".repeat(20_000)}`;
    const second = "c".repeat(40_000);
    await writeFile(join(projectRoot, "first.txt"), first, "utf8");
    await writeFile(join(projectRoot, "second.txt"), second, "utf8");

    const reference = await createHandoffBundle(projectRoot, [
      "first.txt",
      "second.txt",
    ]);
    const bundle = await readHandoffBundle(projectRoot, reference);

    expect(reference.storedBytes).toBeLessThanOrEqual(
      HANDOFF_BUNDLE_MAX_TOTAL_BYTES,
    );
    expect(reference.isTruncated).toBe(true);
    expect(bundle.files[0].storedBytes).toBeLessThanOrEqual(
      HANDOFF_BUNDLE_MAX_FILE_BYTES,
    );
    expect(bundle.files[0].isTruncated).toBe(true);
    expect(bundle.files[0].content).not.toContain("�");
    expect(bundle.files[1].isTruncated).toBe(true);
    expect(bundle.files[1].storedBytes).toBeLessThanOrEqual(
      HANDOFF_BUNDLE_MAX_TOTAL_BYTES - bundle.files[0].storedBytes,
    );
  });

  it("rejects corrupt bundles and reference metadata that does not match", async () => {
    await writeFile(
      join(projectRoot, "source.ts"),
      "export const ok = true;\n",
    );
    const reference = await createHandoffBundle(projectRoot, ["source.ts"]);

    await expect(
      readHandoffBundle(projectRoot, { ...reference, fileCount: 2 }),
    ).rejects.toThrow(/does not match/i);

    const path = join(projectRoot, reference.path);
    const parsed = JSON.parse(await readFile(path, "utf8"));
    parsed.unexpected = true;
    await writeFile(path, `${JSON.stringify(parsed)}\n`, "utf8");
    await expect(readHandoffBundle(projectRoot, reference)).rejects.toThrow(
      /invalid handoff bundle/i,
    );
  });

  it("refuses to follow a bundle file replaced by a symlink", async () => {
    await writeFile(
      join(projectRoot, "source.ts"),
      "export const ok = true;\n",
    );
    const reference = await createHandoffBundle(projectRoot, ["source.ts"]);
    const bundlePath = join(projectRoot, reference.path);
    const outside = join(
      await mkdtemp(join(tmpdir(), "loadout-handoff-bundle-target-")),
      "bundle.json",
    );
    await writeFile(outside, await readFile(bundlePath));
    await unlink(bundlePath);
    await symlink(outside, bundlePath);

    await expect(readHandoffBundle(projectRoot, reference)).rejects.toThrow(
      /symlink/i,
    );
  });

  it("rejects more than the documented maximum number of files", async () => {
    const paths = Array.from(
      { length: HANDOFF_BUNDLE_MAX_FILES + 1 },
      (_, index) => `file-${index}.txt`,
    );
    await Promise.all(
      paths.map((path) => writeFile(join(projectRoot, path), path, "utf8")),
    );

    await expect(createHandoffBundle(projectRoot, paths)).rejects.toThrow(
      new RegExp(`at most ${HANDOFF_BUNDLE_MAX_FILES}`, "i"),
    );
  });
});
