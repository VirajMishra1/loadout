import { describe, expect, it } from "vitest";
import { runDisposableSandbox } from "../src/core/sandbox.js";

describe("disposable sandbox boundary", () => {
  it("refuses execution without explicit approval", async () => {
    await expect(
      runDisposableSandbox({
        sourceDirectory: ".",
        image: "reviewed/image@sha256:abc",
        command: ["sh", "-c", "echo unsafe"],
        approveRisk: false,
      }),
    ).rejects.toThrow(/approve-risk/);
  });

  it("builds a networkless, read-only, no-secret Docker invocation", async () => {
    let args: string[] = [];
    const result = await runDisposableSandbox({
      sourceDirectory: "/tmp/loadout-source",
      image: "reviewed/image@sha256:abc",
      command: ["sh", "-c", "find /input -type f"],
      approveRisk: true,
      runner: async (received) => {
        args = received;
        return { stdout: "ok", stderr: "", exitCode: 0 };
      },
    });
    expect(result.stdout).toBe("ok");
    expect(args).toContain("--network");
    expect(args).toContain("none");
    expect(args).toContain("--read-only");
    expect(args).toContain("--cap-drop");
    expect(args).toContain("ALL");
    expect(args.join(" ")).not.toContain("OPENAI_API_KEY");
  });
});
