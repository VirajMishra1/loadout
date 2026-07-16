import { spawn } from "node:child_process";
import type { CredentialReference } from "../shared/types.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_ACCOUNT = "default";
const WINDOWS_MAX_SECRET_BYTES = 2_560;

export type SupportedCredentialPlatform = "darwin" | "linux" | "win32";
export type KeychainCredentialReference = Extract<
  CredentialReference,
  { kind: "os-keychain" }
>;

export interface CredentialCommand {
  command: string;
  args: string[];
  /** Sensitive input. Runners must never log, persist, or copy this value. */
  stdin?: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface CredentialCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type CredentialCommandRunner = (
  command: CredentialCommand,
) => Promise<CredentialCommandResult>;

export interface CredentialBackendStatus {
  platform: SupportedCredentialPlatform;
  backend:
    "macos-keychain" | "linux-secret-service" | "windows-credential-manager";
  available: boolean;
}

export interface OsCredentialStore {
  get(reference: KeychainCredentialReference): Promise<string | undefined>;
  set(reference: KeychainCredentialReference, secret: string): Promise<void>;
  delete(reference: KeychainCredentialReference): Promise<boolean>;
  status(): Promise<CredentialBackendStatus>;
}

export interface CredentialStoreOptions {
  platform?: NodeJS.Platform;
  runner?: CredentialCommandRunner;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface CredentialResolverOptions extends CredentialStoreOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  store?: OsCredentialStore;
}

interface NormalizedReference {
  service: string;
  account: string;
}

interface BackendCommand {
  command: string;
  args: string[];
  stdin?: string;
}

interface PlatformBackend {
  status: BackendCommand;
  get(reference: NormalizedReference): BackendCommand;
  set(reference: NormalizedReference, secret: string): BackendCommand;
  delete(reference: NormalizedReference): BackendCommand;
  notFoundExitCodes: ReadonlySet<number>;
  statusName: CredentialBackendStatus["backend"];
}

/**
 * Uses the Win32 Credential Manager API rather than cmdkey because cmdkey
 * cannot retrieve generic credentials and would require a password argument.
 * The secret is read exclusively from stdin by the set operation.
 */
const WINDOWS_CREDENTIAL_SCRIPT = String.raw`
$source = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class LoadoutCredentialManager {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct Credential {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredWrite(ref Credential credential, UInt32 flags);

  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);

  [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredDelete(string target, UInt32 type, UInt32 flags);

  [DllImport("advapi32.dll")]
  private static extern void CredFree(IntPtr credential);

  public static void Set(string target, string account, string secret) {
    IntPtr blob = Marshal.StringToCoTaskMemUni(secret);
    try {
      Credential credential = new Credential {
        Type = 1,
        TargetName = target,
        CredentialBlobSize = (UInt32)(secret.Length * 2),
        CredentialBlob = blob,
        Persist = 2,
        UserName = account
      };
      if (!CredWrite(ref credential, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
    } finally {
      Marshal.ZeroFreeCoTaskMemUnicode(blob);
    }
  }

  public static string Get(string target) {
    IntPtr pointer;
    if (!CredRead(target, 1, 0, out pointer)) {
      int error = Marshal.GetLastWin32Error();
      if (error == 1168) return null;
      throw new Win32Exception(error);
    }
    try {
      Credential credential = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
      return Marshal.PtrToStringUni(credential.CredentialBlob, (int)credential.CredentialBlobSize / 2);
    } finally {
      CredFree(pointer);
    }
  }

  public static bool Delete(string target) {
    if (CredDelete(target, 1, 0)) return true;
    int error = Marshal.GetLastWin32Error();
    if (error == 1168) return false;
    throw new Win32Exception(error);
  }
}
'@
Add-Type -TypeDefinition $source
$operation = $args[0]
$target = $args[1]
$account = $args[2]
if ($operation -eq 'get') {
  $value = [LoadoutCredentialManager]::Get($target)
  if ($null -eq $value) { exit 3 }
  [Console]::Out.Write($value)
} elseif ($operation -eq 'set') {
  $value = [Console]::In.ReadToEnd()
  [LoadoutCredentialManager]::Set($target, $account, $value)
} elseif ($operation -eq 'delete') {
  if (-not [LoadoutCredentialManager]::Delete($target)) { exit 3 }
} else {
  throw 'Unsupported credential operation'
}
`;

function validateTimeout(timeoutMs: number): number {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000)
    throw new Error("Credential timeout must be between 100ms and 30000ms");
  return timeoutMs;
}

function validateOutputLimit(maxOutputBytes: number): number {
  if (
    !Number.isInteger(maxOutputBytes) ||
    maxOutputBytes < 1_024 ||
    maxOutputBytes > 1024 * 1024
  )
    throw new Error(
      "Credential output limit must be between 1024 and 1048576 bytes",
    );
  return maxOutputBytes;
}

function validateIdentifier(value: string, field: string): string {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:@/+ -]{0,127}$/.test(value) ||
    value !== value.trim()
  )
    throw new Error(
      `Credential ${field} must be 1-128 safe identifier characters`,
    );
  return value;
}

function normalizeReference(
  reference: KeychainCredentialReference,
): NormalizedReference {
  if (reference.kind !== "os-keychain")
    throw new Error("A keychain credential reference is required");
  return {
    service: validateIdentifier(reference.service, "service"),
    account: validateIdentifier(
      reference.account ?? DEFAULT_ACCOUNT,
      "account",
    ),
  };
}

function validateEnvironmentName(name: string): string {
  if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(name))
    throw new Error("Credential environment name is invalid");
  return name;
}

function validateSecret(secret: string, platform: SupportedCredentialPlatform) {
  const maximum =
    platform === "win32" ? WINDOWS_MAX_SECRET_BYTES : DEFAULT_MAX_OUTPUT_BYTES;
  const bytes = Buffer.byteLength(
    secret,
    platform === "win32" ? "utf16le" : "utf8",
  );
  if (!secret || secret.includes("\0") || bytes > maximum)
    throw new Error("Credential value is empty or exceeds the backend limit");
}

function windowsTarget(reference: NormalizedReference): string {
  return `loadout:${reference.service}:${reference.account}`;
}

function backendFor(platform: SupportedCredentialPlatform): PlatformBackend {
  if (platform === "darwin")
    return {
      statusName: "macos-keychain",
      status: { command: "security", args: ["help"] },
      get: ({ service, account }) => ({
        command: "security",
        args: ["find-generic-password", "-s", service, "-a", account, "-w"],
      }),
      set: ({ service, account }, secret) => ({
        command: "security",
        args: [
          "add-generic-password",
          "-U",
          "-s",
          service,
          "-a",
          account,
          "-w",
        ],
        stdin: secret,
      }),
      delete: ({ service, account }) => ({
        command: "security",
        args: ["delete-generic-password", "-s", service, "-a", account],
      }),
      notFoundExitCodes: new Set([44]),
    };

  if (platform === "linux")
    return {
      statusName: "linux-secret-service",
      status: { command: "secret-tool", args: ["--help"] },
      get: ({ service, account }) => ({
        command: "secret-tool",
        args: ["lookup", "service", service, "account", account],
      }),
      set: ({ service, account }, secret) => ({
        command: "secret-tool",
        args: [
          "store",
          "--label=Loadout credential",
          "service",
          service,
          "account",
          account,
        ],
        stdin: secret,
      }),
      delete: ({ service, account }) => ({
        command: "secret-tool",
        args: ["clear", "service", service, "account", account],
      }),
      notFoundExitCodes: new Set([1]),
    };

  const powershellArgs = (
    operation: string,
    reference: NormalizedReference,
  ) => [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `& { ${WINDOWS_CREDENTIAL_SCRIPT} } '${operation}' '${windowsTarget(reference)}' '${reference.account}'`,
  ];
  return {
    statusName: "windows-credential-manager",
    status: {
      command: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "if (Get-Command powershell.exe -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }",
      ],
    },
    get: (reference) => ({
      command: "powershell.exe",
      args: powershellArgs("get", reference),
    }),
    set: (reference, secret) => ({
      command: "powershell.exe",
      args: powershellArgs("set", reference),
      stdin: secret,
    }),
    delete: (reference) => ({
      command: "powershell.exe",
      args: powershellArgs("delete", reference),
    }),
    notFoundExitCodes: new Set([3]),
  };
}

export const defaultCredentialCommandRunner: CredentialCommandRunner = async (
  request,
) =>
  new Promise((resolve, reject) => {
    const child = spawn(request.command, request.args, {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure: "timeout" | "output" | "spawn" | undefined;
    let settled = false;
    const finishWithError = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Credential command failed (${failure ?? "process"})`));
    };
    const collect = (target: Buffer[], chunk: Buffer, isStdout: boolean) => {
      if (failure) return;
      if (isStdout) stdoutBytes += chunk.length;
      else stderrBytes += chunk.length;
      if (stdoutBytes + stderrBytes > request.maxOutputBytes) {
        failure = "output";
        child.kill();
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk, true));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk, false));
    child.on("error", () => {
      failure = "spawn";
      finishWithError();
    });
    child.on("close", (code) => {
      if (failure) {
        finishWithError();
        return;
      }
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: code ?? 1,
      });
    });
    child.stdin.on("error", () => {
      // A command that exits early may close stdin. Its exit code is enough.
    });
    child.stdin.end(request.stdin ?? "");
    const timer = setTimeout(() => {
      failure = "timeout";
      child.kill();
    }, request.timeoutMs);
    timer.unref();
  });

function supportedPlatform(
  platform: NodeJS.Platform,
): SupportedCredentialPlatform {
  if (platform === "darwin" || platform === "linux" || platform === "win32")
    return platform;
  throw new Error(`OS credential storage is unsupported on '${platform}'`);
}

function withoutCommandNewline(value: string): string {
  return value.replace(/\r?\n$/, "");
}

export function createOsCredentialStore(
  options: CredentialStoreOptions = {},
): OsCredentialStore {
  const platform = supportedPlatform(options.platform ?? process.platform);
  const backend = backendFor(platform);
  const runner = options.runner ?? defaultCredentialCommandRunner;
  const timeoutMs = validateTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxOutputBytes = validateOutputLimit(
    options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  );

  const run = async (
    operation: "get" | "set" | "delete" | "status",
    command: BackendCommand,
  ): Promise<CredentialCommandResult> => {
    try {
      return await runner({
        ...command,
        timeoutMs,
        maxOutputBytes,
      });
    } catch {
      // A custom runner could include its input in an exception. Never forward it.
      throw new Error(`Credential ${operation} could not execute safely`);
    }
  };

  return {
    async get(reference) {
      const result = await run(
        "get",
        backend.get(normalizeReference(reference)),
      );
      if (backend.notFoundExitCodes.has(result.exitCode)) return undefined;
      if (result.exitCode !== 0)
        throw new Error("Credential get failed in the operating-system store");
      const secret = withoutCommandNewline(result.stdout);
      return secret || undefined;
    },
    async set(reference, secret) {
      validateSecret(secret, platform);
      const result = await run(
        "set",
        backend.set(normalizeReference(reference), secret),
      );
      if (result.exitCode !== 0)
        throw new Error("Credential set failed in the operating-system store");
    },
    async delete(reference) {
      const result = await run(
        "delete",
        backend.delete(normalizeReference(reference)),
      );
      if (backend.notFoundExitCodes.has(result.exitCode)) return false;
      if (result.exitCode !== 0)
        throw new Error(
          "Credential delete failed in the operating-system store",
        );
      return true;
    },
    async status() {
      try {
        const result = await run("status", backend.status);
        return {
          platform,
          backend: backend.statusName,
          available: result.exitCode === 0,
        };
      } catch {
        return { platform, backend: backend.statusName, available: false };
      }
    },
  };
}

/** Resolve secret-free configuration references only at the point of use. */
export function createCredentialResolver(
  options: CredentialResolverOptions = {},
): (reference: CredentialReference) => Promise<string | undefined> {
  const environment = options.environment ?? process.env;
  let store = options.store;
  return async (reference) => {
    if (reference.kind === "environment")
      return environment[validateEnvironmentName(reference.name)] || undefined;
    store ??= createOsCredentialStore(options);
    return store.get(reference);
  };
}

export async function resolveCredentialReference(
  reference: CredentialReference,
  options: CredentialResolverOptions = {},
): Promise<string | undefined> {
  return createCredentialResolver(options)(reference);
}
