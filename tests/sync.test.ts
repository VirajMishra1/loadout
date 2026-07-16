import { afterEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySyncPlan, buildSyncPlan } from "../src/core/sync.js";
import { readInstallState } from "../src/core/state.js";
import {
  createSnapshot,
  readSnapshot,
  restoreSnapshot,
} from "../src/core/snapshot.js";
import {
  beginTransaction,
  markTransactionCommitting,
  transactionRoot,
} from "../src/core/transaction.js";

describe("manifest synchronization", () => {
  let root = "";
  const originalPath = process.env.PATH;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    process.env.PATH = originalPath;
    delete process.env.LOADOUT_HOME;
    delete process.env.LOADOUT_USER_HOME;
  });

  it("plans and applies mixed components as one locked transaction", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-sync-"));
    const source = join(root, "package");
    const home = join(root, "home");
    await mkdir(join(home, ".agents"), { recursive: true });
    await mkdir(join(home, ".claude"));
    await mkdir(join(source, "skills", "demo"), { recursive: true });
    await mkdir(join(source, "commands"));
    await writeFile(
      join(source, "skills", "demo", "SKILL.md"),
      "---\nname: demo\ndescription: Demo skill\n---\n",
    );
    await writeFile(
      join(source, "commands", "review.md"),
      "Review carefully.\n",
    );
    const manifestPath = join(root, "loadout.json");
    const lockPath = join(root, "loadout.lock");
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        name: "test",
        scope: "global",
        agents: ["codex", "claude-code"],
        packages: [{ id: "demo", source: { type: "local", path: source } }],
      }),
    );
    process.env.LOADOUT_HOME = join(root, ".loadout");
    process.env.LOADOUT_USER_HOME = home;
    const plan = await buildSyncPlan(manifestPath);
    expect(
      plan.packages[0].plan.files.map((file) => file.componentType),
    ).toEqual(expect.arrayContaining(["skill", "command"]));
    const result = await applySyncPlan(plan, lockPath);
    expect(result.snapshotId).toBeTruthy();
    expect((await readInstallState()).installs[0].targetAgents).toEqual(
      expect.arrayContaining(["codex", "claude-code"]),
    );
    expect(JSON.parse(await readFile(lockPath, "utf8")).packages[0].id).toBe(
      "demo",
    );
    expect(
      await readFile(
        join(home, ".codex", "prompts", "demo", "review.md"),
        "utf8",
      ),
    ).toContain("Review");
    expect(
      await readFile(
        join(home, ".claude", "commands", "demo", "review.md"),
        "utf8",
      ),
    ).toContain("Review");
  });

  it("reports and enforces blocked-domain policy", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-sync-policy-"));
    const source = join(root, "package");
    const home = join(root, "home");
    await mkdir(join(home, ".agents"), { recursive: true });
    await mkdir(source);
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: demo\ndescription: Demo skill\n---\nUse https://blocked.example/api\n",
    );
    const manifestPath = join(root, "loadout.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        name: "policy",
        scope: "global",
        agents: ["codex"],
        policy: { blockedDomains: ["blocked.example"] },
        packages: [{ id: "demo", source: { type: "local", path: source } }],
      }),
    );
    process.env.LOADOUT_HOME = join(root, ".loadout");
    process.env.LOADOUT_USER_HOME = home;
    const plan = await buildSyncPlan(manifestPath);
    expect(plan.policyViolations).toEqual([
      "demo references blocked domain 'blocked.example'",
    ]);
    await expect(
      applySyncPlan(plan, join(root, "loadout.lock"), { approveRisk: true }),
    ).rejects.toThrow(/violates manifest policy/);
  });

  it("enforces shared package allowlists and denylists before apply", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-sync-policy-list-"));
    const source = join(root, "package");
    const home = join(root, "home");
    await mkdir(join(home, ".agents"), { recursive: true });
    await mkdir(source);
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: demo\ndescription: Demo skill\n---\nSafe instructions\n",
    );
    const manifestPath = join(root, "loadout.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        name: "policy-list",
        scope: "global",
        agents: ["codex"],
        policy: { allowPackages: ["approved"], deniedPackages: ["demo"] },
        packages: [{ id: "demo", source: { type: "local", path: source } }],
      }),
    );
    process.env.LOADOUT_HOME = join(root, ".loadout");
    process.env.LOADOUT_USER_HOME = home;
    const plan = await buildSyncPlan(manifestPath);
    expect(plan.policyViolations).toEqual([
      "demo is not on the package allowlist",
      "demo is on the package denylist",
    ]);
  });

  it("applies MCP-only packages transactionally and rolls back config plus state", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-sync-mcp-"));
    const source = join(root, "package");
    const home = join(root, "home");
    await mkdir(join(home, ".agents"), { recursive: true });
    await mkdir(source);
    await writeFile(
      join(source, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          docs: {
            command: "npx",
            args: ["-y", "docs-server"],
            env: { DOCS_TOKEN: "${DOCS_TOKEN}" },
          },
        },
      }),
    );
    const config = join(root, "agent-mcp.json");
    const original = JSON.stringify({
      theme: "dark",
      mcpServers: { existing: { command: "keep" } },
    });
    await writeFile(config, original);
    const manifestPath = join(root, "loadout.json");
    const lockPath = join(root, "loadout.lock");
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        name: "mcp",
        scope: "global",
        agents: ["codex"],
        packages: [
          {
            id: "docs",
            source: { type: "local", path: source },
            mcp: { config, servers: ["docs"] },
          },
        ],
      }),
    );
    process.env.LOADOUT_HOME = join(root, ".loadout");
    process.env.LOADOUT_USER_HOME = home;
    const plan = await buildSyncPlan(manifestPath);
    expect(plan.mcpPlans).toHaveLength(1);
    expect(plan.packages[0].safety.approvalRequired).toBe(true);
    await expect(applySyncPlan(plan, lockPath)).rejects.toThrow(
      /risk approval/,
    );
    const result = await applySyncPlan(plan, lockPath, { approveRisk: true });
    const updated = JSON.parse(await readFile(config, "utf8"));
    expect(updated.theme).toBe("dark");
    expect(updated.mcpServers.existing.command).toBe("keep");
    expect(updated.mcpServers.docs.command).toBe("npx");
    expect((await readInstallState()).mcpInstalls).toEqual([
      expect.objectContaining({
        packageId: "docs",
        serverName: "docs",
        configPath: config,
      }),
    ]);
    expect(JSON.parse(await readFile(lockPath, "utf8")).mcpServers).toEqual([
      expect.objectContaining({ packageId: "docs", serverName: "docs" }),
    ]);
    await restoreSnapshot(await readSnapshot(result.snapshotId!));
    expect(await readFile(config, "utf8")).toBe(original);
    expect((await readInstallState()).installs).toEqual([]);
  });

  it("recovers an interrupted transaction before an otherwise empty sync", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-sync-recovery-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    process.env.LOADOUT_USER_HOME = join(root, "home");
    const target = join(root, "managed.txt");
    const manifestPath = join(root, "loadout.json");
    const lockPath = join(root, "loadout.lock");
    await writeFile(target, "before\n");
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        name: "empty-recovery",
        scope: "global",
        agents: ["codex"],
        packages: [],
      }),
    );
    const snapshot = await createSnapshot([target], { persist: false });
    const transaction = await beginTransaction(snapshot, [target]);
    await markTransactionCommitting(transaction);
    await writeFile(target, "interrupted\n");
    await transaction.mutationLock.release();

    await applySyncPlan(
      {
        manifest: manifestPath,
        packages: [],
        mcpPlans: [],
        skipped: [],
        policyViolations: [],
      },
      lockPath,
    );

    expect(await readFile(target, "utf8")).toBe("before\n");
    expect(await readdir(transactionRoot())).toEqual([]);
  });

  it("refuses a misleading lockfile when an enabled package was skipped", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-sync-skipped-"));
    const source = join(root, "empty-package");
    const home = join(root, "home");
    const manifestPath = join(root, "loadout.json");
    const lockPath = join(root, "loadout.lock");
    await mkdir(join(home, ".agents"), { recursive: true });
    await mkdir(source);
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        name: "skipped",
        scope: "global",
        agents: ["codex"],
        packages: [{ id: "empty", source: { type: "local", path: source } }],
      }),
    );
    process.env.LOADOUT_HOME = join(root, ".loadout");
    process.env.LOADOUT_USER_HOME = home;

    const plan = await buildSyncPlan(manifestPath);
    expect(plan.skipped).toEqual([
      expect.objectContaining({ packageId: "empty" }),
    ]);
    await expect(applySyncPlan(plan, lockPath)).rejects.toThrow(
      /cannot produce a reproducible lockfile.*empty/i,
    );
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
