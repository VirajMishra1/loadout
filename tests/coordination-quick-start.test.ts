import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectSplit,
  quickStart,
  formatQuickStart,
} from "../src/core/coordination/quick-start.js";
import { getOwnership } from "../src/core/coordination/coordinator.js";

describe("coordination quick-start", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "loadout-quick-start-test-"));
  });

  describe("detectSplit", () => {
    it("detects backend/frontend split from src subdirectories", async () => {
      await mkdir(join(projectRoot, "src", "api"), { recursive: true });
      await mkdir(join(projectRoot, "src", "components"), { recursive: true });
      await mkdir(join(projectRoot, "src", "pages"), { recursive: true });
      await mkdir(join(projectRoot, "docs"), { recursive: true });

      const split = await detectSplit(projectRoot, ["claude-code", "codex"]);

      expect(split.strategy).toBe("backend / frontend");
      expect(split.assignments.get("claude-code")).toContain("src/api");
      expect(split.assignments.get("codex")).toContain("src/components");
    });

    it("detects top-level server/client split", async () => {
      await mkdir(join(projectRoot, "server"), { recursive: true });
      await mkdir(join(projectRoot, "client"), { recursive: true });
      await mkdir(join(projectRoot, "shared"), { recursive: true });

      const split = await detectSplit(projectRoot, ["claude-code", "codex"]);

      expect(split.strategy).toBe("backend / frontend");
      expect(split.assignments.get("claude-code")).toContain("server");
      expect(split.assignments.get("codex")).toContain("client");
      expect(split.unassigned).toContain("shared");
    });

    it("falls back to core/tests when no frontend directories exist", async () => {
      await mkdir(join(projectRoot, "src"), { recursive: true });
      await mkdir(join(projectRoot, "tests"), { recursive: true });
      await mkdir(join(projectRoot, "docs"), { recursive: true });

      const split = await detectSplit(projectRoot, ["claude-code", "codex"]);

      expect(split.strategy).toBe("core / tests");
      expect(split.assignments.get("claude-code")).toContain("src");
      expect(split.assignments.get("codex")).toContain("tests");
    });

    it("uses even split when no pattern matches", async () => {
      await mkdir(join(projectRoot, "alpha"), { recursive: true });
      await mkdir(join(projectRoot, "beta"), { recursive: true });

      const split = await detectSplit(projectRoot, ["claude-code", "codex"]);

      expect(split.strategy).toContain("even split");
      const allAssigned = [
        ...(split.assignments.get("claude-code") ?? []),
        ...(split.assignments.get("codex") ?? []),
      ];
      expect(allAssigned).toContain("alpha");
      expect(allAssigned).toContain("beta");
    });

    it("respects preferred split strategy", async () => {
      await mkdir(join(projectRoot, "src"), { recursive: true });
      await mkdir(join(projectRoot, "tests"), { recursive: true });
      await mkdir(join(projectRoot, "server"), { recursive: true });
      await mkdir(join(projectRoot, "client"), { recursive: true });

      const split = await detectSplit(
        projectRoot,
        ["claude-code", "codex"],
        "core/tests",
      );

      expect(split.strategy).toBe("core / tests");
    });

    it("ignores hidden dirs and node_modules", async () => {
      await mkdir(join(projectRoot, ".git"), { recursive: true });
      await mkdir(join(projectRoot, "node_modules"), { recursive: true });
      await mkdir(join(projectRoot, "src"), { recursive: true });
      await mkdir(join(projectRoot, "tests"), { recursive: true });

      const split = await detectSplit(projectRoot, ["claude-code", "codex"]);

      const all = [
        ...(split.assignments.get("claude-code") ?? []),
        ...(split.assignments.get("codex") ?? []),
        ...split.unassigned,
      ];
      expect(all).not.toContain(".git");
      expect(all).not.toContain("node_modules");
    });

    it("ignores generated directories and collapses child assignments", async () => {
      for (const dir of ["src/core", "tests", "coverage", "test-results"]) {
        await mkdir(join(projectRoot, dir), { recursive: true });
      }
      const split = await detectSplit(projectRoot, ["claude-code", "codex"]);
      const all = [...split.assignments.values()]
        .flat()
        .concat(split.unassigned);
      expect(all).not.toContain("coverage");
      expect(all).not.toContain("test-results");
      expect(split.assignments.get("claude-code")).toEqual(["src/core"]);
    });

    it("rejects unknown split names and empty agents", async () => {
      await mkdir(join(projectRoot, "src"), { recursive: true });
      await mkdir(join(projectRoot, "tests"), { recursive: true });
      await expect(
        detectSplit(projectRoot, ["claude-code", "codex"], "mystery"),
      ).rejects.toThrow(/unknown split/i);
      await expect(detectSplit(projectRoot, ["", "codex"])).rejects.toThrow(
        /agent/i,
      );
    });
  });

  describe("quickStart", () => {
    it("dry run detects structure without claiming ownership", async () => {
      await mkdir(join(projectRoot, "src", "api"), { recursive: true });
      await mkdir(join(projectRoot, "src", "components"), { recursive: true });

      const result = await quickStart(projectRoot, ["claude-code", "codex"], {
        dryRun: true,
      });

      expect(result.ownershipClaimed).toBe(false);
      expect(result.split.strategy).toBe("backend / frontend");

      const ownership = await getOwnership(projectRoot);
      expect(ownership.size).toBe(0);
    });

    it("claims ownership when --yes is used", async () => {
      await mkdir(join(projectRoot, "src", "api"), { recursive: true });
      await mkdir(join(projectRoot, "src", "components"), { recursive: true });

      const result = await quickStart(projectRoot, ["claude-code", "codex"], {
        dryRun: false,
      });

      expect(result.ownershipClaimed).toBe(true);
      const ownership = await getOwnership(projectRoot);
      expect(ownership.size).toBeGreaterThan(0);
    });

    it("skips auto-assignment when ownership already exists", async () => {
      await mkdir(join(projectRoot, "src", "api"), { recursive: true });
      await mkdir(join(projectRoot, "src", "components"), { recursive: true });

      // First run claims ownership
      await quickStart(projectRoot, ["claude-code", "codex"], {
        dryRun: false,
      });

      // Second run detects existing ownership
      const result = await quickStart(projectRoot, ["claude-code", "codex"], {
        dryRun: false,
      });

      expect(result.existingOwnership).toBe(true);
      expect(result.ownershipClaimed).toBe(false);
    });

    it("produces formatted terminal output", async () => {
      await mkdir(join(projectRoot, "server"), { recursive: true });
      await mkdir(join(projectRoot, "client"), { recursive: true });

      const result = await quickStart(projectRoot, ["claude-code", "codex"], {
        dryRun: true,
      });

      const output = formatQuickStart(result);
      expect(output).toContain("COORDINATION READY");
      expect(output).toContain("claude-code");
      expect(output).toContain("codex");
      expect(output).toContain("server");
      expect(output).toContain("client");
      expect(output).toContain("Dry run");
    });
  });
});
