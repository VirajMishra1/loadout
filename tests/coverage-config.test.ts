import { describe, expect, it } from "vitest";
import config from "../vitest.config.js";

describe("coverage configuration", () => {
  it("enforces a per-file floor across the install boundary", () => {
    const thresholds = config.test?.coverage?.thresholds as
      Record<string, unknown> | undefined;
    expect(thresholds?.["src/core/install/**.ts"]).toEqual({
      lines: 48,
      functions: 64,
      statements: 47,
      branches: 52,
    });
  });
});
