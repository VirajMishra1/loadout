import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildUniversalPackagePlan, discoverResources } from "../src/core/components.js";
import type { DetectedAgent } from "../src/shared/types.js";

describe("universal package components", () => {
  let root = "";
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it("discovers conventional rules, commands, and agents", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-components-"));
    for (const directory of ["rules", "commands", "agents"]) await mkdir(join(root, directory));
    await writeFile(join(root, "rules", "safe.md"), "rule");
    await writeFile(join(root, "commands", "review.md"), "command");
    await writeFile(join(root, "agents", "tester.md"), "agent");
    expect(await discoverResources(root)).toEqual([
      { type: "agent", name: "tester", path: "agents/tester.md" },
      { type: "command", name: "review", path: "commands/review.md" },
      { type: "rule", name: "safe", path: "rules/safe.md" },
    ]);
  });

  it("plans only supported targets and labels adapted layouts", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-components-plan-"));
    await mkdir(join(root, "commands")); await mkdir(join(root, "rules"));
    await writeFile(join(root, "commands", "review.md"), "command"); await writeFile(join(root, "rules", "safe.md"), "rule");
    const home = join(root, "home");
    const agents: DetectedAgent[] = [
      { id: "claude-code", displayName: "Claude Code", installed: true, skillsDirectory: join(home, ".claude", "skills") },
      { id: "codex", displayName: "Codex", installed: true, skillsDirectory: join(home, ".agents", "skills") },
      { id: "cursor", displayName: "Cursor", installed: true, skillsDirectory: join(home, ".cursor", "skills") },
    ];
    const plan = await buildUniversalPackagePlan(root, "demo", agents);
    expect(plan.files.filter((file) => file.componentType === "command")).toHaveLength(3);
    expect(plan.files).toEqual(expect.arrayContaining([expect.objectContaining({ target: join(home, ".codex", "prompts", "demo", "review.md"), compatibility: "adapted" })]));
    expect(plan.files.filter((file) => file.componentType === "rule")).toHaveLength(1);
    expect(plan.warnings.join(" ")).toContain("unsupported");
  });
});
