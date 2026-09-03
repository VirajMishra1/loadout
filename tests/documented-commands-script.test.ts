import { describe, expect, it } from "vitest";
import { validateDocumentedCommands } from "../scripts/check-documented-commands.mjs";

const commandPaths = new Set([
  "setup",
  "skills",
  "skills list",
  "skills install",
  "skills remove",
  "candidate",
  "candidate inspect",
  "handoff",
]);

describe("documented command validation", () => {
  it("accepts registered full command paths", () => {
    expect(
      validateDocumentedCommands(
        "```bash\nloadout skills install loadout-handoff --yes\nloadout candidate inspect owner/repo\n```",
        commandPaths,
        "README.md",
      ),
    ).toEqual([]);
  });

  it("rejects an unregistered child under a real parent", () => {
    expect(
      validateDocumentedCommands(
        "```bash\nloadout skills publish demo\n```",
        commandPaths,
        "README.md",
      )[0],
    ).toMatch(/loadout skills publish.*does not register/i);
  });

  it("rejects retired handoff subcommand syntax", () => {
    expect(
      validateDocumentedCommands(
        "`loadout handoff send codex 'write tests'`",
        commandPaths,
        "docs/guide.md",
      )[0],
    ).toMatch(/retired syntax.*loadout handoff send/i);
  });

  it("rejects an unknown top-level command", () => {
    expect(
      validateDocumentedCommands(
        "```bash\nloadout teleport\n```",
        commandPaths,
        "README.md",
      )[0],
    ).toMatch(/loadout teleport.*does not register/i);
  });
});
