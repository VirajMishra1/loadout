import { describe, expect, it } from "vitest";
import {
  parseCompletionShell,
  renderShellCompletion,
} from "../src/core/completion.js";

describe("CLI completion", () => {
  it("renders installable scripts for supported shells", () => {
    for (const shell of ["bash", "zsh", "fish", "powershell"] as const) {
      expect(renderShellCompletion(shell)).toContain("loadout");
      expect(renderShellCompletion(shell)).toContain("optimize");
    }
  });

  it("rejects unknown shells with a useful remedy", () => {
    expect(() => parseCompletionShell("cmd")).toThrow(
      /bash, zsh, fish, powershell/,
    );
  });
});
