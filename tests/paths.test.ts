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

  it("prefers USERPROFILE for native Windows home resolution", () => {
    const env = { USERPROFILE: "C:\\Users\\viraj", HOME: "C:\\msys-home" };
    expect(userHome(env, "win32")).toBe("C:\\Users\\viraj");
  });

  it("uses APPDATA for Windows state and has a profile fallback", () => {
    expect(loadoutHome({ USERPROFILE: "C:\\Users\\viraj", APPDATA: "C:\\Users\\viraj\\AppData\\Roaming" }, "win32"))
      .toBe("C:\\Users\\viraj\\AppData\\Roaming/loadout");
    expect(loadoutHome({ USERPROFILE: "C:\\Users\\viraj" }, "win32"))
      .toBe("C:\\Users\\viraj/AppData/Roaming/loadout");
  });

  it("honors explicit state-directory overrides on every platform", () => {
    expect(loadoutHome({ LOADOUT_HOME: "/tmp/loadout-state", APPDATA: "ignored" }, "win32")).toBe("/tmp/loadout-state");
  });

  it("advertises every supported agent without requiring its binary", async () => {
    const agents = await detectAgents();
    expect(agents.map((agent) => agent.id)).toEqual([
      "claude-code", "codex", "cursor", "gemini-cli", "opencode", "hermes"
    ]);
  });
});
