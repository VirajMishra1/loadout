import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentComponentDirectory } from "../src/core/adapters.js";
import { inspectAgents } from "../src/core/agent-inspection.js";
import { agentSkillsDirectory } from "../src/core/paths.js";
import type { AgentId, DetectedAgent } from "../src/shared/types.js";

const definitions: Array<{ id: AgentId; displayName: string }> = [
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

function agent(id: AgentId, displayName: string, home: string): DetectedAgent {
  return {
    id,
    displayName,
    installed: true,
    skillsDirectory: agentSkillsDirectory(id, home, "linux"),
  };
}

describe("agent-managed component inspection", () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("inspects only declared local directories for all twelve adapters", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-agent-inventory-"));
    const agents = definitions.map((item) =>
      agent(item.id, item.displayName, root!),
    );

    for (const item of agents) {
      const skill = agentComponentDirectory(item, "skill");
      expect(skill).toBeDefined();
      await mkdir(join(skill!, "example-skill"), { recursive: true });
      await writeFile(
        join(skill!, "example-skill", "SKILL.md"),
        "not executed",
      );
    }
    for (const item of agents) {
      for (const type of ["rule", "command", "agent"] as const) {
        const directory = agentComponentDirectory(item, type);
        if (!directory) continue;
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, `${type}.md`), `${item.id}-${type}`);
      }
    }

    const inventory = await inspectAgents(agents);
    expect(inventory).toHaveLength(12);
    for (const entry of inventory) {
      const skill = entry.components.find(
        (component) => component.type === "skill",
      )!;
      expect(skill).toMatchObject({
        compatibility: "native",
        scanned: true,
        directoryExists: true,
      });
      expect(skill.entries).toContainEqual({
        path: "example-skill/SKILL.md",
        kind: "file",
      });
    }

    const codex = inventory.find((entry) => entry.agent.id === "codex")!;
    expect(
      codex.components.find((component) => component.type === "command"),
    ).toMatchObject({
      compatibility: "adapted",
      scanned: true,
      directory: join(root, ".codex", "prompts"),
    });
    expect(
      codex.components.find((component) => component.type === "rule"),
    ).toMatchObject({
      compatibility: "unsupported",
      scanned: false,
      entries: [],
    });
    expect(
      codex.components.find((component) => component.type === "mcp"),
    ).toMatchObject({ compatibility: "adapted", scanned: false, entries: [] });

    const hermes = inventory.find((entry) => entry.agent.id === "hermes")!;
    expect(
      hermes.components.find((component) => component.type === "command"),
    ).toMatchObject({ compatibility: "unsupported", scanned: false });
    expect(
      hermes.components.find((component) => component.type === "plugin")?.note,
    ).toContain("runtime behavior");
  });

  it("records but never follows symlinks in a managed root", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-agent-symlink-"));
    const codex = agent("codex", "Codex", root);
    const skillRoot = agentComponentDirectory(codex, "skill")!;
    const outside = join(root, "outside");
    await mkdir(skillRoot, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(skillRoot, "regular.md"), "safe");
    await symlink(
      outside,
      join(skillRoot, "outside"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const inspected = await inspectAgents([codex]);
    const skills = inspected[0].components.find(
      (component) => component.type === "skill",
    )!;
    expect(skills.entries).toContainEqual({ path: "outside", kind: "symlink" });
    expect(skills.entries).not.toContainEqual({
      path: "outside/anything",
      kind: "file",
    });
    expect(inspected[0].warnings.join(" ")).toContain("not followed");
  });
});
