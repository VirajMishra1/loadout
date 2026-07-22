import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyProjectActivation,
  formatProjectActivation,
  planProjectActivation,
} from "../src/core/active-policy.js";
import {
  activationLibraryPath,
  readInstallState,
  writeInstallState,
} from "../src/core/state.js";
import type { ManagedActivationRecord } from "../src/shared/types.js";

describe("project-aware active-set policy", () => {
  let root = "";
  const originalLoadoutHome = process.env.LOADOUT_HOME;
  const originalUserHome = process.env.LOADOUT_USER_HOME;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    if (originalLoadoutHome === undefined) delete process.env.LOADOUT_HOME;
    else process.env.LOADOUT_HOME = originalLoadoutHome;
    if (originalUserHome === undefined) delete process.env.LOADOUT_USER_HOME;
    else process.env.LOADOUT_USER_HOME = originalUserHome;
  });

  async function writeTwoAgentLibrary(count: number): Promise<string> {
    const home = join(root, "home");
    process.env.LOADOUT_HOME = join(root, ".loadout");
    process.env.LOADOUT_USER_HOME = home;
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({ devDependencies: { typescript: "1" } }),
    );
    for (let index = 1; index <= 12; index += 1) {
      const directory = join(home, ".claude", "skills", `unmanaged-${index}`);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "SKILL.md"),
        `---\nname: unmanaged-${index}\ndescription: Existing skill\n---\n`,
      );
    }

    const activations: ManagedActivationRecord[] = [];
    const files: Array<{ path: string; sha256: string }> = [];
    for (const agent of ["claude-code", "codex"] as const) {
      const activeRoot =
        agent === "claude-code"
          ? join(home, ".claude", "skills")
          : join(home, ".agents", "skills");
      for (let index = 1; index <= count; index += 1) {
        const unitId = `typescript-pattern-${String(index).padStart(2, "0")}`;
        const content = `---\nname: ${unitId}\ndescription: TypeScript project skill\n---\n`;
        const digest = createHash("sha256").update(content).digest("hex");
        const libraryPath = activationLibraryPath("collection", agent, unitId);
        await mkdir(join(libraryPath, unitId), { recursive: true });
        await writeFile(join(libraryPath, unitId, "SKILL.md"), content);
        const activePath = join(activeRoot, unitId);
        files.push({ path: join(activePath, "SKILL.md"), sha256: digest });
        activations.push({
          packageId: "collection",
          unitId,
          agent,
          cacheState: "downloaded",
          reviewState: "reviewed",
          installationState: "installed",
          activationState: "disabled",
          libraryPath,
          targets: [{ activePath, libraryRelativePath: unitId }],
          libraryFiles: [{ path: `${unitId}/SKILL.md`, sha256: digest }],
          updatedAt: "2026-07-20T00:00:00Z",
        });
      }
    }
    await writeInstallState({
      version: 1,
      installs: [
        {
          packageId: "collection",
          targetAgents: ["claude-code", "codex"],
          files,
          snapshotId: "library",
          installedAt: "2026-07-20T00:00:00Z",
        },
      ],
      mcpInstalls: [],
      activations,
    });
    return project;
  }

  async function writeNamedCodexLibrary(
    unitIds: string[],
    options: { playwright?: boolean } = {},
  ): Promise<string> {
    const home = join(root, "home");
    process.env.LOADOUT_HOME = join(root, ".loadout");
    process.env.LOADOUT_USER_HOME = home;
    const project = join(root, "project");
    await mkdir(project, { recursive: true });
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({
        name: "loadout-like-cli",
        private: false,
        bin: { loadout: "dist/cli.js" },
        publishConfig: { access: "public" },
        keywords: ["mcp"],
        scripts: { prepack: "npm run build", test: "vitest run" },
        dependencies: { commander: "1", zod: "1" },
        devDependencies: {
          vitest: "1",
          ...(options.playwright === false ? {} : { "@playwright/test": "1" }),
          typescript: "1",
        },
      }),
    );
    const activations: ManagedActivationRecord[] = [];
    const files: Array<{ path: string; sha256: string }> = [];
    for (const unitId of unitIds) {
      const content = `---\nname: ${unitId}\ndescription: Project skill\n---\n`;
      const digest = createHash("sha256").update(content).digest("hex");
      const libraryPath = activationLibraryPath("collection", "codex", unitId);
      await mkdir(join(libraryPath, unitId), { recursive: true });
      await writeFile(join(libraryPath, unitId, "SKILL.md"), content);
      const activePath = join(home, ".agents", "skills", unitId);
      files.push({ path: join(activePath, "SKILL.md"), sha256: digest });
      activations.push({
        packageId: "collection",
        unitId,
        agent: "codex",
        cacheState: "downloaded",
        reviewState: "reviewed",
        installationState: "installed",
        activationState: "disabled",
        libraryPath,
        targets: [{ activePath, libraryRelativePath: unitId }],
        libraryFiles: [{ path: `${unitId}/SKILL.md`, sha256: digest }],
        updatedAt: "2026-07-20T00:00:00Z",
      });
    }
    await writeInstallState({
      version: 1,
      installs: [
        {
          packageId: "collection",
          targetAgents: ["codex"],
          files,
          snapshotId: "library",
          installedAt: "2026-07-20T00:00:00Z",
        },
      ],
      mcpInstalls: [],
      activations,
    });
    return project;
  }

  it("scores reviewed skill units and activates the selected set", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-active-policy-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const project = join(root, "project");
    const activeRoot = join(root, "codex-skills");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, "requirements.txt"), "pytest\n");
    const content =
      "---\nname: managed\ndescription: Managed test skill\n---\n";
    const digest = createHash("sha256").update(content).digest("hex");
    const units = [
      "systematic-debugging",
      "python-testing-patterns",
      "apple-appstore-reviewer",
    ];
    const activations: ManagedActivationRecord[] = [];
    const files: Array<{ path: string; sha256: string }> = [];
    for (const unitId of units) {
      const libraryPath = activationLibraryPath("collection", "codex", unitId);
      await mkdir(join(libraryPath, unitId), { recursive: true });
      await writeFile(join(libraryPath, unitId, "SKILL.md"), content);
      const activePath = join(activeRoot, unitId);
      files.push({ path: join(activePath, "SKILL.md"), sha256: digest });
      activations.push({
        packageId: "collection",
        unitId,
        agent: "codex",
        cacheState: "downloaded",
        reviewState: "reviewed",
        installationState: "installed",
        activationState: "disabled",
        libraryPath,
        targets: [{ activePath, libraryRelativePath: unitId }],
        libraryFiles: [{ path: `${unitId}/SKILL.md`, sha256: digest }],
        updatedAt: "2026-07-15T00:00:00Z",
      });
    }
    await writeInstallState({
      version: 1,
      installs: [
        {
          packageId: "collection",
          targetAgents: ["codex"],
          files,
          snapshotId: "library",
          installedAt: "2026-07-15T00:00:00Z",
        },
      ],
      mcpInstalls: [],
      activations,
    });

    const preview = await planProjectActivation(project, {
      agents: ["codex"],
      limit: 1,
    });
    expect(preview.project.languages).toContain("python");
    expect(preview.selected.map((item) => item.unitId)).toEqual([
      "systematic-debugging",
    ]);

    const plan = await planProjectActivation(project, {
      agents: ["codex"],
      limit: 2,
    });
    expect(plan.selected).toHaveLength(2);
    expect(plan.selected.map((item) => item.unitId)).not.toContain(
      "apple-appstore-reviewer",
    );
    const snapshot = await applyProjectActivation(plan);
    expect(snapshot).toBeTruthy();
    expect(
      await readFile(
        join(activeRoot, "python-testing-patterns", "SKILL.md"),
        "utf8",
      ),
    ).toBe(content);
  });

  it("budgets managed and unmanaged active skills separately per agent", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-active-capacity-"));
    const project = await writeTwoAgentLibrary(40);

    const plan = await planProjectActivation(project, {
      agents: ["claude-code", "codex"],
      limit: 30,
      pins: Array.from(
        { length: 40 },
        (_, index) =>
          `collection/typescript-pattern-${String(index + 1).padStart(2, "0")}`,
      ),
    });

    expect(
      plan.agentPlans.find((item) => item.agent === "claude-code"),
    ).toMatchObject({
      activeBefore: 12,
      managedBefore: 0,
      unmanagedBefore: 12,
      capacity: 18,
    });
    expect(
      plan.agentPlans.find((item) => item.agent === "claude-code")!.selected,
    ).toHaveLength(18);
    expect(
      plan.agentPlans.find((item) => item.agent === "codex"),
    ).toMatchObject({
      activeBefore: 0,
      managedBefore: 0,
      unmanagedBefore: 0,
      capacity: 30,
    });
    expect(
      plan.agentPlans.find((item) => item.agent === "codex")!.selected,
    ).toHaveLength(30);
    const output = formatProjectActivation(plan);
    expect(output).toContain(
      "Claude Code: 12 active (0 managed, 12 unmanaged); 18/30 slots available",
    );
    expect(output).toContain(
      "Codex: 0 active (0 managed, 0 unmanaged); 30/30 slots available",
    );
    expect(output).not.toMatch(/\[[0-9]+\]/);

    await applyProjectActivation(plan);
    const active = (await readInstallState()).activations!.filter(
      (entry) => entry.activationState === "active",
    );
    expect(
      active.filter((entry) => entry.agent === "claude-code"),
    ).toHaveLength(18);
    expect(active.filter((entry) => entry.agent === "codex")).toHaveLength(30);
  });

  it("uses the recommended 30-skill bound by default while preserving explicit limits", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-active-default-limit-"));
    const project = await writeTwoAgentLibrary(40);

    const defaultPlan = await planProjectActivation(project, {
      agents: ["codex"],
    });
    expect(defaultPlan.limit).toBe(30);
    expect(defaultPlan.agentPlans[0]).toMatchObject({ capacity: 30 });
    expect(defaultPlan.agentPlans[0]!.selected.length).toBeLessThanOrEqual(30);

    const explicitPlan = await planProjectActivation(project, {
      agents: ["codex"],
      limit: 3,
    });
    expect(explicitPlan.limit).toBe(3);
    expect(explicitPlan.agentPlans[0]?.selected).toHaveLength(3);
  });

  it("aborts apply when an agent consumes capacity after preview", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-active-race-"));
    const project = await writeTwoAgentLibrary(2);
    const plan = await planProjectActivation(project, {
      agents: ["claude-code", "codex"],
      limit: 13,
    });
    const appeared = join(
      root,
      "home",
      ".claude",
      "skills",
      "appeared-after-preview",
    );
    await mkdir(appeared, { recursive: true });
    await writeFile(
      join(appeared, "SKILL.md"),
      "---\nname: appeared-after-preview\ndescription: New unmanaged skill\n---\n",
    );

    await expect(applyProjectActivation(plan)).rejects.toThrow(
      /active skill capacity changed after preview/i,
    );
    await expect(
      readFile(
        join(
          root,
          "home",
          ".agents",
          "skills",
          "typescript-pattern-01",
          "SKILL.md",
        ),
      ),
    ).rejects.toThrow();
  });

  it("prefers exact CLI and Vitest signals over mismatched or redundant skills", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-active-relevance-"));
    const project = await writeNamedCodexLibrary([
      "javascript-typescript-jest",
      "vitest-testing",
      "playwright",
      "playwright-interactive",
      "playwright-generate-test",
      "playwright-explore-website",
      "e2e-testing-patterns",
      "cli-design",
      "npm-package-release",
      "mcp-security",
      "typescript-advanced-types",
    ]);

    const plan = await planProjectActivation(project, {
      agents: ["codex"],
      limit: 30,
    });
    const selected = plan.agentPlans[0].selected.map((item) => item.unitId);

    expect(selected).not.toContain("javascript-typescript-jest");
    expect(selected).toEqual(
      expect.arrayContaining([
        "vitest-testing",
        "cli-design",
        "npm-package-release",
        "mcp-security",
      ]),
    );
    expect(
      selected.filter((unitId) => /playwright|e2e/.test(unitId)),
    ).toHaveLength(3);
    expect(formatProjectActivation(plan)).toContain(
      "Detected: TypeScript, Playwright, Node CLI, npm package",
    );
  });

  it("rejects ecosystem mismatches even when generic CLI, MCP, or publish words score", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-active-compatibility-"));
    const project = await writeNamedCodexLibrary([
      "mcp-csharp-publish",
      "mcp-csharp-test",
      "uv-package-manager",
      "social-publishing",
      "vercel-cli-with-tokens",
      "msstore-cli",
      "phoenix-cli",
      "publish-to-pages",
      "datadog-cli",
      "context7-cli",
      "chrome-devtools-cli",
      "pnpm",
      "nodejs-backend-patterns",
      "web-design-guidelines",
      "accessibility-compliance",
      "database-schema-designer",
      "typescript-advanced-types",
      "npm-package-release",
      "mcp-security",
    ]);

    const plan = await planProjectActivation(project, {
      agents: ["codex"],
      limit: 30,
    });
    const selected = plan.agentPlans[0].selected.map((item) => item.unitId);

    expect(selected).toEqual(
      expect.arrayContaining([
        "typescript-advanced-types",
        "npm-package-release",
        "mcp-security",
      ]),
    );
    expect(selected).not.toEqual(
      expect.arrayContaining([
        "mcp-csharp-publish",
        "mcp-csharp-test",
        "uv-package-manager",
        "social-publishing",
        "vercel-cli-with-tokens",
        "msstore-cli",
        "phoenix-cli",
        "publish-to-pages",
        "datadog-cli",
        "context7-cli",
        "chrome-devtools-cli",
        "pnpm",
        "nodejs-backend-patterns",
        "web-design-guidelines",
        "accessibility-compliance",
        "database-schema-designer",
      ]),
    );
  });

  it("rejects browser testing skills for a CLI-only TypeScript project", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-active-cli-browser-gate-"));
    const project = await writeNamedCodexLibrary(
      [
        "webapp-testing",
        "playwright",
        "e2e-testing-patterns",
        "browser-testing",
        "typescript-advanced-types",
      ],
      { playwright: false },
    );

    const plan = await planProjectActivation(project, {
      agents: ["codex"],
      limit: 30,
    });
    const selected = plan.agentPlans[0].selected.map((item) => item.unitId);

    expect(selected).toContain("typescript-advanced-types");
    expect(selected).not.toEqual(
      expect.arrayContaining([
        "webapp-testing",
        "playwright",
        "e2e-testing-patterns",
        "browser-testing",
      ]),
    );
  });

  it("allows an explicit pin to override a compatibility gate", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-active-pin-override-"));
    const project = await writeNamedCodexLibrary(["mcp-csharp-publish"]);

    const plan = await planProjectActivation(project, {
      agents: ["codex"],
      limit: 30,
      pins: ["collection/mcp-csharp-publish"],
    });

    expect(plan.agentPlans[0].selected[0]).toMatchObject({
      selector: "collection/mcp-csharp-publish",
      reasons: [
        "explicitly pinned",
        "npm package",
        "release automation",
        "MCP tooling",
      ],
    });
  });
});
