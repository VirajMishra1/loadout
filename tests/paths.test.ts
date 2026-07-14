import { describe, expect, it, afterEach } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { detectAgents, loadoutHome, userHome } from "../src/core/paths.js";

describe("platform paths", () => {
  const originalHome = process.env.LOADOUT_USER_HOME;
  const originalState = process.env.LOADOUT_HOME;
  afterEach(() => {
    if (originalHome === undefined) delete process.env.LOADOUT_USER_HOME;
    else process.env.LOADOUT_USER_HOME = originalHome;
    if (originalState === undefined) delete process.env.LOADOUT_HOME;
    else process.env.LOADOUT_HOME = originalState;
  });

  it("uses an injectable home for isolated tests", async () => {
    const home = join(tmpdir(), "loadout-test-home");
    process.env.LOADOUT_USER_HOME = home;
    process.env.LOADOUT_HOME = join(home, ".loadout");
    expect(userHome()).toBe(home);
    expect(loadoutHome()).toContain(".loadout");
    const agents = await detectAgents();
    expect(agents.find((agent) => agent.id === "codex")?.skillsDirectory).toBe(join(home, ".agents", "skills"));
  });

  it("prefers USERPROFILE for native Windows home resolution", () => {
    const env = { USERPROFILE: "C:\\Users\\viraj", HOME: "C:\\msys-home" };
    expect(userHome(env, "win32")).toBe("C:\\Users\\viraj");
  });

  it("uses APPDATA for Windows state and has a profile fallback", () => {
    expect(loadoutHome({ USERPROFILE: "C:\\Users\\viraj", APPDATA: "C:\\Users\\viraj\\AppData\\Roaming" }, "win32"))
      .toBe(win32.join("C:\\Users\\viraj\\AppData\\Roaming", "loadout"));
    expect(loadoutHome({ USERPROFILE: "C:\\Users\\viraj" }, "win32"))
      .toBe(win32.join("C:\\Users\\viraj", "AppData", "Roaming", "loadout"));
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

  it("detects an existing agent configuration even when its binary is not on PATH", async () => {
    const root = await mkdtemp(join(tmpdir(), "loadout-agent-detect-"));
    try {
      process.env.LOADOUT_USER_HOME = root; await mkdir(join(root, ".hermes"));
      expect((await detectAgents()).find((agent) => agent.id === "hermes")?.installed).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
