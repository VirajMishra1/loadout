import { describe, expect, it } from "vitest";
import { createProviderAdapters } from "../src/core/coordination/runtime.js";

describe("coordination provider runtime", () => {
  it("composes and detects the real Claude CLI and bundled Codex SDK adapters", async () => {
    const adapters = createProviderAdapters();
    expect(adapters.map((adapter) => adapter.provider)).toEqual([
      "claude-code",
      "codex",
    ]);
    expect(
      adapters.every(
        (adapter) =>
          adapter.capabilities.canStart && adapter.capabilities.canResume,
      ),
    ).toBe(true);
    await expect(adapters[1]!.detect()).resolves.toMatch(/Codex SDK/);
  });
});
