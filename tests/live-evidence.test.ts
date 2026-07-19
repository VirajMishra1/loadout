import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
    const calls: Array<{
      file: string;
      args: string[];
      options?: Record<string, unknown>;
    }> = [];
    const tarball =
      "https://registry.npmjs.org/loadout-ai/-/loadout-ai-0.3.2.tgz";
    const report = await runLiveChecks({
      requested: ["npm"],
      packageJson,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            version: "0.3.2",
            dist: {
              tarball,
            },
          }),
          { status: 200 },
        ),
      runCommand: async (file, args, options) => {
        calls.push({ file, args, options });
        if (args[0] === "install") {
          const prefix = args[args.indexOf("--prefix") + 1]!;
          const installed = join(prefix, "node_modules", "loadout-ai");
          await mkdir(join(installed, "dist", "src"), { recursive: true });
          await writeFile(
            join(installed, "package.json"),
            JSON.stringify({
              name: "loadout-ai",
              version: "0.3.2",
              bin: { loadout: "dist/src/cli.js" },
            }),
          );
          await writeFile(join(installed, "dist", "src", "cli.js"), "fixture");
          return { stdout: "", stderr: "" };
        }
        return { stdout: "0.3.2\n", stderr: "" };
      },
    });

    expect(report.checks[0]).toMatchObject({ id: "npm", status: "verified" });
    const install = calls.find((call) => call.args[0] === "install")!;
    expect(install.args).toContain("--ignore-scripts");
    expect(install.args).toContain(tarball);
    expect(install.args).not.toContain("loadout-ai@0.3.2");
    expect(install.options?.env).toMatchObject({
      HOME: expect.stringContaining("loadout-live-npm-"),
      USERPROFILE: expect.stringContaining("loadout-live-npm-"),
      npm_config_cache: expect.stringContaining("loadout-live-npm-"),
      npm_config_userconfig: expect.stringContaining("loadout-live-npm-"),
      npm_config_globalconfig: expect.stringContaining("loadout-live-npm-"),
    });
    expect(install.options?.cwd).toContain("loadout-live-npm-");
    expect(calls.at(-1)?.args.at(-1)).toBe("--version");
  });

  it("rejects an installed tarball whose CLI bin escapes the package", async () => {
    const report = await runLiveChecks({
      requested: ["npm"],
      packageJson,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            version: "0.3.2",
            dist: { tarball: "https://registry.npmjs.org/fixture.tgz" },
          }),
          { status: 200 },
        ),
      runCommand: async (_file, args) => {
        if (args[0] === "install") {
          const prefix = args[args.indexOf("--prefix") + 1]!;
          const modules = join(prefix, "node_modules");
          const installed = join(modules, "loadout-ai");
          await mkdir(installed, { recursive: true });
          await writeFile(
            join(installed, "package.json"),
            JSON.stringify({
              name: "loadout-ai",
              version: "0.3.2",
              bin: { loadout: "../escape.js" },
            }),
          );
          await writeFile(join(modules, "escape.js"), "fixture");
        }
        return { stdout: "0.3.2\n", stderr: "" };
      },
    });

    expect(report.checks[0]).toMatchObject({ id: "npm", status: "failed" });
    expect(report.checks[0]?.detail).toMatch(/safe.*bin path/i);
  });

  it("classifies a successful isolated Stable install and rollback as verified", async () => {
    const report = await runLiveChecks({
      requested: ["stable-install"],
      packageJson,
      runCommand: async () => ({
        stdout: JSON.stringify({
          mode: "live-catalog",
          liveCatalog: {
            packages: 4,
            pinnedCommits: true,
            rollback: true,
            filesystemRestoration: true,
          },
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

  it("keeps GitHub service outages and realistic transport failures not-verified", async () => {
    const service = await runLiveChecks({
      requested: ["github"],
      packageJson,
      env: { GH_TOKEN: "test-token" },
      fetchImpl: async () => new Response("unavailable", { status: 503 }),
    });
    expect(service.checks[0]).toMatchObject({
      id: "github",
      status: "not-verified",
    });

    for (const message of [
      "getaddrinfo ENOTFOUND api.github.com",
      "unable to verify the first certificate",
      "Client network socket disconnected before secure TLS connection",
    ]) {
      const transport = await runLiveChecks({
        requested: ["github"],
        packageJson,
        env: { GH_TOKEN: "test-token" },
        fetchImpl: async () => {
          throw new Error(message);
        },
      });
      expect(transport.checks[0]).toMatchObject({
        id: "github",
        status: "not-verified",
      });
    }
  });

  it("parses reports with schema-equivalent strictness", () => {
    const base = {
      schemaVersion: 1 as const,
      generatedAt: "2026-07-19T01:00:00.000Z",
      checks: [
        { id: "npm" as const, status: "verified" as const, detail: "ok" },
      ],
    };
    expect(() => parseLiveCheckReport(base, ["npm"])).not.toThrow();
    expect(() =>
      parseLiveCheckReport({ ...base, extra: true }, ["npm"]),
    ).toThrow(/unexpected/i);
    expect(() =>
      parseLiveCheckReport(
        { ...base, checks: [{ ...base.checks[0], extra: true }] },
        ["npm"],
      ),
    ).toThrow(/unexpected/i);
    expect(() =>
      parseLiveCheckReport(
        { ...base, checks: [base.checks[0], base.checks[0]] },
        ["npm"],
      ),
    ).toThrow(/duplicate/i);
    expect(() => parseLiveCheckReport(base, ["npm", "github"])).toThrow(
      /missing/i,
    );
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
