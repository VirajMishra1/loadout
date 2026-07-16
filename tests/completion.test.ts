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
      expect(renderShellCompletion(shell)).toContain("test-drive");
      expect(renderShellCompletion(shell)).toContain("catalog-update");
      expect(renderShellCompletion(shell)).toContain("candidate");
      expect(renderShellCompletion(shell)).toContain("propose");
      expect(renderShellCompletion(shell)).toContain("autopilot");
      expect(renderShellCompletion(shell)).toContain("tool");
    }
  });

  it("rejects unknown shells with a useful remedy", () => {
    expect(() => parseCompletionShell("cmd")).toThrow(
      /bash, zsh, fish, powershell/,
    );
  });

  it("uses valid zsh declarations", () => {
    const script = renderShellCompletion("zsh");
    expect(script).toContain("typeset -a commands");
    expect(script).not.toContain("_typeset");
  });

  it("completes the current Bash word and nested model commands", () => {
    const script = renderShellCompletion("bash");
    expect(script).toContain("COMP_WORDS[COMP_CWORD]");
    expect(script).toContain('COMP_WORDS[1]}" == "models"');
    expect(script).toContain("status set verify");
    expect(script).toContain("catalog-sign");
    expect(script).toContain("sandbox-run");
    expect(script).toContain('COMP_WORDS[1]}" == "candidate"');
    expect(script).toContain("list inspect propose");
  });
});
