import { describe, it, expect } from "vitest";
import {
  previewConflicts,
  formatConflictPreview,
} from "../src/core/coordination/conflict-preview.js";
import { emit } from "../src/core/coordination/coordinator.js";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function makeTmpProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "loadout-conflict-"));
  await mkdir(join(dir, ".handoff"), { recursive: true });
  return dir;
}

describe("conflict-preview", () => {
  it("detects no conflicts when paths are unclaimed", async () => {
    const root = await makeTmpProject();
    try {
      const preview = await previewConflicts(root, "claude-code", [
        "src/app.ts",
      ]);
      expect(preview.conflicts).toHaveLength(0);
      expect(preview.safe).toContain("src/app.ts");
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("detects conflict when path is owned by another agent", async () => {
    const root = await makeTmpProject();
    try {
      await emit(root, {
        from: "codex",
        to: "*",
        type: "ownership",
        description: "codex claims src/",
        payload: { paths: ["src/app.ts"], mode: "exclusive" },
      });

      const preview = await previewConflicts(root, "claude-code", [
        "src/app.ts",
      ]);
      expect(preview.conflicts).toHaveLength(1);
      expect(preview.conflicts[0].owner).toBe("codex");
      expect(preview.conflicts[0].ownerMode).toBe("exclusive");
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("skips own claims", async () => {
    const root = await makeTmpProject();
    try {
      await emit(root, {
        from: "claude-code",
        to: "*",
        type: "ownership",
        description: "claude claims src/",
        payload: { paths: ["src/app.ts"], mode: "exclusive" },
      });

      const preview = await previewConflicts(root, "claude-code", [
        "src/app.ts",
      ]);
      expect(preview.conflicts).toHaveLength(0);
      expect(preview.safe).toContain("src/app.ts");
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("detects directory overlap", async () => {
    const root = await makeTmpProject();
    try {
      await emit(root, {
        from: "codex",
        to: "*",
        type: "ownership",
        description: "codex claims src/",
        payload: { paths: ["src/"], mode: "exclusive" },
      });

      const preview = await previewConflicts(root, "claude-code", [
        "src/app.ts",
      ]);
      expect(preview.conflicts).toHaveLength(1);
      expect(preview.conflicts[0].path).toBe("src/app.ts");
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it("formats no-conflict output", () => {
    const output = formatConflictPreview({
      agent: "claude-code",
      requestedPaths: ["src/foo.ts"],
      conflicts: [],
      safe: ["src/foo.ts"],
      timestamp: new Date().toISOString(),
    });
    expect(output).toContain("No conflicts");
    expect(output).toContain("1 path(s) safe");
  });

  it("formats conflict output", () => {
    const output = formatConflictPreview({
      agent: "claude-code",
      requestedPaths: ["src/app.ts"],
      conflicts: [
        {
          path: "src/app.ts",
          owner: "codex",
          ownerMode: "exclusive",
          diff: "+new line\n-old line",
          linesChanged: 2,
          status: "modified",
        },
      ],
      safe: [],
      timestamp: new Date().toISOString(),
    });
    expect(output).toContain("1 conflict(s) detected");
    expect(output).toContain("src/app.ts");
    expect(output).toContain("codex");
  });
});
