import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSnapshot } from "../src/core/snapshot.js";
import {
  beginTransaction,
  markTransactionCommitting,
  recoverPendingTransactions,
  transactionRoot,
} from "../src/core/transaction.js";

describe("durable transaction recovery", () => {
  let root = "";
  const originalLoadoutHome = process.env.LOADOUT_HOME;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    if (originalLoadoutHome === undefined) delete process.env.LOADOUT_HOME;
    else process.env.LOADOUT_HOME = originalLoadoutHome;
  });

  it("restores an interrupted multi-file commit from its persisted journal", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-interrupted-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const first = join(root, "agent", "first.txt");
    const second = join(root, "agent", "second.txt");
    await mkdir(join(root, "agent"), { recursive: true });
    await writeFile(first, "before-first");
    await writeFile(second, "before-second");
    const snapshot = await createSnapshot([first, second]);
    const transaction = await beginTransaction(snapshot, [first, second]);
    await markTransactionCommitting(transaction);
    // Simulate a process terminating after only the first write committed.
    await writeFile(first, "partially-committed");

    expect(await recoverPendingTransactions()).toEqual([transaction.id]);
    expect(await readFile(first, "utf8")).toBe("before-first");
    expect(await readFile(second, "utf8")).toBe("before-second");
    await expect(readFile(transaction.directory)).rejects.toThrow();
  });

  it("preserves a corrupted staging journal and refuses unsafe recovery", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-corrupt-stage-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const stage = join(transactionRoot(), "123-aaaaaaaaaaaa");
    await mkdir(stage, { recursive: true });
    await writeFile(join(stage, "transaction.json"), "{not-json");

    await expect(recoverPendingTransactions()).rejects.toThrow(
      /Corrupt Loadout transaction journal/,
    );
    expect(await readFile(join(stage, "transaction.json"), "utf8")).toBe(
      "{not-json",
    );
  });
});
