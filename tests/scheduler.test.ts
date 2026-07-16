import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyNativeScheduler,
  planNativeScheduler,
} from "../src/core/scheduler.js";

describe("native read-only scheduler", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("renders macOS, Linux, and Windows plans that can only run watch --once", () => {
    for (const platform of ["darwin", "linux", "win32"] as const) {
      const plan = planNativeScheduler("schedule", {
        platform,
        home: platform === "win32" ? "C:\\Users\\test" : "/home/test",
        stateHome:
          platform === "win32"
            ? "C:\\Users\\test\\AppData\\Roaming\\loadout"
            : "/home/test/.loadout",
        nodePath: platform === "win32" ? "C:\\node.exe" : "/usr/bin/node",
        cliPath:
          platform === "win32" ? "C:\\loadout\\cli.js" : "/opt/loadout/cli.js",
        uid: 501,
        time: "08:30",
      });
      expect(plan.guarantee).toBe("read-only-checks-only");
      expect(plan.command.slice(-3)).toEqual(["watch", "--once", "--json"]);
      expect(plan.files.map((file) => file.content).join("\n")).not.toMatch(
        /\b(?:install|update --yes|sync --yes)\b/,
      );
    }
  });

  it("can schedule read-only multi-source candidate discovery", () => {
    const plan = planNativeScheduler("schedule", {
      platform: "linux",
      home: "/home/test",
      stateHome: "/home/test/.loadout",
      nodePath: "/usr/bin/node",
      cliPath: "/opt/loadout/cli.js",
      job: "discovery",
    });
    expect(plan.job).toBe("discovery");
    expect(plan.command.slice(-4)).toEqual([
      "--source",
      "all",
      "--queue",
      "--json",
    ]);
    expect(plan.files.map((file) => file.content).join("\n")).not.toMatch(
      /\b(?:install|update --yes|sync --yes)\b/,
    );
  });

  it("uses job-specific native files and identifiers so both jobs can coexist", () => {
    for (const platform of ["darwin", "linux", "win32"] as const) {
      const shared = {
        platform,
        home: platform === "win32" ? "C:\\Users\\test" : "/home/test",
        stateHome:
          platform === "win32"
            ? "C:\\Users\\test\\AppData\\Roaming\\loadout"
            : "/home/test/.loadout",
        nodePath: platform === "win32" ? "C:\\node.exe" : "/usr/bin/node",
        cliPath:
          platform === "win32" ? "C:\\loadout\\cli.js" : "/opt/loadout/cli.js",
        uid: 501,
      } as const;
      const updates = planNativeScheduler("schedule", {
        ...shared,
        job: "updates",
      });
      const discovery = planNativeScheduler("schedule", {
        ...shared,
        job: "discovery",
      });
      expect(updates.files.map((file) => file.path)).not.toEqual(
        discovery.files.map((file) => file.path),
      );
      expect(updates.applyCommands).not.toEqual(discovery.applyCommands);
      const updatesNativeState = JSON.stringify({
        files: updates.files.map((file) => file.path),
        commands: updates.applyCommands,
      });
      const discoveryNativeState = JSON.stringify({
        files: discovery.files.map((file) => file.path),
        commands: discovery.applyCommands,
      });
      expect(updatesNativeState).toContain("updates");
      expect(discoveryNativeState).toContain("discovery");
    }
  });

  it("declares the UTF-8 encoding actually written for Windows task XML", () => {
    const plan = planNativeScheduler("schedule", {
      platform: "win32",
      home: "C:\\Users\\test",
      stateHome: "C:\\Users\\test\\AppData\\Roaming\\loadout",
      nodePath: "C:\\node.exe",
      cliPath: "C:\\loadout\\cli.js",
    });
    expect(plan.files[0].content).toMatch(
      /^<\?xml version="1\.0" encoding="UTF-8"\?>/,
    );
    expect(plan.files[0].content).not.toContain("UTF-16");
  });

  it("applies and removes a Linux timer through a mocked native runner", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-scheduler-"));
    process.env.LOADOUT_HOME = join(root, "state");
    const home = join(root, "home");
    const calls: string[] = [];
    const runner = async (command: string, args: string[]) => {
      calls.push(`${command} ${args.join(" ")}`);
    };
    const schedule = planNativeScheduler("schedule", {
      platform: "linux",
      home,
      stateHome: process.env.LOADOUT_HOME,
      nodePath: "/usr/bin/node",
      cliPath: "/opt/loadout/cli.js",
      time: "09:15",
    });
    expect(await applyNativeScheduler(schedule, runner)).toBeTruthy();
    await expect(access(schedule.files[0].path)).resolves.toBeUndefined();
    expect(calls.join("\n")).toContain(
      "systemctl --user enable --now loadout-daily-updates.timer",
    );

    const unschedule = planNativeScheduler("unschedule", {
      platform: "linux",
      home,
      stateHome: process.env.LOADOUT_HOME,
      nodePath: "/usr/bin/node",
      cliPath: "/opt/loadout/cli.js",
      time: "09:15",
    });
    expect(await applyNativeScheduler(unschedule, runner)).toBeTruthy();
    await expect(access(unschedule.files[0].path)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects invalid times before producing native state", () => {
    expect(() =>
      planNativeScheduler("schedule", {
        platform: "linux",
        time: "25:00",
      }),
    ).toThrow(/HH:MM/);
  });
});
