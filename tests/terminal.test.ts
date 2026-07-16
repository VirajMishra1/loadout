import { describe, expect, it } from "vitest";
import { formatTerminalTable, terminalWidth } from "../src/core/terminal.js";

describe("terminal output policy", () => {
  it("clamps supported terminal widths from 80 through 200", () => {
    expect(terminalWidth(20)).toBe(80);
    expect(terminalWidth(120)).toBe(120);
    expect(terminalWidth(500)).toBe(200);
    expect(terminalWidth(undefined)).toBe(120);
  });

  it("renders accessible ANSI-free bounded tables at 80, 120, and 200 columns", () => {
    for (const width of [80, 120, 200]) {
      const output = formatTerminalTable(
        ["Agent", "Skill", "MCP", "Explanation"],
        [
          [
            "A very long agent display name",
            "native",
            "unsupported",
            "A deliberately long explanation that must fit the terminal width without adding ANSI escapes. ".repeat(
              4,
            ),
          ],
        ],
        width,
      );
      expect(
        Math.max(...output.split("\n").map((line) => line.length)),
      ).toBeLessThanOrEqual(width);
      expect(output).not.toContain("\u001b[");
      expect(output).toContain("…");
    }
  });
});
