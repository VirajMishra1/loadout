import { describe, expect, it } from "vitest";
import {
  formatModelApiAccess,
  interactiveModelApiAccess,
  parseModelApiAccess,
} from "../src/core/access.js";

describe("credential-free setup access declarations", () => {
  it("defaults to no separately billed model API access", () => {
    expect(parseModelApiAccess()).toEqual({ modelApis: [] });
    expect(parseModelApiAccess("none")).toEqual({ modelApis: [] });
    expect(formatModelApiAccess({ modelApis: [] })).toBe("none declared");
  });

  it("normalizes supported providers without accepting secrets", () => {
    expect(parseModelApiAccess("openai, anthropic,openai")).toEqual({
      modelApis: ["openai", "anthropic"],
    });
    const accidentalSecret = "sk-secret-value";
    let message = "";
    try {
      parseModelApiAccess(accidentalSecret);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/Unknown API provider/);
    expect(message).not.toContain(accidentalSecret);
    expect(() => parseModelApiAccess("none,openai")).toThrow(
      /cannot be combined/,
    );
  });

  it("maps the interactive subscription-aware choices", () => {
    expect(interactiveModelApiAccess("")).toEqual({ modelApis: [] });
    expect(interactiveModelApiAccess("3")).toEqual({
      modelApis: ["openai", "anthropic"],
    });
    expect(interactiveModelApiAccess("4")).toEqual({
      modelApis: ["openrouter"],
    });
  });
});
