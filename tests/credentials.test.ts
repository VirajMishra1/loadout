import { describe, expect, it, vi } from "vitest";
import {
  createCredentialResolver,
  createOsCredentialStore,
  defaultCredentialCommandRunner,
  type CredentialCommand,
  type CredentialCommandRunner,
  type CredentialCommandResult,
} from "../src/core/credentials.js";

function recordingRunner(
  response: CredentialCommandResult = {
    stdout: "",
    stderr: "",
    exitCode: 0,
  },
) {
  const commands: CredentialCommand[] = [];
  const runner: CredentialCommandRunner = async (command) => {
    commands.push(command);
    return response;
  };
  return { commands, runner };
}

describe("operating-system credential stores", () => {
  it("uses macOS Keychain without placing a write secret in arguments", async () => {
    const observed = recordingRunner();
    const store = createOsCredentialStore({
      platform: "darwin",
      runner: observed.runner,
    });
    const reference = {
      kind: "os-keychain" as const,
      service: "loadout.openrouter",
      account: "viraj",
    };
    await store.set(reference, "super-secret-value");
    await store.delete(reference);

    expect(observed.commands[0]).toMatchObject({
      command: "security",
      args: [
        "add-generic-password",
        "-U",
        "-s",
        "loadout.openrouter",
        "-a",
        "viraj",
        "-w",
      ],
      stdin: "super-secret-value",
    });
    expect(observed.commands[0]?.args).not.toContain("super-secret-value");
    expect(JSON.stringify(observed.commands[1])).not.toContain(
      "super-secret-value",
    );
  });

  it("uses Secret Service lookup/store/clear and defaults the account", async () => {
    const observed = recordingRunner({
      stdout: "linux-secret\n",
      stderr: "",
      exitCode: 0,
    });
    const store = createOsCredentialStore({
      platform: "linux",
      runner: observed.runner,
    });
    const reference = {
      kind: "os-keychain" as const,
      service: "loadout.github",
    };
    expect(await store.get(reference)).toBe("linux-secret");
    expect(observed.commands[0]).toMatchObject({
      command: "secret-tool",
      args: ["lookup", "service", "loadout.github", "account", "default"],
    });
  });

  it("uses Windows Credential Manager through a no-shell stdin bridge", async () => {
    const observed = recordingRunner();
    const store = createOsCredentialStore({
      platform: "win32",
      runner: observed.runner,
    });
    await store.set(
      {
        kind: "os-keychain",
        service: "loadout.openrouter",
        account: "owner",
      },
      "windows-secret",
    );
    const command = observed.commands[0];
    expect(command?.command).toBe("powershell.exe");
    expect(command?.stdin).toBe("windows-secret");
    expect(command?.args.join(" ")).toContain(
      "loadout:loadout.openrouter:owner",
    );
    expect(command?.args).not.toContain("windows-secret");
    expect(command?.args.join(" ")).toContain("CredWriteW");
    expect(command?.args.join(" ")).toContain("CredReadW");
  });

  it("maps backend not-found results without exposing backend output", async () => {
    const runner = vi.fn(async () => ({
      stdout: "",
      stderr: "backend diagnostics",
      exitCode: 44,
    }));
    const store = createOsCredentialStore({ platform: "darwin", runner });
    const reference = {
      kind: "os-keychain" as const,
      service: "loadout.missing",
    };
    expect(await store.get(reference)).toBeUndefined();
    expect(await store.delete(reference)).toBe(false);
  });

  it("reports backend availability without throwing command errors", async () => {
    const available = createOsCredentialStore({
      platform: "linux",
      runner: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    });
    expect(await available.status()).toEqual({
      platform: "linux",
      backend: "linux-secret-service",
      available: true,
    });

    const unavailable = createOsCredentialStore({
      platform: "win32",
      runner: async () => {
        throw new Error("powershell missing");
      },
    });
    expect(await unavailable.status()).toEqual({
      platform: "win32",
      backend: "windows-credential-manager",
      available: false,
    });
  });

  it("validates identifiers and bounded execution settings before invoking a runner", async () => {
    const runner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const store = createOsCredentialStore({ platform: "linux", runner });
    await expect(
      store.get({ kind: "os-keychain", service: "bad\nservice" }),
    ).rejects.toThrow(/safe identifier/);
    await expect(
      store.set({ kind: "os-keychain", service: "valid" }, ""),
    ).rejects.toThrow(/empty or exceeds/);
    expect(runner).not.toHaveBeenCalled();
    expect(() =>
      createOsCredentialStore({ platform: "linux", timeoutMs: 31_000 }),
    ).toThrow(/timeout/);
    expect(() =>
      createOsCredentialStore({ platform: "linux", maxOutputBytes: 100 }),
    ).toThrow(/output limit/);
  });

  it("redacts a secret even when an injected runner throws it", async () => {
    const secret = "do-not-echo-this";
    const store = createOsCredentialStore({
      platform: "linux",
      runner: async (command) => {
        throw new Error(`runner leaked ${command.stdin}`);
      },
    });
    let message = "";
    try {
      await store.set(
        { kind: "os-keychain", service: "loadout.openrouter" },
        secret,
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/could not execute safely/);
    expect(message).not.toContain(secret);
  });

  it("bounds output and runtime in the default no-shell runner", async () => {
    await expect(
      defaultCredentialCommandRunner({
        command: process.execPath,
        args: ["-e", "process.stdout.write('x'.repeat(2048))"],
        timeoutMs: 2_000,
        maxOutputBytes: 1_024,
      }),
    ).rejects.toThrow(/failed \(output\)/);

    await expect(
      defaultCredentialCommandRunner({
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        timeoutMs: 100,
        maxOutputBytes: 1_024,
      }),
    ).rejects.toThrow(/failed \(timeout\)/);
  });
});

describe("credential reference resolver", () => {
  it("resolves environment references without constructing an OS store", async () => {
    const resolver = createCredentialResolver({
      platform: "aix",
      environment: { OPENROUTER_API_KEY: "environment-secret" },
    });
    await expect(
      resolver({ kind: "environment", name: "OPENROUTER_API_KEY" }),
    ).resolves.toBe("environment-secret");
    await expect(
      resolver({ kind: "environment", name: "lowercase" }),
    ).rejects.toThrow(/environment name/);
  });

  it("resolves OS references through an injected store", async () => {
    const get = vi.fn(async () => "keychain-secret");
    const resolver = createCredentialResolver({
      environment: {},
      store: {
        get,
        set: async () => {},
        delete: async () => false,
        status: async () => ({
          platform: "darwin",
          backend: "macos-keychain",
          available: true,
        }),
      },
    });
    const reference = {
      kind: "os-keychain" as const,
      service: "loadout.openrouter",
      account: "viraj",
    };
    await expect(resolver(reference)).resolves.toBe("keychain-secret");
    expect(get).toHaveBeenCalledWith(reference);
  });
});
