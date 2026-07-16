import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planAdapterSkillInstall } from "../src/core/adapters.js";
import { applySkillInstall } from "../src/core/install.js";
import { applyRemove, planRemove } from "../src/core/remove.js";
import { agentSkillsDirectory } from "../src/core/paths.js";
import type { AgentId, DetectedAgent } from "../src/shared/types.js";

const ADAPTERS: Array<{ id: AgentId; displayName: string }> = [
  { id: "claude-code", displayName: "Claude Code" },
  { id: "codex", displayName: "Codex" },
  { id: "cursor", displayName: "Cursor" },
  { id: "gemini-cli", displayName: "Gemini CLI" },
  { id: "opencode", displayName: "OpenCode" },
  { id: "hermes", displayName: "Hermes" },
  { id: "windsurf", displayName: "Windsurf" },
  { id: "cline", displayName: "Cline" },
  { id: "github-copilot", displayName: "GitHub Copilot" },
  { id: "roo-code", displayName: "Roo Code" },
  { id: "kiro-cli", displayName: "Kiro CLI" },
  { id: "junie", displayName: "Junie" },
];

function detectedAgent(
  id: AgentId,
  displayName: string,
  home: string,
): DetectedAgent {
  return {
    id,
    displayName,
    installed: true,
    skillsDirectory: agentSkillsDirectory(id, home, "linux"),
  };
}

describe("native per-agent skill planners", () => {
  let root = "";
  const originalLoadoutHome = process.env.LOADOUT_HOME;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    if (originalLoadoutHome === undefined) delete process.env.LOADOUT_HOME;
    else process.env.LOADOUT_HOME = originalLoadoutHome;
  });

  it.each(ADAPTERS)(
    "plans, installs, and removes a native skill for $displayName",
    async ({ id, displayName }) => {
      root = await mkdtemp(join(tmpdir(), `loadout-${id}-planner-`));
      process.env.LOADOUT_HOME = join(root, ".loadout");
      const source = join(root, "source");
      const agent = detectedAgent(id, displayName, join(root, "home"));
      await mkdir(source, { recursive: true });
      await writeFile(
        join(source, "SKILL.md"),
        "---\nname: adapter-smoke\ndescription: Native adapter smoke test\n---\n\nFollow the instruction.\n",
      );

      const plan = await planAdapterSkillInstall(
        source,
        "adapter-smoke",
        agent,
      );
      expect(plan.targetAgents).toEqual([id]);
      expect(plan.files).toEqual([
        expect.objectContaining({
          source,
          target: join(agent.skillsDirectory, "adapter-smoke"),
          componentType: "skill",
          compatibility: "native",
        }),
      ]);

      await applySkillInstall(plan);
      expect(
        await readFile(
          join(agent.skillsDirectory, "adapter-smoke", "SKILL.md"),
          "utf8",
        ),
      ).toContain("adapter-smoke");

      const removal = await planRemove("adapter-smoke");
      expect(removal.blocked).toBe(false);
      await applyRemove(removal);
      await expect(
        readFile(join(agent.skillsDirectory, "adapter-smoke", "SKILL.md")),
      ).rejects.toThrow();
    },
  );
});
