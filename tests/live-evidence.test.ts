import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  parseLiveCheckReport,
  runLiveChecks,
} from "../scripts/check-live-evidence.mjs";

const packageJson = {
  name: "loadout-ai",
  version: "0.3.2",
  repository: { url: "git+https://github.com/VirajMishra1/loadout.git" },
};

describe("bounded live evidence", () => {
  it("reports unavailable network and authentication as not-verified", async () => {
    const report = await runLiveChecks({
      requested: ["npm", "github"],
      packageJson,
      env: {},
      fetchImpl: async () => {
        throw Object.assign(new Error("offline"), { code: "ENETUNREACH" });
      },
      runCommand: async () => {
        throw Object.assign(new Error("offline"), { code: "ENETUNREACH" });
      },
    });

    expect(report.checks).toEqual([
      expect.objectContaining({ id: "npm", status: "not-verified" }),
      expect.objectContaining({ id: "github", status: "not-verified" }),
    ]);
    expect(() => parseLiveCheckReport(report)).not.toThrow();
  });

  it("reports reachable upstream incompatibility as failed", async () => {
    const report = await runLiveChecks({
      requested: ["npm"],
      packageJson,
      fetchImpl: async () =>
        new Response(JSON.stringify({ version: "0.3.1" }), { status: 200 }),
      runCommand: async () => ({ stdout: "", stderr: "" }),
    });

    expect(report.checks[0]).toMatchObject({ id: "npm", status: "failed" });
    expect(report.checks[0]?.detail).toMatch(/0\.3\.1.*0\.3\.2/);
  });

  it("verifies npm only after metadata and disposable tarball installation agree", async () => {
    const calls: string[][] = [];
    const report = await runLiveChecks({
      requested: ["npm"],
      packageJson,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            version: "0.3.2",
            dist: {
              tarball:
                "https://registry.npmjs.org/loadout-ai/-/loadout-ai-0.3.2.tgz",
            },
          }),
          { status: 200 },
        ),
      runCommand: async (_file: string, args: string[]) => {
        calls.push(args);
        return { stdout: "", stderr: "" };
      },
    });

    expect(report.checks[0]).toMatchObject({ id: "npm", status: "verified" });
    expect(calls.some((args) => args.includes("--ignore-scripts"))).toBe(true);
    expect(calls.some((args) => args.includes("loadout-ai@0.3.2"))).toBe(true);
  });

  it("classifies a successful isolated Stable install and rollback as verified", async () => {
    const report = await runLiveChecks({
      requested: ["stable-install"],
      packageJson,
      runCommand: async () => ({
        stdout: JSON.stringify({
          mode: "live-catalog",
          liveCatalog: { packages: 4, pinnedCommits: true, rollback: true },
        }),
        stderr: "",
      }),
    });

    expect(report.checks[0]).toMatchObject({
      id: "stable-install",
      status: "verified",
    });
  });

  it("uses connected gh authentication and verifies observable branch protection", async () => {
    const urls: string[] = [];
    const report = await runLiveChecks({
      requested: ["github"],
      packageJson,
      env: {},
      runCommand: async () => ({ stdout: "connected-token\n", stderr: "" }),
      fetchImpl: async (input) => {
        urls.push(String(input));
        return new Response(
          JSON.stringify(
            urls.length === 1
              ? { default_branch: "main" }
              : { required_status_checks: {} },
          ),
          { status: 200 },
        );
      },
    });

    expect(report.checks[0]).toMatchObject({
      id: "github",
      status: "verified",
    });
    expect(urls[1]).toMatch(/branches\/main\/protection$/);
  });

  it("rejects tag-only GitHub Action references in every workflow", async () => {
    const workflows = await Promise.all(
      ["ci.yml", "daily-discovery.yml", "release.yml"].map((name) =>
        readFile(`.github/workflows/${name}`, "utf8"),
      ),
    );
    for (const workflow of workflows) {
      expect(workflow).not.toMatch(/uses:\s+[^\s@]+@v\d+(?:\s|$)/m);
      for (const reference of workflow.matchAll(/uses:\s+[^\s@]+@([^\s#]+)/g)) {
        expect(reference[1]).toMatch(/^[0-9a-f]{40}$/);
      }
    }
  });
});
