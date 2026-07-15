import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPrivacySafeReport,
  writePrivacySafeReport,
} from "../src/core/share-report.js";
import { writeInstallState } from "../src/core/state.js";

describe("privacy-safe share report", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("excludes local paths, filenames, repository names, and MCP config names", async () => {
    root = await mkdtemp(join(tmpdir(), "loadout-share-report-"));
    process.env.LOADOUT_HOME = join(root, ".loadout");
    const secretPath = "/Users/private-person/secret-project/client-list.md";
    await writeInstallState({
      version: 1,
      installs: [
        {
          packageId: "reviewed-package",
          repository: "private-company/secret-repository",
          resolvedCommit: "a".repeat(40),
          targetAgents: ["codex"],
          files: [{ path: secretPath, sha256: "b".repeat(64) }],
          snapshotId: "snapshot",
          installedAt: "2026-07-15T00:00:00Z",
        },
      ],
      mcpInstalls: [
        {
          packageId: "reviewed-mcp",
          configPath: "/Users/private-person/.config/agent.json",
          serverName: "private-customer-server",
          fingerprint: "c".repeat(64),
          snapshotId: "snapshot",
          installedAt: "2026-07-15T00:00:00Z",
        },
      ],
      activations: [],
    });
    const report = await buildPrivacySafeReport();
    const serialized = JSON.stringify(report);
    expect(serialized).toContain("reviewed-package");
    expect(serialized).toContain("reviewed-mcp");
    expect(serialized).not.toContain("private-person");
    expect(serialized).not.toContain("secret-project");
    expect(serialized).not.toContain("secret-repository");
    expect(serialized).not.toContain("private-customer-server");
    const output = join(root, "share", "report.json");
    await writePrivacySafeReport(output, report);
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(report);
  });
});
