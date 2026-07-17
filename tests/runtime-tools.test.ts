import { afterEach, describe, expect, it } from "vitest";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GRAPHIFY_RECIPE,
  applyRuntimeToolPlan,
  planRuntimeTool,
  type RuntimeToolRunner,
} from "../src/core/runtime-tools.js";
import type { DetectedAgent } from "../src/shared/types.js";

describe("reviewed runtime tool recipes", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    delete process.env.LOADOUT_HOME;
    delete process.env.LOADOUT_USER_HOME;
  });

  async function fixture() {
    root = await mkdtemp(join(tmpdir(), "loadout-runtime-tool-"));
    process.env.LOADOUT_HOME = join(root, "state");
    process.env.LOADOUT_USER_HOME = join(root, "home");
    const agent: DetectedAgent = {
      id: "codex",
      displayName: "Codex",
      installed: true,
      skillsDirectory: join(root, "home", ".agents", "skills"),
    };
    return { agent };
  }

  it("pins Graphify source and executable artifact without inheriting credentials", async () => {
    const { agent } = await fixture();
    const plan = await planRuntimeTool("graphify", {
      requestedAgents: ["codex"],
      detectedAgents: [agent],
    });
    expect(GRAPHIFY_RECIPE.reviewedCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(GRAPHIFY_RECIPE.source).toContain(GRAPHIFY_RECIPE.reviewedCommit);
    expect(plan.commands[0].args.join(" ")).toContain(
      GRAPHIFY_RECIPE.artifactSha256,
    );
    expect(plan.commands[0].args).toContain("--exclude-newer");
    expect(plan.agents[0].target).toBe(
      join(root, "home", ".codex", "skills", "graphify"),
    );
    expect(plan.stateHome).toBe(join(root, "state"));
    expect(JSON.stringify(plan)).not.toMatch(/API_KEY|TOKEN|SECRET/);
  });

  it("requires approval, verifies the version, pins generated lookup, and restores removal", async () => {
    const { agent } = await fixture();
    const target = join(root, "home", ".codex", "skills", "graphify");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "existing.txt"), "keep");
    const plan = await planRuntimeTool("graphify", {
      requestedAgents: ["codex"],
      detectedAgents: [agent],
    });
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const runner: RuntimeToolRunner = async (command, args, options) => {
      calls.push({ command, args });
      expect(options.env).not.toHaveProperty("OPENAI_API_KEY");
      if (args.includes("install") && command !== "uv") {
        await mkdir(join(target, "references"), { recursive: true });
        await writeFile(
          join(target, "SKILL.md"),
          [
            "uv tool run --from graphifyy python -m graphify",
            "uv tool install --upgrade graphifyy -q",
            "python -m pip install graphifyy -q",
            "Tip: pip install 'graphifyy[gemini]'",
            "",
          ].join("\n"),
        );
      }
      return {
        stdout: args.includes("--version") ? "graphify 0.9.17\n" : "",
        stderr: "",
        exitCode: 0,
      };
    };
    await expect(
      applyRuntimeToolPlan(plan, { approveRisk: false, runner }),
    ).rejects.toThrow(/explicit --approve-risk/);
    const installed = await applyRuntimeToolPlan(plan, {
      approveRisk: true,
      runner,
    });
    expect(installed.action).toBe("install");
    expect(calls[0].command).toBe("uv");
    expect(await readFile(join(target, "SKILL.md"), "utf8")).toContain(
      GRAPHIFY_RECIPE.artifactSha256,
    );
    const generated = await readFile(join(target, "SKILL.md"), "utf8");
    expect(generated).not.toContain("--from graphifyy ");
    expect(generated).not.toContain("install --upgrade graphifyy ");
    expect(generated).not.toContain("pip install graphifyy ");
    expect(generated).not.toContain("pip install 'graphifyy[gemini]'");
    expect(generated).toContain(
      `uv tool install 'graphifyy @ ${GRAPHIFY_RECIPE.artifactUrl}#sha256=${GRAPHIFY_RECIPE.artifactSha256}' --exclude-newer 2026-07-17T00:00:00Z`,
    );
    expect(generated).toContain(
      `pip install 'graphifyy @ ${GRAPHIFY_RECIPE.artifactUrl}#sha256=${GRAPHIFY_RECIPE.artifactSha256}'`,
    );
    expect(generated).toContain(
      `pip install 'graphifyy[gemini] @ ${GRAPHIFY_RECIPE.artifactUrl}#sha256=${GRAPHIFY_RECIPE.artifactSha256}'`,
    );

    const removePlan = await planRuntimeTool("graphify", {
      action: "remove",
      detectedAgents: [agent],
    });
    const removed = await applyRuntimeToolPlan(removePlan, {
      approveRisk: true,
      runner,
    });
    expect(removed.action).toBe("remove");
    expect(await readFile(join(target, "existing.txt"), "utf8")).toBe("keep");
    await expect(access(join(target, "SKILL.md"))).rejects.toThrow();
    await expect(access(plan.runtimeRoot)).rejects.toThrow();
  });

  it("refuses a mutated plan before running any external command", async () => {
    const { agent } = await fixture();
    const plan = await planRuntimeTool("graphify", {
      requestedAgents: ["codex"],
      detectedAgents: [agent],
    });
    plan.commands[0].command = "bash";
    let called = false;
    await expect(
      applyRuntimeToolPlan(plan, {
        approveRisk: true,
        runner: async () => {
          called = true;
          return { stdout: "", stderr: "", exitCode: 0 };
        },
      }),
    ).rejects.toThrow(/commands do not match the reviewed recipe/);
    expect(called).toBe(false);
  });
});
