import { describe, expect, it, afterEach } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import { AGENT_DEFINITIONS, agentSkillsDirectory, detectAgents, executableCandidates, executableLookup, loadoutHome, runtimeBoundary, userHome } from "../src/core/paths.js";

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

  it("uses native separators for every adapter filesystem layout", () => {
    const windowsHome = "C:\\Users\\viraj";
    const posixHome = "/home/viraj";
    for (const definition of AGENT_DEFINITIONS) {
      expect(agentSkillsDirectory(definition.id, windowsHome, "win32")).toBe(win32.join(windowsHome, ...definition.directory));
      expect(agentSkillsDirectory(definition.id, posixHome, "linux")).toBe(posix.join(posixHome, ...definition.directory));
    }
  });

  it("keeps WSL inside the Linux home boundary", () => {
    const env = { HOME: "/home/viraj", USERPROFILE: "C:\\Users\\viraj", WSL_DISTRO_NAME: "Ubuntu" };
    expect(runtimeBoundary(env, "linux")).toBe("wsl");
    expect(userHome(env, "linux")).toBe("/home/viraj");
    expect(agentSkillsDirectory("codex", userHome(env, "linux"), "linux")).toBe("/home/viraj/.agents/skills");
    expect(runtimeBoundary({ USERPROFILE: "C:\\Users\\viraj" }, "win32")).toBe("windows");
    expect(runtimeBoundary({ HOME: "/home/viraj" }, "linux")).toBe("posix");
  });

  it("looks up npm .cmd shims on Windows without changing POSIX lookup", () => {
    expect(executableCandidates("codex", "win32")).toEqual(["codex", "codex.cmd", "codex.exe", "codex.bat"]);
    expect(executableLookup("codex", "win32")).toEqual({ command: "where", candidates: ["codex", "codex.cmd", "codex.exe", "codex.bat"] });
    expect(executableLookup("codex", "linux")).toEqual({ command: "which", candidates: ["codex"] });
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
