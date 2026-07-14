import { describe, expect, it, afterEach } from "vitest";
import { detectAgents, loadoutHome, userHome } from "../src/core/paths.js";

describe("platform paths", () => {
  const originalHome = process.env.LOADOUT_USER_HOME;
  afterEach(() => {
    if (originalHome === undefined) delete process.env.LOADOUT_USER_HOME;
    else process.env.LOADOUT_USER_HOME = originalHome;
  });

  it("uses an injectable home for isolated tests", async () => {
    process.env.LOADOUT_USER_HOME = "/tmp/loadout-test-home";
    expect(userHome()).toBe("/tmp/loadout-test-home");
    expect(loadoutHome()).toContain(".loadout");
    const agents = await detectAgents();
    expect(agents.find((agent) => agent.id === "codex")?.skillsDirectory).toBe("/tmp/loadout-test-home/.agents/skills");
  });
});
