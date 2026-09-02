import { describe, expect, it, beforeEach } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DetectedAgent } from "../src/shared/types.js";
import {
  applyFirstPartySkill,
  bundledSkillsRoot,
  findFirstPartySkill,
  FIRST_PARTY_SKILLS,
  formatFirstPartySkillList,
  formatFirstPartySkillPlan,
  planFirstPartySkill,
  removeFirstPartySkill,
} from "../src/core/delegation/first-party-skills.js";

function agent(
  id: DetectedAgent["id"],
  displayName: string,
  skillsDirectory: string,
  installed = true,
): DetectedAgent {
  return { id, displayName, installed, skillsDirectory };
}

describe("first-party skills", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-fps-test-"));
  });

  it("ships the handoff and curator skills", () => {
    const ids = FIRST_PARTY_SKILLS.map((s) => s.id);
    expect(ids).toContain("loadout-handoff");
    expect(ids).toContain("loadout-curator");
  });

  it("bundles a SKILL.md for every registered first-party skill", async () => {
    const skillsRoot = await bundledSkillsRoot();
    for (const skill of FIRST_PARTY_SKILLS) {
      const body = await readFile(
        join(skillsRoot, skill.id, "SKILL.md"),
        "utf8",
      );
      expect(body, skill.id).toContain(`name: ${skill.id}`);
      expect(body, skill.id).toContain("loadout");
    }
  });

  it("resolves the bundled skills directory from this build", async () => {
    const skillsRoot = await bundledSkillsRoot();
    const skill = await readFile(
      join(skillsRoot, "loadout-handoff", "SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("name: loadout-handoff");
    expect(skill).toContain("loadout handoff");
  });

  it("rejects an unknown skill id with the available ids", () => {
    expect(() => findFirstPartySkill("nope")).toThrow(/loadout-handoff/);
  });

  it("plans one destination per installed agent", async () => {
    const detected = [
      agent("claude-code", "Claude Code", join(root, "claude")),
      agent("codex", "Codex", join(root, "codex")),
      agent("cursor", "Cursor", join(root, "cursor"), false),
    ];
    const plan = await planFirstPartySkill("loadout-handoff", { detected });
    expect(plan.targets).toHaveLength(2);
    expect(plan.targets.map((t) => t.agent)).toEqual(["claude-code", "codex"]);
    expect(plan.targets.every((t) => t.replacing === false)).toBe(true);
  });

  it("narrows the plan when specific agents are requested", async () => {
    const detected = [
      agent("claude-code", "Claude Code", join(root, "claude")),
      agent("codex", "Codex", join(root, "codex")),
    ];
    const plan = await planFirstPartySkill("loadout-handoff", {
      detected,
      agents: ["codex"],
    });
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0].agent).toBe("codex");
  });

  it("copies the skill into each target on apply", async () => {
    const detected = [
      agent("claude-code", "Claude Code", join(root, "claude")),
    ];
    const plan = await planFirstPartySkill("loadout-handoff", { detected });
    await applyFirstPartySkill(plan);

    const written = await readFile(
      join(root, "claude", "loadout-handoff", "SKILL.md"),
      "utf8",
    );
    expect(written).toContain("name: loadout-handoff");
  });

  it("marks an existing install as replacing and removes stale files", async () => {
    const detected = [
      agent("claude-code", "Claude Code", join(root, "claude")),
    ];
    const destination = join(root, "claude", "loadout-handoff");
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "OLD.md"), "stale", "utf8");

    const plan = await planFirstPartySkill("loadout-handoff", { detected });
    expect(plan.targets[0].replacing).toBe(true);

    await applyFirstPartySkill(plan);
    await expect(
      readFile(join(destination, "OLD.md"), "utf8"),
    ).rejects.toThrow();
    expect(await readFile(join(destination, "SKILL.md"), "utf8")).toContain(
      "loadout-handoff",
    );
  });

  it("removes an installed skill", async () => {
    const detected = [
      agent("claude-code", "Claude Code", join(root, "claude")),
    ];
    await applyFirstPartySkill(
      await planFirstPartySkill("loadout-handoff", { detected }),
    );
    const removalPlan = await planFirstPartySkill("loadout-handoff", {
      detected,
    });
    await removeFirstPartySkill(removalPlan);
    await expect(
      readFile(join(root, "claude", "loadout-handoff", "SKILL.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("explains when no agent is available to receive the skill", async () => {
    const plan = await planFirstPartySkill("loadout-handoff", { detected: [] });
    expect(plan.targets).toHaveLength(0);
    expect(formatFirstPartySkillPlan(plan)).toMatch(/no installed agents/i);
  });

  it("marks installed skills in the list output", () => {
    expect(formatFirstPartySkillList(new Set())).toContain("○ loadout-handoff");
    expect(formatFirstPartySkillList(new Set(["loadout-handoff"]))).toContain(
      "✓ loadout-handoff",
    );
  });
});
