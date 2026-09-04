import { beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const entry = resolve("src/cli.ts");
const tsxLoader = fileURLToPath(import.meta.resolve("tsx"));

async function runCli(projectRoot: string, ...args: string[]) {
  return execFileAsync(
    process.execPath,
    ["--import", tsxLoader, entry, ...args],
    {
      cwd: projectRoot,
      env: { ...process.env, NO_COLOR: "1" },
    },
  );
}

describe("handoff CLI", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "loadout-cli-handoff-test-"));
  });

  it("creates a context bundle and exposes it in JSON and receiver output", async () => {
    await writeFile(
      join(projectRoot, "auth.ts"),
      "export const auth = true;\n",
    );
    await writeFile(
      join(projectRoot, "types.ts"),
      "export type Id = string;\n",
    );

    const sent = await runCli(
      projectRoot,
      "handoff",
      "codex",
      "write auth tests",
      "--bundle",
      "auth.ts",
      "types.ts",
      "--json",
    );
    const result = JSON.parse(sent.stdout);
    expect(result.message.bundle).toMatchObject({
      schemaVersion: 1,
      fileCount: 2,
      isTruncated: false,
    });
    expect(
      JSON.parse(
        await readFile(join(projectRoot, result.message.bundle.path), "utf8"),
      ).files.map((file: { path: string }) => file.path),
    ).toEqual(["auth.ts", "types.ts"]);

    const inbox = await runCli(projectRoot, "handoff", "codex");
    expect(inbox.stdout).toContain(result.message.bundle.path);
    expect(inbox.stdout).toContain("auth.ts, types.ts");
    expect(inbox.stdout).toMatch(/untrusted project data/i);
  });

  it("does not leave a task or orphan bundle when message validation fails", async () => {
    await writeFile(
      join(projectRoot, "auth.ts"),
      "export const auth = true;\n",
    );

    await expect(
      runCli(
        projectRoot,
        "handoff",
        "codex",
        "write auth tests",
        "--bundle",
        "auth.ts",
        "--from",
        "",
      ),
    ).rejects.toThrow(/invalid handoff message/i);
    expect(
      await readFile(join(projectRoot, ".handoff", "messages.jsonl"), "utf8"),
    ).toBe("");
    expect(await readdir(join(projectRoot, ".handoff", "bundles"))).toEqual([]);
  });
});
